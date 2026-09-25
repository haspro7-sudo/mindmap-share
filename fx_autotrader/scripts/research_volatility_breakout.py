"""Research script for the volatility_breakout family (compression -> expansion, D1/H4).

    python scripts/research_volatility_breakout.py             # final evaluation + table
    python scripts/research_volatility_breakout.py --stage 1   # re-run an IS search stage
                                                               # (appends new trials only)

Stages (in-sample 2005-2014 ONLY, all 16 OANDA symbols, every parameter set logged
with TrialLog('volatility_breakout'); identical settings are never logged twice):
    0   the two smoke-test configurations (NR7 + 3 ATR trail, D1 and H4)          (2)
    1   structure grid: TF {D1,H4} x setup {NR4, NR7, inside bar, ID/NR4, BB squeeze,
        ATR-ratio} x exit style {1-day time exit, 1.5R target + 5-day time stop,
        2.5 ATR chandelier trail + time stop}                                   (36)
    2   one-at-a-time variations around the three leading stage-1 structures
        (H4 ATR-ratio / H4 BB-squeeze with a 1-day box, D1 ID/NR4; 1-day time exit) (35)
    3   H4 ATR-ratio: threshold {0.5,0.55,0.6,0.65} x box {6,12} factorial, then
        one-at-a-time knobs at threshold 0.6                                     (20)
    nbr one-at-a-time IS neighbours (+-20..50 %) of the selected config            (21 new)
The final mode re-evaluates the selected config with the standard harness
(fxlab.research.evaluate -> engine with M1 resolution of stop-entry fills) on IS,
OOS, FRED pre-sample / FRED OOS (D1 only) and cost x2, then runs neighbour,
per-symbol and per-year robustness, a look-ahead truncation test, and writes the
deliverables (reports/equity, reports/trades: full 2005-2020, 1% risk).

Speed: the standard harness reloads each symbol's M1 file for every evaluation
(backtest.m1_server_bars keeps only 4 in its LRU cache).  For the IS search we keep
all 16 M1 frames in memory and call the SAME shared functions (simulate_symbol with
the same M1 frame, then backtest(..., trades_cache=...)).  `check_fast_path` shows
this reproduces fxlab.research.evaluate exactly.
"""
from __future__ import annotations

import argparse
import itertools
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
from fxlab.backtest import SymbolContext  # noqa: E402
from fxlab.engine import simulate_symbol  # noqa: E402
from fxlab.research import (ALL_OANDA, TrialLog, _short, dsr_for, evaluate,  # noqa: E402
                            per_symbol_R, per_year, research_config)
from fxlab.strategies.volatility_breakout import VolatilityBreakout  # noqa: E402

FAMILY = "volatility_breakout"
UNIVERSE = list(ALL_OANDA)          # all 16 symbols, never narrowed
MIN_IS_TRADES = 150
LOG = TrialLog(FAMILY)
KEYS = ["cagr", "max_dd", "sharpe", "mar", "trades", "avg_R", "t_stat_R", "profit_factor_R",
        "worst_year"]

DEFAULTS = dict(VolatilityBreakout().params())


# ----------------------------------------------------------------- fast IS path
@lru_cache(maxsize=None)
def m1(sym: str) -> pd.DataFrame:
    return B.m1_server_bars.__wrapped__(sym)   # same function, unbounded cache


def trades_for(strategy, symbols) -> dict:
    """Identical to backtest.symbol_trades(strategy, s, 'oanda') for every symbol."""
    out = {}
    for s in symbols:
        ctx = SymbolContext(s, "oanda")
        dec = strategy.decisions(ctx)
        fine = m1(s) if B._uses_stop_orders(dec) else None
        out[s] = simulate_symbol(dec, strategy.tf, ctx.bars("H1"), fine_bars=fine)
    return out


def fast_is(strategy, symbols=UNIVERSE, cost_mult=1.0):
    trades = trades_for(strategy, symbols)
    res, s = B.backtest(strategy, symbols, B.IS_START, B.IS_END,
                        research_config(cost_mult=cost_mult), trades_cache=dict(trades))
    m = _short(s)
    m["_result"] = res
    return m


