"""Research script for the session_breakout family (H1 intraday session breakouts).

    python scripts/research_session_breakout.py            # final evaluation + table
    python scripts/research_session_breakout.py --stage 1  # re-run an IS search stage
                                                           # (appends to the trial log)

Stages (in-sample 2005-2014 ONLY, every parameter set logged with TrialLog):
    0   smoke-test default (Asian range 02-09, entries 09-14, exit 22)        [H1 fills]
    1   Asian-range breakout structure grid (range x entry window x exit x stop) [H1 fills]
    1m  M1-fill re-check of the leading stage-1 structures (wide vs mid-range stop)
    1b  London-morning range broken during New York
    1c  false-breakout fade (Asian and London ranges)
    2a  one-at-a-time variations around the best structure
    2b  trend-filter x min-range-width factorial
Stages 1m..2b and the neighbours use M1 fills of the same H1 decisions (see the M1
execution layer below for why).  The final mode evaluates the selected config with the
standard engine (H1 fills) and with M1 fills on IS / OOS / cost x2, runs neighbour,
per-symbol and per-year robustness, post-selection diagnostics, the look-ahead
truncation test, and writes the deliverables (reports/equity, reports/trades; standard
engine, full 2005-2020, 1% risk).
"""
from __future__ import annotations

import argparse
import itertools
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from functools import lru_cache  # noqa: E402

from fxlab import backtest as B  # noqa: E402
from fxlab import data as D  # noqa: E402
from fxlab.backtest import SymbolContext, _bars  # noqa: E402
from fxlab.engine import simulate_symbol  # noqa: E402
from fxlab.research import (TrialLog, _short, dsr_for, evaluate, per_symbol_R,  # noqa: E402
                            per_year, research_config)
from fxlab.strategies.session_breakout import SessionBreakout  # noqa: E402

FAMILY = "session_breakout"
UNIVERSES = {
    "six": ["GBPUSD", "EURUSD", "GBPJPY", "USDJPY", "EURJPY", "XAUUSD"],  # task universe
    "fx5": ["GBPUSD", "EURUSD", "GBPJPY", "USDJPY", "EURJPY"],
    "gbp_eur4": ["GBPUSD", "EURUSD", "GBPJPY", "EURJPY"],
}
MIN_IS_TRADES = 150
LOG = TrialLog(FAMILY)

DEFAULTS = dict(mode="breakout", range_start=2, range_end=9, entry_end=14, exit_hour=22,
                stop_mode="range", stop_frac=1.0, stop_atr=0.5, atr_n=14, tp_r=0.0,
                tp_mode="none", buffer_atr=0.0, min_width_atr=0.0, max_width_atr=0.0,
                oco=True, trend_n=0, max_hold=0, fade_stop_buf=0.05, min_range_bars=0)

KEYS = ["cagr", "max_dd", "sharpe", "mar", "trades", "avg_R", "t_stat_R", "profit_factor_R",
        "worst_year"]


def r_decomp(res) -> dict:
    """gross mid-price R, R after spread/slippage, net R incl. commission+swap."""
    t = res.taken
    if len(t) == 0:
        return {"gross_R": np.nan, "net_R": np.nan}
    g = t.dir * (t.exit_mid - t.entry_mid) / t.stop_dist
    return {"gross_R": float(g.mean()),
            "gross_t": float(g.mean() / (g.std(ddof=1) / np.sqrt(len(g)))),
            "net_R": float((t.pnl_jpy / t.risk_jpy).mean())}


def _norm_params(p: dict) -> str:
    out = {}
    for k, v in p.items():
        if k == "stage" or v is None or (isinstance(v, float) and np.isnan(v)):
            continue
        out[k] = v if isinstance(v, (bool, np.bool_, str)) else float(v)
    return json.dumps(out, sort_keys=True, default=str)


def _logged_keys(period="is") -> set:
    if not LOG.path.exists():
        return set()
    recs = [json.loads(x) for x in open(LOG.path)]
    return {_norm_params(r["params"]) for r in recs if r["period"] == period}


def _key(p, universe):
    return _norm_params({**DEFAULTS, **p, "universe": universe})


