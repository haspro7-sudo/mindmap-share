"""Research script for the seasonality family (calendar / time-of-day effects, H1).

    python scripts/research_seasonality.py             # final evaluation + table
    python scripts/research_seasonality.py --stage 1   # re-run an IS search stage
                                                       # (appends to the trial log)

Every configuration evaluated on in-sample data (2005-01 .. 2014-12) is logged to
reports/trials/seasonality.jsonl.  OOS (2015-01 .. 2020-05) is evaluated only for
the finally selected configuration and its neighbours (period tag "oos_*").

Stages (hypotheses fixed from the literature BEFORE looking at the data):
  1a  Tokyo fix / gotobi (USD buying by Japanese importers into the 09:55 JST fix)
  1b  home-currency depreciation during domestic hours (Ranaldo 2009,
      Breedon & Ranaldo 2013)
  1c  London 16:00 WM/R fix reversal (month-end and every day)
  1d  weekend: Monday gap fade
  2a  one-at-a-time variations of the Tokyo post-fix reversal (+ 09:55 pre-fix exit)
  2b  one-at-a-time variations of the European-morning EUR selling
  3   minute-bar timing at the 09:55 JST fix (pre-declared adoption rule)
  4   IS neighbours of the selected configuration (robustness, not re-selection)
final: selected config on IS / OOS / cost x2 (+ H1-execution variant), per-year,
outlier dependence, DSR sensitivity, neighbour OOS, look-ahead truncation test, and
writes reports/equity/seasonality.parquet + reports/trades/seasonality.parquet.
FRED periods are not applicable (close-only daily data has no Tokyo intraday times).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fxlab import backtest as B  # noqa: E402
from fxlab import data as D  # noqa: E402
from fxlab.backtest import SymbolContext  # noqa: E402
from fxlab.engine import simulate_symbol  # noqa: E402
from fxlab.research import (TrialLog, _short, dsr_for, evaluate, per_symbol_R,  # noqa: E402
                            per_year, research_config)
from fxlab.strategies.seasonality import (FixReversal, SeasonalCombo,  # noqa: E402
                                          SeasonalWindow, WeekendGap, to_local)

FAMILY = "seasonality"
LOG = TrialLog(FAMILY)
UNIVERSES = {
    "USDJPY": ["USDJPY"],
    "JPY5": ["USDJPY", "EURJPY", "GBPJPY", "AUDJPY", "CADJPY"],
    "JPYX4": ["EURJPY", "GBPJPY", "AUDJPY", "CADJPY"],
    "USD5": ["EURUSD", "GBPUSD", "AUDUSD", "USDCAD", "USDJPY"],
    "EURUSD": ["EURUSD"],
    "GBPUSD": ["GBPUSD"],
    "EUR5": ["EURUSD", "EURJPY", "EURGBP", "EURAUD", "EURCAD"],
    "FX15": ["USDJPY", "EURUSD", "GBPUSD", "AUDUSD", "USDCAD", "EURJPY", "GBPJPY", "AUDJPY",
             "CADJPY", "EURGBP", "EURAUD", "GBPAUD", "EURCAD", "AUDCAD", "GBPCAD"],
}
KINDS = {"window": SeasonalWindow, "fix": FixReversal, "gap": WeekendGap}
KEYS = ["cagr", "max_dd", "sharpe", "mar", "trades", "avg_R", "t_stat_R", "profit_factor_R",
        "worst_year", "pct_years_positive"]
MIN_IS_TRADES = 150
# Shared-engine revision the trials were evaluated with.  Trials logged before the
# engine fix (commit ba11319: commission 720 JPY, net-R statistics) carry no tag; the
# same configurations were re-evaluated under the fixed engine and are NOT counted
# twice (n_trials = number of unique configurations, see n_unique_trials()).
ENGINE_REV = "ba11319"


# ----------------------------------------------------------- helpers
def r_decomp(res) -> dict:
    """gross R at mid prices (before any cost) vs. net R after all costs."""
    t = res.taken
    if len(t) == 0:
        return {"gross_R": np.nan, "gross_t": np.nan, "net_R": np.nan}
    g = t.dir * (t.exit_mid - t.entry_mid) / t.stop_dist
    return {"gross_R": float(g.mean()),
            "gross_t": float(g.mean() / (g.std(ddof=1) / np.sqrt(len(g)))),
            "net_R": float((t.pnl_jpy / t.risk_jpy).mean())}


def _norm(p: dict, drop=("stage",)) -> str:
    return json.dumps({k: v for k, v in p.items() if k not in drop}, sort_keys=True, default=str)


def n_unique_trials(period="is") -> int:
    """Unique parameter configurations evaluated in-sample (engine re-runs excluded)."""
    if not LOG.path.exists():
        return 0
    recs = [r for r in map(json.loads, open(LOG.path)) if r["period"] == period]
    return len({_norm(r["params"], ("stage", "engine_rev")) for r in recs})


def _logged(period="is") -> set:
    if not LOG.path.exists():
        return set()
    return {_norm(r["params"]) for r in map(json.loads, open(LOG.path)) if r["period"] == period}


def make(kind: str, params: dict):
    if kind == "combo":
        return SeasonalCombo([make(k, p) for k, p in params["parts"]])
    return KINDS[kind](**params)


# ----------------------------------------------------------- M1 execution layer
# The shared engine executes on H1 bars, so a Tokyo-fix exit can only happen at
# 10:00 JST (5 minutes after the 09:55 fix).  The M1 layer runs the SAME shared
# kernel with the SAME decisions on server-time M1 bars (built exactly like
# fxlab.data.resample_ohlc builds H1) and replays the trades through the shared
# portfolio (B.backtest with a pre-filled trades_cache).  Nothing shared is modified.
@lru_cache(maxsize=4)
def m1_bars(sym: str) -> pd.DataFrame:
    m = pd.read_parquet(D.m1_path(sym), columns=["open", "high", "low", "close"])
    m.index = D.to_server_time(m.index)
    m = m[~m.index.duplicated(keep="first")]
    m = m[m.index.dayofweek < 5]
    m.index.name = "time"
    return m


SPANS = {"is": (B.IS_START, B.IS_END), "oos": (B.OOS_START, B.OOS_END),
         "full": (B.IS_START, B.OOS_END)}


def evaluate_any(strategy, symbols, periods=("is",), cost_mult=1.0, exec_="H1") -> dict:
    if exec_ == "H1":
        return evaluate(strategy, symbols, periods=periods, cost_mult=cost_mult)
    cfg = research_config(risk=0.01, cost_mult=cost_mult)
    trades = {s: simulate_symbol(strategy.decisions(SymbolContext(s)), strategy.tf, m1_bars(s))
              for s in symbols}
    out = {}
    for p in periods:
        a, b = SPANS[p]
        res, s = B.backtest(strategy, symbols, a, b, cfg, trades_cache=dict(trades))
        out[p] = _short(s)
        out[p]["_result"] = res
    return out


def run_is(kind: str, params: dict, universe: str, stage: str, exec_: str = "H1",
           log: bool = True) -> dict:
    strat = make(kind, params)
    m = evaluate_any(strat, UNIVERSES[universe], ("is",), exec_=exec_)["is"]
    res = m.pop("_result")
    m.update(r_decomp(res))
    lp = {"kind": kind, **params, "universe": universe, "exec": exec_, "engine_rev": ENGINE_REV}
    if log and _norm(lp) not in _logged("is"):
        LOG.log({**lp, "stage": stage}, m, "is")
    return m


def show(rows, sort="sharpe"):
    df = pd.DataFrame(rows).sort_values(sort, ascending=False)
    with pd.option_context("display.width", 250, "display.max_columns", 40,
                           "display.float_format", "{:.3f}".format):
        print(df.to_string(index=False))
    return df


def grid(stage: str, cfgs: dict):
    """cfgs: name -> (kind, params, universe[, exec])"""
    rows = []
    for name, spec in cfgs.items():
        kind, params, uni = spec[:3]
        exec_ = spec[3] if len(spec) > 3 else "H1"
        t0 = time.time()
        m = run_is(kind, params, uni, stage, exec_)
        row = {"cfg": name, "uni": uni, **{k: m.get(k) for k in KEYS},
               "gross_R": m["gross_R"], "gross_t": m["gross_t"], "net_R": m["net_R"]}
        rows.append(row)
        print(f"{name:40s} {uni:7s} sh={m.get('sharpe', 0):6.3f} n={m.get('trades', 0):5d} "
              f"netR={m.get('avg_R', 0):7.4f} t={m.get('t_stat_R', 0):5.2f} "
              f"gross={m['gross_R']:7.4f} (t={m['gross_t']:5.2f}) cagr={m.get('cagr', 0):7.4f} "
              f"dd={m.get('max_dd', 0):6.3f}  [{time.time() - t0:.0f}s]", flush=True)
    print(f"\n=== stage {stage} (IS 2005-2014) ===")
    show(rows)
    return rows


# ----------------------------------------------------------- stages
W = dict(stop_atr=0.5, atr_n=14)


def stage1a():
    """Tokyo fix / gotobi: 8 trials."""
    g = dict(tz="JST", ccy="JPY", **W)
    cfgs = {
        "gotobi_sellJPY_08-10": ("window", {**g, "ccy_dir": -1, "entry_hour": 8, "exit_hour": 10,
                                            "days": "gotobi"}, "USDJPY"),
        "gotobi_sellJPY_09-10": ("window", {**g, "ccy_dir": -1, "entry_hour": 9, "exit_hour": 10,
                                            "days": "gotobi"}, "USDJPY"),
        "nongotobi_sellJPY_08-10": ("window", {**g, "ccy_dir": -1, "entry_hour": 8,
                                               "exit_hour": 10, "days": "non_gotobi"}, "USDJPY"),
        "jpbday_sellJPY_08-10": ("window", {**g, "ccy_dir": -1, "entry_hour": 8, "exit_hour": 10,
                                            "days": "jp_bday"}, "USDJPY"),
        "gotobi_sellJPY_08-10_JPY5": ("window", {**g, "ccy_dir": -1, "entry_hour": 8,
                                                 "exit_hour": 10, "days": "gotobi"}, "JPY5"),
        "gotobi_buyJPY_10-12": ("window", {**g, "ccy_dir": 1, "entry_hour": 10, "exit_hour": 12,
                                           "days": "gotobi"}, "USDJPY"),
        "gotobi_buyJPY_10-15": ("window", {**g, "ccy_dir": 1, "entry_hour": 10, "exit_hour": 15,
                                           "days": "gotobi"}, "USDJPY"),
        "jpbday_buyJPY_10-12": ("window", {**g, "ccy_dir": 1, "entry_hour": 10, "exit_hour": 12,
                                           "days": "jp_bday"}, "USDJPY"),
    }
    grid("s1a", cfgs)


def stage1b():
    """Home-currency depreciation in domestic hours: 4 trials."""
    cfgs = {
        "sellJPY_tokyo_JST09-15": ("window", dict(tz="JST", entry_hour=9, exit_hour=15, ccy="JPY",
                                                  ccy_dir=-1, days="jp_bday", **W), "USDJPY"),
        "sellUSD_ny_NY08-16": ("window", dict(tz="NY", entry_hour=8, exit_hour=16, ccy="USD",
                                              ccy_dir=-1, days="all", **W), "USD5"),
        "sellEUR_eu_LDN08-12": ("window", dict(tz="LDN", entry_hour=8, exit_hour=12, ccy="EUR",
                                               ccy_dir=-1, days="all", **W), "EURUSD"),
        "sellGBP_ldn_LDN08-12": ("window", dict(tz="LDN", entry_hour=8, exit_hour=12, ccy="GBP",
                                                ccy_dir=-1, days="all", **W), "GBPUSD"),
    }
    grid("s1b", cfgs)


def stage1c():
    """London 16:00 fix reversal on the USD majors: 5 trials."""
    f = dict(tz="LDN", fix_hour=16, ccy="USD", **W)
    cfgs = {
        "fixrev_ME_look2_x17": ("fix", {**f, "look": 2, "exit_hour": 17, "days": "month_end"}, "USD5"),
        "fixrev_ME_look2_x18": ("fix", {**f, "look": 2, "exit_hour": 18, "days": "month_end"}, "USD5"),
        "fixrev_ME_look1_x17": ("fix", {**f, "look": 1, "exit_hour": 17, "days": "month_end"}, "USD5"),
        "fixrev_all_look2_x17": ("fix", {**f, "look": 2, "exit_hour": 17, "days": "all"}, "USD5"),
        "fixrev_all_look1_x17": ("fix", {**f, "look": 1, "exit_hour": 17, "days": "all"}, "USD5"),
    }
    grid("s1c", cfgs)


def stage1d():
    """Monday gap fade: 2 trials."""
    cfgs = {
        "gapfade_0.25atr_x12": ("gap", dict(min_gap_atr=0.25, exit_server_hour=12, **W), "FX15"),
        "gapfade_0.5atr_x12": ("gap", dict(min_gap_atr=0.5, exit_server_hour=12, **W), "FX15"),
    }
    grid("s1d", cfgs)


# stage 2a: one-at-a-time variations around the Tokyo post-fix reversal
BASE_TK = dict(tz="JST", entry_hour=10, exit_hour=15, ccy="JPY", ccy_dir=1, days="gotobi", **W)


def stage2a():
    """Tokyo post-fix JPY buying: 14 trials (+2 M1-execution checks of the pre-fix leg)."""
    b = BASE_TK
    cfgs = {
        "tk_x13": ("window", {**b, "exit_hour": 13}, "USDJPY"),
        "tk_x14": ("window", {**b, "exit_hour": 14}, "USDJPY"),
        "tk_x16": ("window", {**b, "exit_hour": 16}, "USDJPY"),
        "tk_x17": ("window", {**b, "exit_hour": 17}, "USDJPY"),
        "tk_e11": ("window", {**b, "entry_hour": 11}, "USDJPY"),
        "tk_jpbday": ("window", {**b, "days": "jp_bday"}, "USDJPY"),
        "tk_nongotobi": ("window", {**b, "days": "non_gotobi"}, "USDJPY"),
        "tk_JPY5": ("window", b, "JPY5"),
        "tk_JPYX4": ("window", b, "JPYX4"),
        "tk_sellUSD_USD5": ("window", {**b, "ccy": "USD", "ccy_dir": -1}, "USD5"),
        "tk_stop0.3": ("window", {**b, "stop_atr": 0.3}, "USDJPY"),
        "tk_stop1.0": ("window", {**b, "stop_atr": 1.0}, "USDJPY"),
        "tk_fixrev_cond_look2": ("fix", dict(tz="JST", fix_hour=10, look=2, exit_hour=15,
                                             days="gotobi", ccy="JPY", **W), "USDJPY"),
        # pre-fix leg with an exact 09:55 JST exit on minute bars (literature: peak at fix)
        "pre_gotobi_08-0955_M1": ("window", dict(tz="JST", entry_hour=8, exit_hour=10,
                                                 exit_early_min=5, ccy="JPY", ccy_dir=-1,
                                                 days="gotobi", **W), "USDJPY", "M1"),
        "pre_gotobi_08-10_M1": ("window", dict(tz="JST", entry_hour=8, exit_hour=10,
                                               ccy="JPY", ccy_dir=-1, days="gotobi", **W),
                                "USDJPY", "M1"),
    }
    grid("s2a", cfgs)


# stage 2b: one-at-a-time variations around the European-morning EUR selling
BASE_EU = dict(tz="LDN", entry_hour=8, exit_hour=12, ccy="EUR", ccy_dir=-1, days="all", **W)


def stage2b():
    """European-morning EUR selling: 7 trials."""
    b = BASE_EU
    cfgs = {
        "eu_x11": ("window", {**b, "exit_hour": 11}, "EURUSD"),
        "eu_x13": ("window", {**b, "exit_hour": 13}, "EURUSD"),
        "eu_e07": ("window", {**b, "entry_hour": 7}, "EURUSD"),
        "eu_e09": ("window", {**b, "entry_hour": 9}, "EURUSD"),
        "eu_EUR5": ("window", b, "EUR5"),
        "eu_stop0.3": ("window", {**b, "stop_atr": 0.3}, "EURUSD"),
        "eu_stop1.0": ("window", {**b, "stop_atr": 1.0}, "EURUSD"),
    }
    grid("s2b", cfgs)


def stage3():
    """Minute-bar timing around the 09:55 JST fix: 2 trials.
    Pre-declared rule: the pre-fix leg is NOT eligible for selection (its sign flips
    when the exit moves from 09:55 to 10:00, i.e. a spiky optimum); the 09:55 entry
    of the post-fix leg is adopted only if IS Sharpe improves by >= 0.2 over H1."""
    pre = dict(tz="JST", entry_hour=8, exit_hour=10, exit_early_min=5, ccy="JPY", ccy_dir=-1,
               days="gotobi", **W)
    post = {**BASE_TK, "entry_early_min": 5}
    cfgs = {
        "tk_e0955_M1": ("window", post, "USDJPY", "M1"),
        "cycle_pre0955_post_M1": ("combo", {"parts": [("window", pre), ("window", post)]},
                                  "USDJPY", "M1"),
    }
    grid("s3", cfgs)


# ----------------------------------------------------------- selected configuration
# Selected on IS by the stage-3 rule: Tokyo post-fix JPY buying on gotobi days,
# entry at the 09:55 JST fix (minute-bar execution), exit 15:00 JST, stop 0.5 x D1 ATR14.
SELECTED = {**BASE_TK, "entry_early_min": 5}
SEL_KIND, SEL_UNI, SEL_EXEC = "window", "USDJPY", "M1"


def neighbours() -> dict:
    b = SELECTED
    return {
        "nb_entry_0950": {**b, "entry_early_min": 10},
        "nb_entry_0957": {**b, "entry_early_min": 3},
        "nb_entry_1000": {**b, "entry_early_min": 0},
        "nb_exit_13": {**b, "exit_hour": 13},
        "nb_exit_14": {**b, "exit_hour": 14},
        "nb_exit_16": {**b, "exit_hour": 16},
        "nb_exit_17": {**b, "exit_hour": 17},
        "nb_stop_0.3": {**b, "stop_atr": 0.3},
        "nb_stop_0.75": {**b, "stop_atr": 0.75},
        "nb_stop_1.0": {**b, "stop_atr": 1.0},
        "nb_atr_10": {**b, "atr_n": 10},
        "nb_atr_20": {**b, "atr_n": 20},
        "nb_days_jpbday": {**b, "days": "jp_bday"},
        "nb_days_nongotobi": {**b, "days": "non_gotobi"},
    }


def stage4():
    """IS neighbour robustness of the selected configuration: 14 trials (not used to
    re-select; a spiky optimum would reject the configuration)."""
    cfgs = {k: (SEL_KIND, p, SEL_UNI, SEL_EXEC) for k, p in neighbours().items()}
    grid("s4", cfgs)


STAGES = {"4": stage4, "3": stage3, "1a": stage1a, "1b": stage1b, "1c": stage1c, "1d": stage1d, "2a": stage2a,
          "2b": stage2b}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", default=None, help="re-run an IS search stage: " + ",".join(STAGES))
    args = ap.parse_args()
    if args.stage:
        t0 = time.time()
        STAGES[args.stage]()
        print(f"stage {args.stage} done in {time.time() - t0:.0f}s; log lines: {LOG.count()}, "
              f"unique IS configurations: {n_unique_trials()}")
        return
    final()


# ----------------------------------------------------------- final evaluation
OUT_EQ = ROOT / "reports" / "equity" / f"{FAMILY}.parquet"
OUT_TR = ROOT / "reports" / "trades" / f"{FAMILY}.parquet"
RKEYS = ["cagr", "max_dd", "sharpe", "mar", "trades", "avg_R", "t_stat_R", "profit_factor_R",
         "worst_year", "win_rate"]


def _log_once(params: dict, m: dict, period: str):
    lp = {**params, "engine_rev": ENGINE_REV}
    if _norm(lp) not in _logged(period):
        LOG.log(lp, m, period)


def _fmt_row(name, m):
    return {"period": name, **{k: m.get(k) for k in RKEYS}}


def truncation_test(strat, symbol="USDJPY", cuts=("2008-06-13 12:00", "2012-03-09 03:00",
                                                     "2016-11-25 02:00")) -> bool:
    """Decisions computed on data truncated at T must equal the full-data decisions
    for every row that acts before T (no look-ahead)."""
    from fxlab import backtest as BB
    full = strat.decisions(SymbolContext(symbol))
    ok = True
    for c in cuts:
        T = pd.Timestamp(c)

        class Ctx:
            source = "oanda"
            inst = SymbolContext(symbol).inst

            @staticmethod
            def bars(tf):
                b = BB._bars("oanda", symbol, tf)
                dur = {"H1": pd.Timedelta(hours=1), "D1": pd.Timedelta(days=1)}[tf]
                return b[b.index + dur <= T]           # only bars CLOSED by T
        part = strat.decisions(Ctx)
        cols = ["long_entry", "short_entry", "exit_long", "exit_short", "stop_dist"]
        f = full.loc[full.index.isin(part.index), cols]
        pt = part.loc[f.index, cols]
        same = f.fillna(-1).equals(pt.fillna(-1))
        print(f"  truncation at {T}: {len(pt)} rows compared, identical={same}")
        ok &= same
    return ok


def final():
    t0 = time.time()
    strat = make(SEL_KIND, SELECTED)
    syms = UNIVERSES[SEL_UNI]
    n_trials = n_unique_trials()
    base = {"kind": SEL_KIND, **SELECTED, "universe": SEL_UNI, "exec": SEL_EXEC}

    ev = evaluate_any(strat, syms, ("is", "oos", "full"), exec_=SEL_EXEC)
    ev2 = evaluate_any(strat, syms, ("is", "oos"), cost_mult=2.0, exec_=SEL_EXEC)
    h1 = evaluate_any(make(SEL_KIND, {**SELECTED, "entry_early_min": 0}), syms, ("is", "oos"),
                      exec_="H1")                                     # 10:00 JST entry
    res = {k: ev[k].pop("_result") for k in ev}
    res2 = {k: ev2[k].pop("_result") for k in ev2}
    for k in h1:
        h1[k].pop("_result")
    metrics = {"is": ev["is"], "oos": ev["oos"], "is_cost2x": ev2["is"],
               "oos_cost2x": ev2["oos"]}
    for per, m in metrics.items():
        _log_once({**base, "stage": "final"}, {**m, **r_decomp(res.get(per) or
                                                        res2[per.split("_")[0]])}, per)
    dsr = dsr_for(ev["is"], res["is"], n_trials)

    print("=" * 100)
    print("SEASONALITY - selected configuration (chosen on IS 2005-2014 only)")
    print(json.dumps(base))
    print(f"unique IS configurations evaluated (n_trials): {n_trials}   "
          f"trial-log lines: {LOG.count()}")
    rows = [_fmt_row("IS 2005-2014", ev["is"]), _fmt_row("OOS 2015-2020/05", ev["oos"]),
            _fmt_row("IS cost x2", ev2["is"]), _fmt_row("OOS cost x2", ev2["oos"]),
            _fmt_row("IS  H1 exec (entry 10:00 JST)", h1["is"]),
            _fmt_row("OOS H1 exec (entry 10:00 JST)", h1["oos"]),
            _fmt_row("FULL 2005-2020/05", ev["full"])]
    with pd.option_context("display.width", 250, "display.max_columns", 30,
                           "display.float_format", "{:.4f}".format):
        print(pd.DataFrame(rows).to_string(index=False))
    for per in ("is", "oos"):
        print(f"{per}: gross/net R decomposition {r_decomp(res[per])}")
    print(f"Deflated Sharpe (IS, n_trials={n_trials}): {dsr:.4f}")

    # ---- per year (full period, 1% risk) and per-year trade R
    tk = res["full"].taken.copy()
    tk["gross_R"] = tk.dir * (tk.exit_mid - tk.entry_mid) / tk.stop_dist
    py = per_year(res["full"])
    yr = tk.groupby(tk.entry_time.dt.year).agg(n=("R_net", "size"), net_R=("R_net", "mean"),
                                              gross_R=("gross_R", "mean"))
    yr["ret"] = py.reindex(yr.index)
    print("\nper year (full period, 1% risk):")
    print(yr.round(4).to_string())

    # ---- day-type / weekday split (diagnostic only, not used for selection)
    jst = to_local(pd.DatetimeIndex(tk.entry_time), "JST")
    dom = pd.Series(jst.day, index=tk.index)
    last = pd.Series(jst.is_month_end, index=tk.index)
    mend = pd.Series([d.month != (d + pd.offsets.BDay(1)).month for d in jst], index=tk.index)
    tk["type"] = np.where(mend, "month_end_bday", np.where(dom % 5 == 0, "exact_5_10",
                                                            "shifted_5_10"))
    tk["wd"] = jst.dayofweek
    tk["per"] = np.where(tk.entry_time < pd.Timestamp(B.OOS_START), "IS", "OOS")
    print("\nby gotobi type (net R):")
    print(tk.pivot_table(index="type", columns="per", values="R_net",
                         aggfunc=["size", "mean"]).round(4).to_string())
    print("\nby JST weekday (net R):")
    print(tk.pivot_table(index="wd", columns="per", values="R_net",
                         aggfunc=["size", "mean"]).round(4).to_string())
    print("exit reasons:", tk.reason.value_counts().to_dict(),
          " entry JST times:", pd.Series(jst.strftime("%H:%M")).value_counts().head(3).to_dict())

    # ---- dependence on a few large trades (OOS is carried by 3 macro-event days)
    print("\noutlier dependence (net R after dropping the k largest winners):")
    orow = []
    for per in ("IS", "OOS"):
        x = tk[tk.per == per].sort_values("R_net", ascending=False)
        for k in (0, 1, 3, 5):
            r, g = x.R_net.iloc[k:], x.gross_R.iloc[k:]
            orow.append({"per": per, "drop_top": k, "n": len(r), "net_R": r.mean(),
                         "net_t": r.mean() / (r.std() / np.sqrt(len(r))),
                         "gross_R": g.mean(), "gross_t": g.mean() / (g.std() / np.sqrt(len(g))),
                         "median_net_R": x.R_net.median()})
    with pd.option_context("display.width", 250, "display.float_format", "{:.4f}".format):
        print(pd.DataFrame(orow).to_string(index=False))
    top = tk[tk.per == "OOS"].nlargest(3, "R_net")
    print("largest OOS trades:", [(str(a.date()), round(b, 2)) for a, b in
                                  zip(top.entry_time, top.R_net)])

    # ---- deflated Sharpe sensitivity: harness assumption (trial-SR dispersion 0.5)
    # vs. the raw dispersion of this family's trial Sharpes (inflated by cost-dominated
    # always-in-market variants, so a very conservative bound)
    from scipy import stats as st
    from fxlab.metrics import ANN, deflated_sharpe
    recs = [json.loads(x) for x in open(LOG.path)]
    shs = {}
    for r in recs:
        if r["period"] == "is" and r["params"].get("engine_rev") == ENGINE_REV:
            shs[_norm(r["params"], ("stage", "engine_rev"))] = r["metrics"]["sharpe"]
    sh = np.array(list(shs.values()))
    rr = res["is"].equity.pct_change().dropna()
    dsr_emp = deflated_sharpe(ev["is"]["sharpe"], len(rr), n_trials, float(st.skew(rr)),
                              float(st.kurtosis(rr, fisher=False)),
                              (sh.std(ddof=1) / np.sqrt(ANN)) ** 2)
    print(f"\nDSR sensitivity: trial Sharpe mean {sh.mean():.3f}, sd {sh.std(ddof=1):.3f} "
          f"(n={len(sh)}); DSR with sd=0.5 (harness) {dsr:.4f}, with empirical sd {dsr_emp:.4f}; "
          f"Bonferroni z for {n_trials} trials at 5%: {st.norm.ppf(1 - 0.05 / n_trials):.2f} "
          f"vs IS t(R) {ev['is']['t_stat_R']:.2f}")

    # ---- neighbours: IS (logged in stage 4) and OOS (reported, never used to select)
    print("\nneighbour robustness (1% risk):")
    nrows = []
    for name, p in neighbours().items():
        e = evaluate_any(make(SEL_KIND, p), syms, ("is", "oos"), exec_=SEL_EXEC)
        for per in ("is", "oos"):
            e[per].pop("_result")
        _log_once({"kind": SEL_KIND, **p, "universe": SEL_UNI, "exec": SEL_EXEC,
                   "stage": "final_nb"}, e["oos"], "oos_nb")
        nrows.append({"cfg": name, "is_sharpe": e["is"]["sharpe"], "is_R": e["is"]["avg_R"],
                      "is_t": e["is"]["t_stat_R"], "oos_sharpe": e["oos"]["sharpe"],
                      "oos_R": e["oos"]["avg_R"], "oos_t": e["oos"]["t_stat_R"],
                      "oos_cagr": e["oos"]["cagr"], "oos_dd": e["oos"]["max_dd"]})
    with pd.option_context("display.width", 250, "display.float_format", "{:.4f}".format):
        print(pd.DataFrame(nrows).to_string(index=False))

    # ---- no-look-ahead check
    print("\nlook-ahead truncation test:")
    trunc_ok = truncation_test(strat)
    print(f"  passed={trunc_ok}")

    # ---- deliverables
    OUT_EQ.parent.mkdir(parents=True, exist_ok=True)
    OUT_TR.parent.mkdir(parents=True, exist_ok=True)
    res["full"].equity.to_frame("equity").to_parquet(OUT_EQ)
    keep = [c for c in ["book", "symbol", "entry_time", "exit_time", "dir", "entry_mid",
                        "exit_mid", "entry_eff", "exit_eff", "stop_dist", "reason", "lots",
                        "R", "R_net", "pnl_jpy", "commission_jpy", "swap_jpy", "risk_jpy"]
            if c in tk.columns]
    tk[keep].reset_index(drop=True).to_parquet(OUT_TR)
    print(f"\nwrote {OUT_EQ} and {OUT_TR}  [{time.time() - t0:.0f}s]")
    return metrics, dsr, n_trials


if __name__ == "__main__":
    main()