def r_decomp(res) -> dict:
    """gross mid-price R, R after spread/slippage, net R incl. commission + swap."""
    t = res.taken
    if len(t) == 0:
        return {"gross_R": np.nan, "gross_t": np.nan, "net_R": np.nan}
    g = t.dir * (t.exit_mid - t.entry_mid) / t.stop_dist
    return {"gross_R": float(g.mean()),
            "gross_t": float(g.mean() / (g.std(ddof=1) / np.sqrt(len(g)))),
            "net_R": float((t.pnl_jpy / t.risk_jpy).mean())}


def all_signal_R(res) -> dict:
    """gross mid R over ALL simulated trades (taken or not) - sizing-free diagnostic."""
    t = res.trades
    if len(t) == 0:
        return {"sig_n": 0, "sig_gross_R": np.nan}
    g = t.dir * (t.exit_mid - t.entry_mid) / t.stop_dist
    return {"sig_n": int(len(t)), "sig_gross_R": float(g.mean()),
            "sig_R": float(t.R.mean())}


# ------------------------------------------------------------------ trial log
def _norm_params(p: dict) -> str:
    out = {}
    for k, v in p.items():
        if k == "stage" or v is None or (isinstance(v, float) and np.isnan(v)):
            continue
        out[k] = v if isinstance(v, (bool, np.bool_, str)) else float(v)
    return json.dumps(out, sort_keys=True, default=str)


def _logged(period="is") -> dict:
    if not LOG.path.exists():
        return {}
    recs = [json.loads(x) for x in open(LOG.path)]
    return {_norm_params(r["params"]): r for r in recs if r["period"] == period}


def full_params(p: dict) -> dict:
    return {**DEFAULTS, **p, "universe": "all16"}


def run_is(p: dict, stage: str = "", log: bool = True) -> dict:
    fp = full_params(p)
    strat = VolatilityBreakout(**{k: v for k, v in fp.items() if k != "universe"})
    m = fast_is(strat)
    res = m.pop("_result")
    m.update(r_decomp(res))
    m.update(all_signal_R(res))
    if log and _norm_params(fp) not in _logged("is"):
        LOG.log({**fp, "stage": stage}, m, "is")
    return m


def show(rows, sort="sharpe", top=None):
    df = pd.DataFrame(rows).sort_values(sort, ascending=False)
    if top:
        df = df.head(top)
    with pd.option_context("display.width", 250, "display.max_columns", 40,
                           "display.float_format", "{:.3f}".format):
        print(df.to_string(index=False))
    return df


def _grid(stage, configs: dict):
    rows = []
    for name, p in configs.items():
        t0 = time.time()
        m = run_is(p, stage=stage)
        row = {"cfg": name, **{k: m.get(k) for k in KEYS},
               **{k: m.get(k) for k in ("gross_R", "gross_t", "net_R", "sig_n", "sig_gross_R")}}
        rows.append(row)
        print(f"{name:55s} sh={row['sharpe']:.2f} cagr={row['cagr']:.3f} dd={row['max_dd']:.2f} "
              f"n={row['trades']} R={row['avg_R']:.3f} gR={row['gross_R']:.3f} "
              f"sigR={row['sig_gross_R']:.3f} ({time.time() - t0:.0f}s)", flush=True)
    print(f"\n=== stage {stage} (IS 2005-2014, all 16) ===")
    show(rows)
    return rows


# --------------------------------------------------------------------- stages
# per-timeframe scaling so that a structure means the same in "days"
TF_SCALE = {
    "D1": dict(valid_bars=1, box_n=5, atr_s=5, atr_l=60, day=1),
    "H4": dict(valid_bars=3, box_n=6, atr_s=6, atr_l=120, day=6),
}
SETUPS = {
    "nr4": dict(setup="nr", nr_n=4),
    "nr7": dict(setup="nr", nr_n=7),
    "inside": dict(setup="inside"),
    "idnr4": dict(setup="nr_inside", nr_n=4),
    "squeeze": dict(setup="squeeze", sq_thr=0.7, sq_long=120, bb_n=20),
    "atrratio": dict(setup="atr_ratio", ar_thr=0.7),
}