# ----------------------------------------------------------- M1 execution layer
# The standard engine fills stop-entry orders on H1 bars and then checks the stop
# against the SAME bar's low/high, i.e. it assumes the adverse extreme came AFTER the
# fill.  For breakout orders whose stop lies inside the bar's range this is heavily
# pessimistic (stop_frac=0.5: 44% of GBPUSD trades "stopped on the fill bar" on H1
# vs. far fewer on M1).  The M1 layer runs the SAME shared kernel with the SAME H1
# decisions (orders live until the next H1 decision) on server-time M1 bars built
# exactly like fxlab.data.resample_ohlc builds H1 (verified: resampling these M1 bars
# reproduces the H1 file bit-for-bit), then replays the trades through the shared
# portfolio (B.backtest with a pre-filled trades_cache).  Nothing shared is modified.
@lru_cache(maxsize=None)
def m1_bars(sym: str) -> pd.DataFrame:
    m = pd.read_parquet(D.m1_path(sym), columns=["open", "high", "low", "close"])
    m.index = D.to_server_time(m.index)
    m = m[~m.index.duplicated(keep="first")]
    m = m[m.index.dayofweek < 5]
    m.index.name = "time"
    return m


SPANS = {"is": (B.IS_START, B.IS_END), "oos": (B.OOS_START, B.OOS_END),
         "full": (B.IS_START, B.OOS_END)}


def m1_trades(strategy, symbols) -> dict:
    return {s: simulate_symbol(strategy.decisions(SymbolContext(s)), strategy.tf, m1_bars(s))
            for s in symbols}


def evaluate_m1(strategy, symbols, periods=("is",), cost_mult=1.0, risk=0.01) -> dict:
    """Same as fxlab.research.evaluate for OANDA periods, but fills on M1 bars."""
    cfg = research_config(risk=risk, cost_mult=cost_mult)
    trades = m1_trades(strategy, symbols)
    out = {}
    for p in periods:
        a, b = SPANS[p]
        res, s = B.backtest(strategy, symbols, a, b, cfg, trades_cache=dict(trades))
        out[p] = _short(s)
        out[p]["_result"] = res
    return out


def run_is(params: dict, universe: str = "six", stage: str = "", log: bool = True,
           exec_: str = "M1") -> dict:
    p = {**DEFAULTS, **params}
    strat = SessionBreakout(**p)
    if exec_ == "M1":
        m = evaluate_m1(strat, UNIVERSES[universe], periods=("is",))["is"]
        lp = {**p, "universe": universe, "exec": "M1"}
    else:
        m = evaluate(strat, UNIVERSES[universe], periods=("is",))["is"]
        lp = {**p, "universe": universe}          # stage 0/1 trials (H1 execution)
    res = m.pop("_result")
    m.update(r_decomp(res))
    if log and _norm_params(lp) not in _logged_keys("is"):
        LOG.log({**lp, "stage": stage}, m, "is")
    return m


def show(rows: list[dict], sort="sharpe", top=None):
    df = pd.DataFrame(rows).sort_values(sort, ascending=False)
    if top:
        df = df.head(top)
    with pd.option_context("display.width", 250, "display.max_columns", 40,
                           "display.float_format", "{:.3f}".format):
        print(df.to_string(index=False))
    return df


def _grid(stage, configs: dict, universe="six", exec_="M1"):
    rows = []
    for name, p in configs.items():
        m = run_is(p, universe=universe, stage=stage, exec_=exec_)
        row = {"cfg": name, **{k: m.get(k) for k in KEYS}, "gross_R": m["gross_R"],
               "gross_t": m.get("gross_t"), "net_R": m["net_R"]}
        rows.append(row)
        print(name, {k: (round(v, 3) if isinstance(v, float) else v) for k, v in row.items()
                     if k != "cfg"}, flush=True)
    print(f"\n=== stage {stage} (IS, {universe}) ===")
    show(rows)
    return rows


# ------------------------------------------------------------------------- stages
def stage0():
    _grid("s0", {"default": {}}, exec_="H1")


