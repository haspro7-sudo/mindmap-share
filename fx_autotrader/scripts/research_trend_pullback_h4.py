"""Research script for the trend_pullback_h4 family.

    python scripts/research_trend_pullback_h4.py            # final evaluation + table
    python scripts/research_trend_pullback_h4.py --stage 1  # re-run an IS search stage
                                                            # (appends to the trial log)

Stages (in-sample 2005-2014 ONLY, every parameter set logged with TrialLog):
    1  structure grid: 3 D1 trend filters x 4 H4 pullback entries x 2 exit styles
    2  parameter refinement around the best structures
    3  universe choice for the chosen parameters
The final mode evaluates the selected config on IS / OOS / cost x2, runs neighbour,
per-symbol and per-year robustness, the look-ahead truncation test, and writes the
deliverables (reports/equity, reports/trades).
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

from fxlab.backtest import SymbolContext, _bars  # noqa: E402
from fxlab.research import (ALL_OANDA, FX_CROSSES, FX_MAJORS, TrialLog, dsr_for,  # noqa: E402
                            evaluate, per_symbol_R, per_year)
from fxlab.strategies.trend_pullback_h4 import TrendPullbackH4  # noqa: E402

FAMILY = "trend_pullback_h4"
JPY_CROSSES = ["EURJPY", "GBPJPY", "AUDJPY", "CADJPY"]
UNIVERSES = {
    "maj_jpy9": FX_MAJORS + JPY_CROSSES,          # default: majors + JPY crosses
    "majors5": FX_MAJORS,
    "fx15": FX_MAJORS + FX_CROSSES,
    "all16": ALL_OANDA,
}
MIN_IS_TRADES = 150
LOG = TrialLog(FAMILY)

DEFAULTS = dict(trend="ema_slope", trend_n=100, trend_fast=50, slope_n=5, entry="rsi_cross",
                rsi_n=14, rsi_lo=40.0, setup_n=6, brk_n=3, pb_ema=20, atr_n=14, stop_atr=2.0,
                tp_r=2.0, trail_atr=0.0, max_hold=0, exit_flip=True, exit_rsi=0.0)

KEYS = ["cagr", "max_dd", "sharpe", "mar", "trades", "avg_R", "t_stat_R", "profit_factor_R",
        "worst_year"]


def gross_R(res) -> float:
    t = res.taken
    if len(t) == 0:
        return float("nan")
    return float((t.dir * (t.exit_mid - t.entry_mid) / t.stop_dist).mean())


def run_is(params: dict, universe: str = "maj_jpy9", stage: str = "", log: bool = True) -> dict:
    p = {**DEFAULTS, **params}
    m = evaluate(TrendPullbackH4(**p), UNIVERSES[universe], periods=("is",))["is"]
    res = m.pop("_result")
    m["gross_avg_R"] = gross_R(res)
    if log:
        LOG.log({**p, "universe": universe, "stage": stage}, m, "is")
    return m


def show(rows: list[dict], sort="sharpe", top=None):
    df = pd.DataFrame(rows)
    df = df.sort_values(sort, ascending=False)
    if top:
        df = df.head(top)
    with pd.option_context("display.width", 250, "display.max_columns", 40,
                           "display.float_format", "{:.3f}".format):
        print(df.to_string(index=False))
    return df


# ------------------------------------------------------------------------- stages
TRENDS = {
    "price_ema200": dict(trend="price_ema", trend_n=200),
    "ema_slope100": dict(trend="ema_slope", trend_n=100, slope_n=5),
    "dual50_200": dict(trend="dual", trend_n=200, trend_fast=50),
}
ENTRIES = {
    "rsi_dip": dict(entry="rsi_dip", rsi_n=14, rsi_lo=40.0),
    "rsi_cross": dict(entry="rsi_cross", rsi_n=14, rsi_lo=40.0),
    "rsi_brk": dict(entry="rsi_brk", rsi_n=14, rsi_lo=40.0, setup_n=6, brk_n=3),
    "ema_touch": dict(entry="ema_touch", pb_ema=20),
}
EXITS = {
    "tp2": dict(tp_r=2.0, trail_atr=0.0),
    "trail3": dict(tp_r=0.0, trail_atr=3.0),
}


def stage1():
    rows = []
    for (tn, t), (en, e), (xn, x) in itertools.product(TRENDS.items(), ENTRIES.items(),
                                                        EXITS.items()):
        m = run_is({**t, **e, **x}, stage="s1")
        rows.append({"trend": tn, "entry": en, "exit": xn, **{k: m.get(k) for k in KEYS},
                     "gross_R": m["gross_avg_R"]})
        print(tn, en, xn, {k: round(m.get(k, np.nan), 3) for k in KEYS}, flush=True)
    print("\n=== stage 1 (IS, maj_jpy9) ===")
    show(rows)


# stage 2a: exit-width grid on the three best stage-1 structures (all trail exits)
S2_STRUCTS = {
    "pe200_touch": {**TRENDS["price_ema200"], **ENTRIES["ema_touch"]},
    "es100_touch": {**TRENDS["ema_slope100"], **ENTRIES["ema_touch"]},
    "pe200_rsicross": {**TRENDS["price_ema200"], **ENTRIES["rsi_cross"]},
}


def stage2a():
    rows = []
    for (sn, s), sa, ta in itertools.product(S2_STRUCTS.items(), [1.5, 2.0, 3.0], [2.0, 3.0, 4.5]):
        if sa == 2.0 and ta == 3.0:
            continue  # already evaluated in stage 1
        m = run_is({**s, "stop_atr": sa, "trail_atr": ta, "tp_r": 0.0}, stage="s2a")
        rows.append({"struct": sn, "stop_atr": sa, "trail_atr": ta, **{k: m.get(k) for k in KEYS},
                     "gross_R": m["gross_avg_R"]})
        print(sn, sa, ta, {k: round(m.get(k, np.nan), 3) for k in KEYS}, flush=True)
    print("\n=== stage 2a (IS, maj_jpy9) ===")
    show(rows)


# stage 2b: one-at-a-time variations + filters around the best stage-2a config
BASE_2B = {**S2_STRUCTS["pe200_touch"], "stop_atr": 1.5, "trail_atr": 3.0, "tp_r": 0.0}
VARS_2B = [
    ("trend_n", 100), ("trend_n", 300), ("pb_ema", 10), ("pb_ema", 50),
    ("exit_flip", False), ("max_hold", 30), ("adx_min", 20.0), ("adx_min", 25.0),
    ("carry_align", True),
]


def stage2b():
    rows = []
    for k, v in VARS_2B:
        m = run_is({**BASE_2B, k: v}, stage="s2b")
        rows.append({"param": k, "value": v, **{x: m.get(x) for x in KEYS},
                     "gross_R": m["gross_avg_R"]})
        print(k, v, {x: round(m.get(x, np.nan), 3) for x in KEYS}, flush=True)
    print("\n=== stage 2b (IS, maj_jpy9); base sharpe 0.301 ===")
    show(rows)


# stage 2c: short-horizon "buy the dip in an uptrend" variant (fast RSI dip, exit when
# RSI recovers above 65 / below 35, wide safety stop, 3-day time stop)
def stage2c():
    rows = []
    for rn, lo, sa in itertools.product([2, 4], [10.0, 25.0], [2.0, 3.0]):
        p = {**TRENDS["price_ema200"], "entry": "rsi_dip", "rsi_n": rn, "rsi_lo": lo,
             "stop_atr": sa, "tp_r": 0.0, "trail_atr": 0.0, "exit_rsi": 65.0, "max_hold": 18}
        m = run_is(p, stage="s2c")
        rows.append({"rsi_n": rn, "rsi_lo": lo, "stop_atr": sa, **{x: m.get(x) for x in KEYS},
                     "gross_R": m["gross_avg_R"]})
        print(rn, lo, sa, {x: round(m.get(x, np.nan), 3) for x in KEYS}, flush=True)
    print("\n=== stage 2c (IS, maj_jpy9) ===")
    show(rows)


# stage 3: universe choice (IS) for the two leading configs
S3_CONFIGS = {"base": BASE_2B, "base+carry": {**BASE_2B, "carry_align": True}}


def stage3():
    rows = []
    for (cn, c), u in itertools.product(S3_CONFIGS.items(), ["majors5", "fx15", "all16"]):
        m = run_is(c, universe=u, stage="s3")
        rows.append({"config": cn, "universe": u, **{x: m.get(x) for x in KEYS},
                     "gross_R": m["gross_avg_R"]})
        print(cn, u, {x: round(m.get(x, np.nan), 3) for x in KEYS}, flush=True)
    print("\n=== stage 3 (IS); maj_jpy9: base 0.301, base+carry 0.326 ===")
    show(rows)


STAGES = {"1": stage1, "2a": stage2a, "2b": stage2b, "2c": stage2c, "3": stage3}


# --------------------------------------------------------------------- selection
# Selected on IS only (see reports/trend_pullback_h4.md, section "選定"):
#   best IS Sharpe overall was base+carry (0.326) on maj_jpy9, but its advantage over the
#   simpler base config (0.301) is far inside the Sharpe standard error (~0.3 over 10y) and
#   it is WORSE than base on all three other universes (stage 3) -> keep the simpler base.
SELECTED = dict(BASE_2B)
SELECTED_UNIVERSE = "maj_jpy9"

NEIGHBOURS = {  # one-at-a-time, roughly +-20..50 %
    "stop_atr": [1.2, 1.8, 2.0], "trail_atr": [2.0, 2.5, 3.5, 4.5],
    "trend_n": [100, 150, 250, 300], "pb_ema": [10, 15, 30], "atr_n": [10, 20],
    "exit_flip": [False], "carry_align": [True], "adx_min": [20.0],
}


def _norm_params(p: dict) -> str:
    """Canonical form of a parameter dict (drops 'stage' and missing values, casts
    numbers to float) so re-running this script never logs the same trial twice."""
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


def n_is_trials() -> int:
    df = LOG.load()
    return int((df.period == "is").sum()) if not df.empty else 0


# ---------------------------------------------------------------- look-ahead test
class _TruncCtx:
    """Knows only data up to the close of H4 bar T; the current D1 bar is a PARTIAL
    bar built from H4 bars <= T (so using the unfinished daily bar would change the
    decision at T)."""

    def __init__(self, sym, T):
        self.symbol, self.source = sym, "oanda"
        h4 = _bars("oanda", sym, "H4")
        self._h4 = h4[h4.index <= T]
        d1 = _bars("oanda", sym, "D1")
        day = T.normalize()
        full = d1[d1.index < day]
        part = self._h4[self._h4.index >= day]
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
        return {"H4": self._h4, "D1": self._d1}[tf]


class _LeakyD1(TrendPullbackH4):
    """Deliberately wrong: maps the D1 trend by bar OPEN time (uses the unfinished
    daily bar).  Used only to prove the truncation test can detect a leak."""

    def trend_on_signal_tf(self, ctx, b):
        from fxlab.strategies.trend_pullback_h4 import d1_trend_state
        st = d1_trend_state(ctx.bars("D1"), self.trend, self.trend_n, self.trend_fast,
                            self.slope_n)
        return st.reindex(b.index.normalize()).set_axis(b.index)


def lookahead_test(strat, symbols=("EURUSD", "GBPJPY", "AUDUSD"), n_cuts=80, seed=0) -> int:
    rng = np.random.default_rng(seed)
    bad = 0
    for sym in symbols:
        full = strat.decisions(SymbolContext(sym))
        idx = full.index[(full.index > "2006-01-01") & (full.index < "2020-05-01")]
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


def final():
    pd.set_option("display.width", 250)
    pd.set_option("display.max_columns", 40)
    pd.set_option("display.float_format", "{:.4f}".format)
    uni = UNIVERSES[SELECTED_UNIVERSE]
    strat = TrendPullbackH4(**{**DEFAULTS, **SELECTED})
    print("SELECTED:", strat, "\nUNIVERSE:", SELECTED_UNIVERSE, uni)

    # 1) look-ahead checks
    nb = lookahead_test(strat)
    nl = lookahead_test(_LeakyD1(**{**DEFAULTS, **SELECTED}), symbols=("EURUSD",), n_cuts=80)
    print(f"\nlook-ahead truncation test: mismatches={nb} (must be 0); "
          f"planted-leak control: mismatches={nl} (must be > 0)")

    # 2) trial log summary
    df = LOG.load()
    is_df = df[df.period == "is"]
    n_trials = len(is_df)
    print(f"\nIS trials logged: {n_trials}")
    lb = is_df[is_df["metrics.trades"] >= MIN_IS_TRADES].sort_values(
        "metrics.sharpe", ascending=False).head(8)
    cols = ["params.stage", "params.trend", "params.trend_n", "params.entry", "params.stop_atr",
            "params.trail_atr", "params.tp_r", "params.carry_align", "params.universe",
            "metrics.sharpe", "metrics.mar", "metrics.t_stat_R", "metrics.trades"]
    print("top IS trials by Sharpe (trades >= 150):")
    print(lb[cols].to_string(index=False))

    # 3) main evaluations
    ev = evaluate(strat, uni, periods=("is", "oos", "full"))
    ev2 = evaluate(strat, uni, periods=("is", "oos"), cost_mult=2.0)
    res_is, res_oos, res_full = ev["is"]["_result"], ev["oos"]["_result"], ev["full"]["_result"]
    dsr = dsr_for(ev["is"], res_is, n_trials)
    for per, m in [("oos", ev["oos"]), ("is_cost2x", ev2["is"]), ("oos_cost2x", ev2["oos"])]:
        if _key(SELECTED, SELECTED_UNIVERSE) not in _logged_keys(per):
            LOG.log({**DEFAULTS, **SELECTED, "universe": SELECTED_UNIVERSE, "stage": "final"},
                    m, per)
    rows = [fmt_row("is", ev["is"]), fmt_row("oos", ev["oos"]), fmt_row("is_cost2x", ev2["is"]),
            fmt_row("oos_cost2x", ev2["oos"]), fmt_row("full_2005_2020", ev["full"])]
    print("\n=== FINAL TABLE (1% risk per trade, 500,000 JPY start) ===")
    print(pd.DataFrame(rows).to_string(index=False))
    print(f"DSR (IS, n_trials={n_trials}): {dsr:.4f}")
    print("FRED periods: not applicable (H4 strategy; FRED is daily close-only)")

    # cost / swap decomposition
    print("\n=== R decomposition per trade (price R after spread+slip / swap / commission) ===")
    for name, r in [("is", res_is), ("oos", res_oos)]:
        t = r.taken
        g = t.dir * (t.exit_mid - t.entry_mid) / t.stop_dist
        gross = g.mean()
        tg = gross / (g.std(ddof=1) / np.sqrt(len(g)))
        print(f"{name}: gross_mid_R={gross:.4f} (t={tg:.2f}) R_after_spread={t.R.mean():.4f} "
              f"swap_R={(t.swap_jpy / t.risk_jpy).mean():.4f} "
              f"comm_R={(-t.commission_jpy / t.risk_jpy).mean():.4f} "
              f"net_R={(t.pnl_jpy / t.risk_jpy).mean():.4f} "
              f"hold_days={((t.exit_time - t.entry_time).dt.total_seconds() / 86400).mean():.2f} "
              f"long_share={(t.dir > 0).mean():.3f}")

    # 4) per symbol / per year
    print("\n=== per-symbol R: IS ===")
    print(per_symbol_R(res_is).to_string())
    print("\n=== per-symbol R: OOS ===")
    print(per_symbol_R(res_oos).to_string())
    t = res_full.taken
    yr = pd.DataFrame({"ret": per_year(res_full),
                       "trades": t.groupby(t.entry_time.dt.year).size(),
                       "avg_R": t.groupby(t.entry_time.dt.year).R.mean()})
    print("\n=== per-year (full 2005-2020, 1% risk) ===")
    print(yr.to_string())
    lg = t[t.dir > 0].groupby(t.entry_time.dt.year < 2015).R.agg(["mean", "size"])
    sh = t[t.dir < 0].groupby(t.entry_time.dt.year < 2015).R.agg(["mean", "size"])
    print("\nlong  avg_R (True=IS, False=OOS):", lg.to_dict())
    print("short avg_R (True=IS, False=OOS):", sh.to_dict())

    # 5) neighbours (IS logged as trials; OOS for reporting only, never for selection)
    known = _logged_keys("is")
    known_oos = _logged_keys("oos")
    nrows = []
    for k, vals in NEIGHBOURS.items():
        for v in vals:
            p = {**SELECTED, k: v}
            e = evaluate(TrendPullbackH4(**{**DEFAULTS, **p}), uni, periods=("is", "oos"))
            e["is"].pop("_result")
            e["oos"].pop("_result")
            if _key(p, SELECTED_UNIVERSE) not in known:
                LOG.log({**DEFAULTS, **p, "universe": SELECTED_UNIVERSE, "stage": "nbr"},
                        e["is"], "is")
            if _key(p, SELECTED_UNIVERSE) not in known_oos:
                LOG.log({**DEFAULTS, **p, "universe": SELECTED_UNIVERSE, "stage": "nbr"},
                        e["oos"], "oos")
            nrows.append({"param": k, "value": v, "is_sharpe": e["is"]["sharpe"],
                          "is_avgR": e["is"]["avg_R"], "is_maxdd": e["is"]["max_dd"],
                          "oos_sharpe": e["oos"]["sharpe"], "oos_avgR": e["oos"]["avg_R"],
                          "oos_cagr": e["oos"]["cagr"], "oos_maxdd": e["oos"]["max_dd"]})
    print("\n=== neighbours (one-at-a-time; OOS shown for robustness reporting only) ===")
    print(f"selected: is_sharpe={ev['is']['sharpe']:.4f} oos_sharpe={ev['oos']['sharpe']:.4f}")
    nd = pd.DataFrame(nrows)
    print(nd.to_string(index=False))
    print(f"neighbours with OOS avg_R > 0: {(nd.oos_avgR > 0).sum()}/{len(nd)}; "
          f"with OOS Sharpe > 0: {(nd.oos_sharpe > 0).sum()}/{len(nd)}")
    print(f"IS trials logged after neighbours: {n_is_trials()}")

    # 6) deliverables
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