def exits(tf: str) -> dict:
    day = TF_SCALE[tf]["day"]
    return {
        "time1d": dict(max_hold=1 * day),
        "tp1.5": dict(tp_r=1.5, max_hold=5 * day),
        "trail2.5": dict(trail_atr=2.5, max_hold=20 if tf == "D1" else 60),
    }


def stage1_configs() -> dict:
    cfgs = {}
    for tf, (sn, sp), in itertools.product(["D1", "H4"], SETUPS.items()):
        sc = {k: v for k, v in TF_SCALE[tf].items() if k != "day"}
        for en, ep in exits(tf).items():
            cfgs[f"{tf}_{sn}_{en}"] = dict(tf=tf, **sc, **sp, **ep, stop_mode="range",
                                           min_stop_atr=0.3)
    return cfgs


def stage0():
    """The two smoke-test configurations evaluated on IS before the grid (logged too)."""
    return _grid("s0", {
        "D1_nr7_trail3_mh20": dict(tf="D1", setup="nr", nr_n=7, trail_atr=3.0, max_hold=20),
        "H4_nr7_trail3_mh30_floor0.5": dict(tf="H4", setup="nr", nr_n=7, trail_atr=3.0,
                                            max_hold=30, min_stop_atr=0.5)})


def stage1():
    return _grid("s1", stage1_configs())


# stage 2: one-at-a-time variations around the leading stage-1 structures
BASE_H4_ATR = dict(tf="H4", setup="atr_ratio", ar_thr=0.7, atr_s=6, atr_l=120, box_n=6,
                   valid_bars=3, stop_mode="range", min_stop_atr=0.3, max_hold=6)
BASE_H4_SQ = dict(tf="H4", setup="squeeze", sq_thr=0.7, sq_long=120, bb_n=20, box_n=6,
                  valid_bars=3, stop_mode="range", min_stop_atr=0.3, max_hold=6)
BASE_D1_IDNR4 = dict(tf="D1", setup="nr_inside", nr_n=4, valid_bars=1, stop_mode="range",
                     min_stop_atr=0.3, max_hold=1)
VARS_2 = {
    "h4atr": (BASE_H4_ATR, [
        {"ar_thr": 0.6}, {"ar_thr": 0.8}, {"box_n": 3}, {"box_n": 12}, {"valid_bars": 1},
        {"valid_bars": 6}, {"max_hold": 3}, {"max_hold": 12}, {"buffer_atr": 0.1},
        {"buffer_atr": 0.25}, {"stop_mode": "atr", "stop_atr": 2.0}, {"min_stop_atr": 1.0},
        {"trend_n": 120}, {"tp_r": 1.0}, {"trail_atr": 2.0}, {"atr_l": 60}]),
    "h4sq": (BASE_H4_SQ, [
        {"sq_thr": 0.6}, {"sq_thr": 0.8}, {"box_n": 3}, {"box_n": 12}, {"valid_bars": 1},
        {"valid_bars": 6}, {"max_hold": 3}, {"max_hold": 12}, {"buffer_atr": 0.1},
        {"trend_n": 120}]),
    "d1idnr4": (BASE_D1_IDNR4, [
        {"max_hold": 2}, {"max_hold": 3}, {"buffer_atr": 0.1}, {"valid_bars": 2},
        {"min_stop_atr": 0.5}, {"stop_mode": "atr", "stop_atr": 1.0}, {"trend_n": 50},
        {"tp_r": 1.0}, {"setup": "inside", "inside_range": "mother"}]),
}


def stage2():
    cfgs = {}
    for name, (base, vars_) in VARS_2.items():
        for v in vars_:
            tag = "_".join(f"{k}{val}" for k, val in v.items())
            cfgs[f"{name}:{tag}"] = {**base, **v}
    return _grid("s2", cfgs)