def stage1():
    """Asian-range breakout: range window x entry window x exit x stop (24)."""
    cfgs = {}
    for (rs, re), ee, xh, sf in itertools.product([(0, 9), (2, 9), (2, 10)], [13, 17],
                                                  [18, 23], [1.0, 0.5]):
        cfgs[f"rng{rs}-{re}_ent{ee}_x{xh}_sf{sf}"] = dict(
            mode="breakout", range_start=rs, range_end=re, entry_end=ee, exit_hour=xh,
            stop_mode="range", stop_frac=sf)
    _grid("s1", cfgs, exec_="H1")    # run (and logged) with H1 execution, before the
    # entry-bar stop artefact was found; stage 1m re-checks tight stops on M1


def stage1m():
    """M1-execution re-check of the leading stage-1 structures, wide vs mid-range stop (4)."""
    cfgs = {}
    for (rs, re), sf in itertools.product([(2, 10), (2, 9)], [1.0, 0.5]):
        cfgs[f"rng{rs}-{re}_ent13_x18_sf{sf}_M1"] = dict(
            mode="breakout", range_start=rs, range_end=re, entry_end=13, exit_hour=18,
            stop_mode="range", stop_frac=sf)
    _grid("s1m", cfgs)


def stage1b():
    """London-morning range broken during New York (8)."""
    cfgs = {}
    for (rs, re), ee, sf in itertools.product([(9, 15), (10, 15)], [17, 19], [1.0, 0.5]):
        cfgs[f"rng{rs}-{re}_ent{ee}_x23_sf{sf}"] = dict(
            mode="breakout", range_start=rs, range_end=re, entry_end=ee, exit_hour=23,
            stop_mode="range", stop_frac=sf)
    _grid("s1b", cfgs)


def stage1c():
    """False-breakout fade: Asian range (16) + London range (4)."""
    cfgs = {}
    for (rs, re), ee, xh, tpm in itertools.product([(2, 9), (2, 10)], [13, 17], [18, 23],
                                                   ["range", "none"]):
        cfgs[f"fade_rng{rs}-{re}_ent{ee}_x{xh}_tp{tpm}"] = dict(
            mode="fade", range_start=rs, range_end=re, entry_end=ee, exit_hour=xh,
            stop_mode="range", tp_mode=tpm)
    for (rs, re), tpm in itertools.product([(9, 15), (10, 15)], ["range", "none"]):
        cfgs[f"fade_rng{rs}-{re}_ent19_x23_tp{tpm}"] = dict(
            mode="fade", range_start=rs, range_end=re, entry_end=19, exit_hour=23,
            stop_mode="range", tp_mode=tpm)
    _grid("s1c", cfgs)


# stage 2a: one-at-a-time variations around the best stage-1 structure (M1 execution)
BASE_2A = dict(mode="breakout", range_start=2, range_end=10, entry_end=13, exit_hour=18,
               stop_mode="range", stop_frac=1.0)
VARS_2A = [
    ("tp_r", 1.0), ("tp_r", 2.0),
    ("min_width_atr", 0.35), ("min_width_atr", 0.5),
    ("max_width_atr", 0.5),
    ("buffer_atr", 0.05), ("buffer_atr", 0.1),
    ("trend_n", 50), ("trend_n", 200),
    ("exit_hour", 16), ("exit_hour", 21),
    ("entry_end", 12), ("entry_end", 15),
    ("oco", False),
    ("range_start", 0), ("range_start", 4),
    ("stop_mode", "atr"),                     # stop_atr default 0.5 x D1 ATR
    ({"stop_mode": "atr", "stop_atr": 0.8}, None),
]


def stage2a():
    cfgs = {}
    for k, v in VARS_2A:
        if isinstance(k, dict):
            cfgs["+".join(f"{a}={b}" for a, b in k.items())] = {**BASE_2A, **k}
        else:
            cfgs[f"{k}={v}"] = {**BASE_2A, k: v}
    _grid("s2a", cfgs)


# stage 2b: factorial of the two filters that helped in 2a (trend x min range width),
# plus a range variant that includes the first London hour (range 02-11, entries to 14)
def stage2b():
    cfgs = {}
    for tn, mw in itertools.product([0, 50, 100], [0.0, 0.4, 0.5, 0.65]):
        cfgs[f"trend{tn}_minw{mw}"] = {**BASE_2A, "trend_n": tn, "min_width_atr": mw}
    for tn, mw in [(0, 0.0), (50, 0.5)]:
        cfgs[f"rng2-11_ent14_trend{tn}_minw{mw}"] = {**BASE_2A, "range_end": 11, "entry_end": 14,
                                                    "trend_n": tn, "min_width_atr": mw}
    _grid("s2b", cfgs)