# stage 3: the ATR-ratio threshold was by far the strongest knob in stage 2; map it
# jointly with the box length, then one-at-a-time knobs at the threshold 0.6
def stage3():
    cfgs = {}
    for thr, box in itertools.product([0.5, 0.55, 0.6, 0.65], [6, 12]):
        cfgs[f"h4atr:thr{thr}_box{box}"] = {**BASE_H4_ATR, "ar_thr": thr, "box_n": box}
    b6 = {**BASE_H4_ATR, "ar_thr": 0.6}
    for v in [{"trend_n": 120}, {"trail_atr": 2.0}, {"valid_bars": 1}, {"valid_bars": 6},
              {"max_hold": 3}, {"max_hold": 12}, {"buffer_atr": 0.1}, {"atr_l": 60},
              {"atr_l": 240}, {"atr_s": 3}, {"atr_s": 12}, {"min_stop_atr": 1.0}]:
        tag = "_".join(f"{k}{val}" for k, val in v.items())
        cfgs[f"h4atr0.6:{tag}"] = {**b6, **v}
    return _grid("s3", cfgs)


# ------------------------------------------------------------- selected config
# chosen on IS only: best IS Sharpe / MAR / t-stat of the threshold-0.6 family
# (stage 3), with its unbuffered neighbour also strong (IS Sharpe 0.74)
SELECTED = {**BASE_H4_ATR, "ar_thr": 0.6, "buffer_atr": 0.1}
# one-at-a-time neighbours (roughly +-20..50 % of each parameter)
NEIGHBOURS = [
    {"ar_thr": 0.5}, {"ar_thr": 0.55}, {"ar_thr": 0.65}, {"ar_thr": 0.7},
    {"atr_s": 4}, {"atr_s": 9}, {"atr_l": 60}, {"atr_l": 90}, {"atr_l": 180},
    {"box_n": 4}, {"box_n": 9}, {"max_hold": 4}, {"max_hold": 9},
    {"valid_bars": 2}, {"valid_bars": 4}, {"buffer_atr": 0.0}, {"buffer_atr": 0.05},
    {"buffer_atr": 0.15}, {"buffer_atr": 0.2}, {"min_stop_atr": 0.15},
    {"min_stop_atr": 0.5}, {"trail_atr": 2.0},
]


def nbr_name(v: dict) -> str:
    return "_".join(f"{k}={val}" for k, val in v.items())


def stage_nbr():
    """IS neighbourhood of the selected config (logged; decides nothing new)."""
    cfgs = {"SELECTED": SELECTED}
    for v in NEIGHBOURS:
        cfgs[nbr_name(v)] = {**SELECTED, **v}
    return _grid("nbr", cfgs)


STAGES = {"0": stage0, "1": stage1, "2": stage2, "3": stage3, "nbr": stage_nbr}


# ---------------------------------------------------------------------- main
PERIOD_SPANS = {"is": (B.IS_START, B.IS_END), "oos": (B.OOS_START, B.OOS_END),
                "full": (B.IS_START, B.OOS_END)}
EQUITY_OUT = ROOT / "reports" / "equity" / f"{FAMILY}.parquet"
TRADES_OUT = ROOT / "reports" / "trades" / f"{FAMILY}.parquet"
OUT_KEYS = ["cagr", "max_dd", "sharpe", "trades", "avg_R", "t_stat_R", "profit_factor_R",
            "worst_year"]


def make(p: dict) -> VolatilityBreakout:
    fp = full_params(p)
    return VolatilityBreakout(**{k: v for k, v in fp.items() if k != "universe"})


def fast_period(strategy, period, trades=None, cfg=None):
    trades = trades if trades is not None else trades_for(strategy, UNIVERSE)
    a, b = PERIOD_SPANS[period]
    res, s = B.backtest(strategy, UNIVERSE, a, b, cfg or research_config(),
                        trades_cache=dict(trades))
    m = _short(s)
    m["_result"] = res
    return m


def check_fast_path(p: dict) -> bool:
    strat = make(p)
    a = fast_period(strat, "is")
    b = evaluate(strat, UNIVERSE, periods=("is",))["is"]
    same = all(a[k] == b[k] for k in ("final", "trades", "sharpe", "avg_R"))
    print(f"fast path == fxlab.research.evaluate(): {same}  "
          f"(IS final {a['final']:,.2f} vs {b['final']:,.2f})")
    return same


class _TruncCtx:
    """Context whose bars end at `cut` (to prove decisions never use later bars)."""

    def __init__(self, symbol, cut):
        self.symbol, self.source, self.cut = symbol, "oanda", pd.Timestamp(cut)

    def bars(self, tf):
        b = SymbolContext(self.symbol).bars(tf)
        return b[b.index < self.cut]


def lookahead_test(strategy, symbols=("EURUSD", "USDJPY", "XAUUSD", "GBPAUD"),
                   cuts=("2008-03-12 13:00", "2011-08-05", "2014-12-31 21:00",
                         "2018-06-20 09:00")) -> bool:
    ok = True
    for s in symbols:
        full = strategy.decisions(SymbolContext(s))
        for c in cuts:
            tr = strategy.decisions(_TruncCtx(s, c))
            f = full.loc[tr.index]
            same = all(np.array_equal(f[col].to_numpy(), tr[col].to_numpy(), equal_nan=True)
                       if f[col].dtype.kind == "f" else (f[col].to_numpy() == tr[col].to_numpy()).all()
                       for col in f.columns)
            ok &= bool(same)
    print(f"look-ahead truncation test (decisions on data cut at {len(cuts)} dates x "
          f"{len(symbols)} symbols identical to full-data decisions): {ok}")
    return ok


def fmt_row(name, m):
    return (f"| {name} | {m['cagr']:.1%} | {m['max_dd']:.1%} | {m['sharpe']:.2f} | "
            f"{m['trades']} | {m['avg_R']:+.3f} | {m['t_stat_R']:.2f} | "
            f"{m['profit_factor_R']:.2f} | {m['worst_year']:.1%} |")


def trade_diag(res, label):
    t = res.taken.copy()
    t["net"] = t.pnl_jpy / t.risk_jpy
    g = t.dir * (t.exit_mid - t.entry_mid) / t.stop_dist
    top = (f"{t.net.nlargest(max(1, len(t) // 100)).sum() / t.net.sum():.0%}"
           if t.net.sum() > 0 else "n/a (total net R <= 0)")
    print(f"  {label}: gross mid R {g.mean():+.3f} (t={g.mean() / g.std() * np.sqrt(len(g)):.2f}) "
          f"| after spread/slip {t.R.mean():+.3f} | net (comm+swap) {t.net.mean():+.3f} | "
          f"win {(t.net > 0).mean():.1%} | long {t.net[t.dir > 0].mean():+.3f} "
          f"(n={int((t.dir > 0).sum())}) short {t.net[t.dir < 0].mean():+.3f} "
          f"(n={int((t.dir < 0).sum())}) | exits {t.reason.value_counts().to_dict()} | "
          f"top1% trades share of net R {top} | avg hold "
          f"{((t.exit_time - t.entry_time).dt.total_seconds() / 3600).mean():.1f} h")


def is_diagnostics(res):
    """Artefact checks on the IS trades (weekday / holiday / gap fills / M1-gap fills)."""
    from fxlab import data as D
    t = res.taken.copy()
    t["net"] = t.pnl_jpy / t.risk_jpy
    wd = t.groupby(t.entry_time.dt.dayofweek).net.agg(["size", "mean"])
    print("  entries by weekday (Mon=0):", {int(k): int(v) for k, v in wd["size"].items()},
          "net R:", {int(k): round(v, 3) for k, v in wd["mean"].items()})
    hol = (((t.entry_time.dt.month == 12) & (t.entry_time.dt.day >= 20)) |
           ((t.entry_time.dt.month == 1) & (t.entry_time.dt.day <= 7)))
    print(f"  holiday window (Dec20-Jan7): n={int(hol.sum())} net R {t.net[hol].mean():+.4f} | "
          f"rest n={int((~hol).sum())} net R {t.net[~hol].mean():+.4f}")
    print(f"  stop-entry filled at a gapped open: {t.entry_at_open.mean():.1%}")
    # engine fills intrabar stop orders at the level even if the M1 bar opened beyond
    # it; re-price those fills (and intrabar stop-loss exits) at the M1 open
    ge_all, gx_all = [], []
    for sym, g in t.groupby("symbol"):
        mm = pd.read_parquet(D.m1_path(sym), columns=["open", "high", "low"])
        mm.index = D.to_server_time(mm.index)
        mm = mm[~mm.index.duplicated(keep="first")]
        iv = mm.index.values
        for r in g.itertuples():
            ge = gx = 0.0
            fill_t = None
            if r.stop_entry and not r.entry_at_open:
                a, b = np.searchsorted(iv, [r.entry_time.to_datetime64(),
                                            (r.entry_time + pd.Timedelta(hours=1)).to_datetime64()])
                sl = mm.iloc[a:b]
                hit = sl[sl.high >= r.entry_mid] if r.dir > 0 else sl[sl.low <= r.entry_mid]
                if len(hit):
                    fill_t = hit.index[0]
                    ge = max(0.0, (hit.open.iloc[0] - r.entry_mid) * r.dir)
            if r.reason == "stop" and not r.exit_at_open:
                a, b = np.searchsorted(iv, [r.exit_time.to_datetime64(),
                                            (r.exit_time + pd.Timedelta(hours=1)).to_datetime64()])
                sl = mm.iloc[a:b]
                if fill_t is not None and r.exit_time == r.entry_time:
                    sl = sl[sl.index >= fill_t]
                hit = sl[sl.low <= r.exit_mid] if r.dir > 0 else sl[sl.high >= r.exit_mid]
                if len(hit):
                    gx = max(0.0, (r.exit_mid - hit.open.iloc[0]) * r.dir)
            ge_all.append(ge / r.stop_dist)
            gx_all.append(gx / r.stop_dist)
        del mm
    print(f"  M1-gap re-pricing of intrabar fills: entries {np.mean(ge_all):+.4f} R, "
          f"stop exits {np.mean(gx_all):+.4f} R (total optimism "
          f"{np.mean(ge_all) + np.mean(gx_all):.4f} R per trade)")