STAGES = {"0": stage0, "1": stage1, "1m": stage1m, "1b": stage1b, "1c": stage1c,
          "2a": stage2a, "2b": stage2b}


# --------------------------------------------------------------------- selection
# Selected on IS only (reports/session_breakout.md, section "選定"):
#   best IS Sharpe / MAR / t-stat of all logged trials with >= 150 trades was stage 2b
#   "trend50_minw0.5" (Asian range 02-10 breakout, D1 EMA50 direction filter, range
#   >= 0.5 x D1 ATR).  Universe: the six task symbols, fixed a priori (no IS-based
#   symbol pruning, even though USDJPY / GBPJPY were ~0 in IS).
SELECTED = {**BASE_2A, "trend_n": 50, "min_width_atr": 0.5}
SELECTED_UNIVERSE = "six"

NEIGHBOURS = {  # one-at-a-time, roughly +-20..50 % (M1 execution, IS logged as trials)
    "min_width_atr": [0.4, 0.45, 0.55, 0.65], "trend_n": [30, 75, 100],
    "exit_hour": [16, 17, 19, 21], "entry_end": [12, 14, 15], "range_start": [1, 3],
    "range_end": [9, 11], "stop_frac": [0.8, 1.2], "atr_n": [10, 20], "tp_r": [3.0],
}


def n_is_trials() -> int:
    df = LOG.load()
    return int((df.period == "is").sum()) if not df.empty else 0


# ---------------------------------------------------------------- look-ahead test
class _TruncCtx:
    """Knows only data up to the close of H1 bar T; the current D1 bar is a PARTIAL
    bar built from H1 bars <= T (so using the unfinished daily bar would change the
    decision at T)."""

    def __init__(self, sym, T):
        self.symbol, self.source = sym, "oanda"
        h1 = _bars("oanda", sym, "H1")
        self._h1 = h1[h1.index <= T]
        d1 = _bars("oanda", sym, "D1")
        day = T.normalize()
        full = d1[d1.index < day]
        part = self._h1[self._h1.index >= day]
        if len(part):
            pbar = pd.DataFrame({"open": [part.open.iloc[0]], "high": [part.high.max()],
                                 "low": [part.low.min()], "close": [part.close.iloc[-1]],
                                 "volume": [part.volume.sum()]},
                                index=pd.DatetimeIndex([day], name="time"))
            full = pd.concat([full, pbar])
        self._d1 = full

    @property
    def inst(self):
        return SymbolContext(self.symbol).inst

    def bars(self, tf):
        return {"H1": self._h1, "D1": self._d1}[tf]


class _LeakyCtx:
    """Deliberately wrong context: the D1 bar of day D is re-labelled as if it had
    opened one day earlier, so it counts as 'closed' during day D itself."""

    def __init__(self, ctx):
        self._ctx, self.symbol, self.source = ctx, ctx.symbol, ctx.source

    @property
    def inst(self):
        return self._ctx.inst

    def bars(self, tf):
        b = self._ctx.bars(tf)
        return b.set_axis(b.index - pd.Timedelta(days=1)) if tf == "D1" else b


class _LeakyStrategy(SessionBreakout):
    def decisions(self, ctx):
        return super().decisions(_LeakyCtx(ctx))


def lookahead_test(strat, symbols=("GBPUSD", "EURJPY", "XAUUSD"), n_cuts=120, seed=0) -> int:
    rng = np.random.default_rng(seed)
    bad = 0
    for sym in symbols:
        full = strat.decisions(SymbolContext(sym))
        # sample decision bars in/around the trading window, where the rules act
        h = full.index.hour
        idx = full.index[(full.index > "2006-06-01") & (full.index < "2020-05-01")
                         & (h >= 8) & (h <= 18)]
        for T in rng.choice(idx, n_cuts, replace=False):
            T = pd.Timestamp(T)
            a, b = full.loc[T], strat.decisions(_TruncCtx(sym, T)).loc[T]
            for c in full.columns:
                x, y = a[c], b[c]
                same = (pd.isna(x) and pd.isna(y)) or x == y or (
                    isinstance(x, float) and isinstance(y, float) and abs(x - y) < 1e-12)
                bad += 0 if same else 1
    return bad


# ------------------------------------------------------------------------ final
def fmt_row(name, m):
    return {"period": name, "cagr": m.get("cagr"), "max_dd": m.get("max_dd"),
            "sharpe": m.get("sharpe"), "mar": m.get("mar"), "trades": m.get("trades"),
            "avg_R": m.get("avg_R"), "t_stat_R": m.get("t_stat_R"),
            "profit_factor_R": m.get("profit_factor_R"), "worst_year": m.get("worst_year"),
            "win_rate": m.get("win_rate")}


def decomp_line(name, res):
    t = res.taken
    g = t.dir * (t.exit_mid - t.entry_mid) / t.stop_dist
    tg = g.mean() / (g.std(ddof=1) / np.sqrt(len(g)))
    net = t.pnl_jpy / t.risk_jpy
    tn = net.mean() / (net.std(ddof=1) / np.sqrt(len(net)))
    return (f"{name}: gross_mid_R={g.mean():.4f} (t={tg:.2f}) R_after_spread={t.R.mean():.4f} "
            f"comm_R={(-t.commission_jpy / t.risk_jpy).mean():.4f} "
            f"swap_R={(t.swap_jpy / t.risk_jpy).mean():.4f} net_R={net.mean():.4f} (t={tn:.2f}) "
            f"hold_h={((t.exit_time - t.entry_time).dt.total_seconds() / 3600).mean():.2f} "
            f"stop_share={(t.reason == 'stop').mean():.3f} long_share={(t.dir > 0).mean():.3f}")