def final():
    from scipy import stats as st_

    from fxlab.engine import PortfolioConfig, RiskSchedule
    from fxlab.instruments import CostModel
    from fxlab.metrics import ANN, deflated_sharpe

    t0 = time.time()
    print(f"selected: {json.dumps(full_params(SELECTED), sort_keys=True)}")
    check_fast_path(SELECTED)
    strat = make(SELECTED)
    lookahead_test(strat)

    ev = evaluate(strat, UNIVERSE, periods=("is", "oos", "full"))
    ev2 = evaluate(strat, UNIVERSE, periods=("is", "oos"), cost_mult=2.0)
    slip_cfg = PortfolioConfig(initial_jpy=500_000, risk=RiskSchedule(base_risk=0.01),
                               costs=CostModel(stop_slip_scale=3.0))
    ev3 = evaluate(strat, UNIVERSE, periods=("is", "oos"), cfg=slip_cfg)

    n_trials = LOG.count()
    trials = LOG.load()
    tr_is = trials[trials.period == "is"]
    dsr = dsr_for(ev["is"], ev["is"]["_result"], n_trials)
    r = ev["is"]["_result"].equity.pct_change().dropna()
    sr_var_emp = float(tr_is["metrics.sharpe"].var()) / ANN
    dsr_emp = deflated_sharpe(ev["is"]["sharpe"], len(r), n_trials, float(st_.skew(r)),
                              float(st_.kurtosis(r, fisher=False)), sr_var_trials=sr_var_emp)

    print("\n## Final table (1% risk per trade, 500,000 JPY start, all 16 symbols)\n")
    print("| period | CAGR | maxDD | Sharpe | trades | avg R (net) | t(R) | PF(R) | worst year |")
    print("|---|---|---|---|---|---|---|---|---|")
    rows = [("IS 2005-2014", ev["is"]), ("OOS 2015-2020/05", ev["oos"]),
            ("IS cost x2", ev2["is"]), ("OOS cost x2", ev2["oos"]),
            ("IS stop-slippage x3", ev3["is"]), ("OOS stop-slippage x3", ev3["oos"]),
            ("full 2005-2020/05", ev["full"])]
    for name, m in rows:
        print(fmt_row(name, m))
    print("| FRED pre / FRED OOS | n/a: H4 strategy, FRED data are daily close-only |"
          " | | | | | | |")
    print(f"\ntrials logged: {n_trials} | IS trial Sharpe: median "
          f"{tr_is['metrics.sharpe'].median():.2f}, sd {tr_is['metrics.sharpe'].std():.2f}, "
          f"share > 0 {(tr_is['metrics.sharpe'] > 0).mean():.0%}")
    print(f"DSR (IS, {n_trials} trials, default trial-SR spread 0.5): {dsr:.4f} | "
          f"DSR with empirical trial-SR variance: {dsr_emp:.4f}")

    print("\n## R decomposition")
    for p in ("is", "oos"):
        trade_diag(ev[p]["_result"], p.upper())

    print("\n## IS artefact diagnostics")
    is_diagnostics(ev["is"]["_result"])

    print("\n## Per year (equity return, full 2005-2020/05 run)")
    py = per_year(ev["full"]["_result"])
    print(" ".join(f"{y}:{v:+.1%}" for y, v in py.items()))

    print("\n## Per symbol (avg R after spread/slippage, excl. commission/swap)")
    ps_is = per_symbol_R(ev["is"]["_result"])
    ps_oos = per_symbol_R(ev["oos"]["_result"])
    ps = ps_is[["n", "avg_R", "sum_R"]].join(ps_oos[["n", "avg_R", "sum_R"]],
                                             lsuffix="_is", rsuffix="_oos", how="outer")
    with pd.option_context("display.width", 200, "display.float_format", "{:.3f}".format):
        print(ps.sort_values("sum_R_is").to_string())
    print(f"symbols with sum_R > 0: IS {(ps_is.sum_R > 0).sum()}/16, "
          f"OOS {(ps_oos.sum_R > 0).sum()}/16, both {((ps.sum_R_is > 0) & (ps.sum_R_oos > 0)).sum()}")

    print("\n## Neighbours (IS from the trial log, OOS for reporting only)")
    logged = _logged("is")
    rows = []
    for v in [{}] + NEIGHBOURS:
        p = {**SELECTED, **v}
        rec = logged.get(_norm_params(full_params(p)))
        m_is = rec["metrics"] if rec else run_is(p, stage="nbr")
        m_oos = fast_period(make(p), "oos")
        rows.append({"variant": nbr_name(v) or "SELECTED", "is_sharpe": m_is["sharpe"],
                     "is_avgR": m_is["avg_R"], "is_n": m_is["trades"],
                     "oos_sharpe": m_oos["sharpe"], "oos_cagr": m_oos["cagr"],
                     "oos_avgR": m_oos["avg_R"], "oos_n": m_oos["trades"]})
    nb = pd.DataFrame(rows)
    with pd.option_context("display.width", 200, "display.float_format", "{:.3f}".format):
        print(nb.to_string(index=False))
    print(f"neighbours with OOS Sharpe > 0: {(nb.oos_sharpe[1:] > 0).sum()}/{len(nb) - 1}, "
          f"OOS avg R > 0: {(nb.oos_avgR[1:] > 0).sum()}/{len(nb) - 1}")

    # deliverables (full 2005-01 .. 2020-05, 1% risk, standard engine)
    EQUITY_OUT.parent.mkdir(parents=True, exist_ok=True)
    TRADES_OUT.parent.mkdir(parents=True, exist_ok=True)
    res_full = ev["full"]["_result"]
    res_full.equity.to_frame("equity").to_parquet(EQUITY_OUT)
    res_full.taken.to_parquet(TRADES_OUT)
    print(f"\nwrote {EQUITY_OUT.relative_to(ROOT)} ({len(res_full.equity)} days) and "
          f"{TRADES_OUT.relative_to(ROOT)} ({len(res_full.taken)} trades)")

    summary = {k: {x: ev_[p][x] for x in OUT_KEYS} for k, (ev_, p) in {
        "is": (ev, "is"), "oos": (ev, "oos"), "is_cost2x": (ev2, "is"),
        "oos_cost2x": (ev2, "oos")}.items()}
    print("\nJSON " + json.dumps({"metrics": summary, "dsr_is": dsr, "dsr_is_emp": dsr_emp,
                                  "n_trials": n_trials}, default=float))
    print(f"done in {time.time() - t0:.0f}s")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", default=None, choices=sorted(STAGES))
    args = ap.parse_args()
    if args.stage:
        STAGES[args.stage]()
        print(f"trials logged so far: {LOG.count()}")
        return
    final()


if __name__ == "__main__":
    main()