def final():
    pd.set_option("display.width", 250)
    pd.set_option("display.max_columns", 40)
    pd.set_option("display.float_format", "{:.4f}".format)
    uni = UNIVERSES[SELECTED_UNIVERSE]
    params = {**DEFAULTS, **SELECTED}
    strat = SessionBreakout(**params)
    print("SELECTED:", strat, "\nUNIVERSE:", SELECTED_UNIVERSE, uni)

    # 1) look-ahead checks.  The selected config uses D1 data only through two boolean
    # filters, so a D1 leak would rarely flip a decision; the ATR-sensitive variant
    # (ATR buffer on the entry price + ATR stop) exposes the D1 path at full precision,
    # and the planted-leak control proves the test can see such a leak.
    sens = {**params, "buffer_atr": 0.1, "stop_mode": "atr", "stop_atr": 0.7}
    nb = lookahead_test(strat)
    ns = lookahead_test(SessionBreakout(**sens))
    nf = lookahead_test(SessionBreakout(**{**sens, "mode": "fade", "stop_mode": "range",
                                           "tp_mode": "range"}))
    nl = lookahead_test(_LeakyStrategy(**sens), symbols=("GBPUSD",), n_cuts=120)
    print(f"\nlook-ahead truncation test: selected mismatches={nb}, ATR-sensitive variant={ns}, "
          f"fade variant={nf} (all must be 0); planted-leak control: mismatches={nl} "
          f"(must be > 0)")

    # 2) trial log summary (selection pool)
    df = LOG.load()
    is_df = df[df.period == "is"]
    pool = is_df[is_df["params.stage"] != "nbr"]
    print(f"\nIS selection-pool trials (stages 0..2b): {len(pool)}; IS trials in log incl. "
          f"post-selection neighbours: {len(is_df)}")
    lb = pool[pool["metrics.trades"] >= MIN_IS_TRADES].sort_values(
        "metrics.sharpe", ascending=False).head(8)
    cols = ["params.stage", "params.mode", "params.range_start", "params.range_end",
            "params.entry_end", "params.exit_hour", "params.stop_frac", "params.trend_n",
            "params.min_width_atr", "params.exec", "metrics.sharpe", "metrics.mar",
            "metrics.t_stat_R", "metrics.trades"]
    print("top IS selection-pool trials by Sharpe (trades >= 150):")
    print(lb[[c for c in cols if c in lb]].to_string(index=False))

    # 3) main evaluations: standard engine (H1 fills) and M1 fills
    ev = evaluate(strat, uni, periods=("is", "oos", "full"))
    ev2 = evaluate(strat, uni, periods=("is", "oos"), cost_mult=2.0)
    em = evaluate_m1(strat, uni, periods=("is", "oos", "full"))
    em2 = evaluate_m1(strat, uni, periods=("is", "oos"), cost_mult=2.0)
    res_is, res_oos, res_full = ev["is"]["_result"], ev["oos"]["_result"], ev["full"]["_result"]

    # neighbours (IS logged as trials before the DSR is computed; OOS for reporting only)
    known, known_oos = _logged_keys("is"), _logged_keys("oos")
    nrows = []
    for k, vals in NEIGHBOURS.items():
        for v in vals:
            p = {**SELECTED, k: v}
            e = evaluate_m1(SessionBreakout(**{**DEFAULTS, **p}), uni, periods=("is", "oos"))
            e["is"].pop("_result")
            e["oos"].pop("_result")
            lp = {**DEFAULTS, **p, "universe": SELECTED_UNIVERSE, "exec": "M1"}
            if _norm_params(lp) not in known:
                LOG.log({**lp, "stage": "nbr"}, e["is"], "is")
            if _norm_params(lp) not in known_oos:
                LOG.log({**lp, "stage": "nbr"}, e["oos"], "oos")
            nrows.append({"param": k, "value": v, "is_sharpe": e["is"]["sharpe"],
                          "is_avgR": e["is"]["avg_R"], "is_trades": e["is"]["trades"],
                          "oos_sharpe": e["oos"]["sharpe"], "oos_avgR": e["oos"]["avg_R"],
                          "oos_cagr": e["oos"]["cagr"], "oos_maxdd": e["oos"]["max_dd"]})
    n_trials = n_is_trials()
    dsr = dsr_for(ev["is"], res_is, n_trials)
    dsr_m1 = dsr_for(em["is"], em["is"]["_result"], n_trials)

    lp = {**params, "universe": SELECTED_UNIVERSE}
    for per, m in [("oos", ev["oos"]), ("is_cost2x", ev2["is"]), ("oos_cost2x", ev2["oos"])]:
        if _norm_params(lp) not in _logged_keys(per):
            LOG.log({**lp, "stage": "final"}, m, per)
    lpm = {**lp, "exec": "M1"}
    for per, m in [("oos", em["oos"]), ("is_cost2x", em2["is"]), ("oos_cost2x", em2["oos"])]:
        if _norm_params(lpm) not in _logged_keys(per):
            LOG.log({**lpm, "stage": "final"}, m, per)

    rows = [fmt_row("is", ev["is"]), fmt_row("oos", ev["oos"]), fmt_row("is_cost2x", ev2["is"]),
            fmt_row("oos_cost2x", ev2["oos"]), fmt_row("full_2005_2020", ev["full"])]
    print("\n=== FINAL TABLE: standard engine (H1 fills), 1% risk per trade, 500,000 JPY start ===")
    print(pd.DataFrame(rows).to_string(index=False))
    print(f"DSR (IS, n_trials={n_trials}): {dsr:.4f}")
    rows_m = [fmt_row("is_M1", em["is"]), fmt_row("oos_M1", em["oos"]),
              fmt_row("is_cost2x_M1", em2["is"]), fmt_row("oos_cost2x_M1", em2["oos"]),
              fmt_row("full_M1", em["full"])]
    print("\n=== same config, M1 fills (selection basis) ===")
    print(pd.DataFrame(rows_m).to_string(index=False))
    print(f"DSR (IS M1, n_trials={n_trials}): {dsr_m1:.4f}")
    print("FRED periods: not applicable (H1 intraday strategy; FRED is daily close-only)")

    print("\n=== R decomposition per trade (standard engine) ===")
    for name, r in [("is", res_is), ("oos", res_oos)]:
        print(decomp_line(name, r))
    print(decomp_line("is_M1", em["is"]["_result"]))
    print(decomp_line("oos_M1", em["oos"]["_result"]))

    # 4) per symbol / per year / per side
    print("\n=== per-symbol R: IS ===")
    print(per_symbol_R(res_is).to_string())
    print("\n=== per-symbol R: OOS ===")
    print(per_symbol_R(res_oos).to_string())
    t = res_full.taken
    yr = pd.DataFrame({"ret": per_year(res_full),
                       "trades": t.groupby(t.entry_time.dt.year).size(),
                       "avg_R": t.groupby(t.entry_time.dt.year).R.mean()})
    print("\n=== per-year (full 2005-2020, 1% risk, standard engine) ===")
    print(yr.to_string())
    for side, g in [("long", t[t.dir > 0]), ("short", t[t.dir < 0])]:
        a = g.groupby(np.where(g.entry_time.dt.year < 2015, "IS", "OOS")).R.agg(["mean", "size"])
        print(f"{side:5s} avg_R:", a.round(4).to_dict("index"))

    # 5) neighbours table
    print("\n=== neighbours (one-at-a-time, M1 fills; OOS shown for robustness reporting only) ===")
    print(f"selected (M1): is_sharpe={em['is']['sharpe']:.4f} oos_sharpe={em['oos']['sharpe']:.4f}")
    nd = pd.DataFrame(nrows)
    print(nd.to_string(index=False))
    print(f"neighbours with IS Sharpe > 0: {(nd.is_sharpe > 0).sum()}/{len(nd)}; "
          f"OOS avg_R > 0: {(nd.oos_avgR > 0).sum()}/{len(nd)}; "
          f"OOS Sharpe > 0: {(nd.oos_sharpe > 0).sum()}/{len(nd)}")
    print(f"IS trials logged (total, used for DSR): {n_trials}")

    # 5b) post-selection diagnostics (reported, never used to choose): does the raw
    # phenomenon survive OOS?  unfiltered Asian breakout and the best IS fade.
    print("\n=== diagnostics: IS vs OOS of the unfiltered base breakout and the best IS fade "
          "(M1 fills) ===")
    diag = {"base_breakout_unfiltered": BASE_2A,
            "best_fade_rng2-9_ent13_x23": dict(mode="fade", range_start=2, range_end=9,
                                               entry_end=13, exit_hour=23, stop_mode="range",
                                               tp_mode="none")}
    known_oos = _logged_keys("oos")
    for name, dp in diag.items():
        e = evaluate_m1(SessionBreakout(**{**DEFAULTS, **dp}), uni, periods=("is", "oos"))
        for per in ("is", "oos"):
            r = e[per].pop("_result")
            print(f"{name:28s} {per:3s} sharpe={e[per]['sharpe']:.3f} cagr={e[per]['cagr']:.3f} "
                  f"trades={e[per]['trades']} | {decomp_line(per, r)}")
        lp = {**DEFAULTS, **dp, "universe": SELECTED_UNIVERSE, "exec": "M1"}
        if _norm_params(lp) not in known_oos:
            LOG.log({**lp, "stage": "diag"}, e["oos"], "oos")

    # 6) deliverables (standard engine, full 2005-2020, 1% risk)
    out = ROOT / "reports"
    (out / "equity").mkdir(parents=True, exist_ok=True)
    (out / "trades").mkdir(parents=True, exist_ok=True)
    res_full.equity.to_frame("equity").to_parquet(out / "equity" / f"{FAMILY}.parquet")
    tk = res_full.taken.copy()
    tk["reason"] = tk["reason"].astype(str)
    tk["skip_reason"] = tk["skip_reason"].astype(str)
    tk.to_parquet(out / "trades" / f"{FAMILY}.parquet")
    print(f"\nwrote reports/equity/{FAMILY}.parquet ({len(res_full.equity)} days) and "
          f"reports/trades/{FAMILY}.parquet ({len(tk)} trades)")


# --------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", default=None, help="re-run an IS search stage: " + ",".join(STAGES))
    args = ap.parse_args()
    if args.stage:
        t0 = time.time()
        STAGES[args.stage]()
        print(f"stage {args.stage} done in {time.time() - t0:.0f}s; trials logged: {LOG.count()}")
        return
    final()


if __name__ == "__main__":
    main()
