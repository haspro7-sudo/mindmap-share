"""Research script for the mean_reversion family.

    python scripts/research_mean_reversion.py            # final evaluation + table
    python scripts/research_mean_reversion.py --stage 1  # re-run an IS search stage
                                                         # (appends to the trial log)

Stages (in-sample 2005-2014 ONLY, every parameter set logged with TrialLog):
    1   structure screen: 3 timeframes x 4 oscillator entries x {no filter, ADX<25}
    2   regime filters on the leading structures (vol ratio, D1 flat / with-trend,
        session for intraday)
    3   exit / stop / time-stop grid on the leading filtered structure(s)
    4   universe choice for the chosen parameters
The final mode evaluates the selected config on IS / OOS / FRED / cost x2, runs
neighbour, per-symbol and per-year robustness, the look-ahead truncation test, and
writes the deliverables (reports/equity, reports/trades).
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
from fxlab.research import (ALL_OANDA, FRED_PAIRS, FX_CROSSES, FX_MAJORS, TrialLog,  # noqa: E402
                            dsr_for, evaluate, per_symbol_R, per_year)
from fxlab.strategies.mean_reversion import MeanReversion  # noqa: E402

FAMILY = "mean_reversion"
UNIVERSES = {
    "fx15": FX_MAJORS + FX_CROSSES,                      # default for the screens
    "range6": ["EURGBP", "AUDCAD", "EURCAD", "EURAUD", "AUDJPY", "CADJPY"],
    "crosses10": FX_CROSSES,
    "nonjpy_x6": ["EURGBP", "EURAUD", "GBPAUD", "EURCAD", "AUDCAD", "GBPCAD"],
    "majors5": FX_MAJORS,
    "all16": ALL_OANDA,
}
MIN_IS_TRADES = 150
LOG = TrialLog(FAMILY)

DEFAULTS = dict(tf="D1", entry="rsi", rsi_n=2, rsi_lo=10.0, bb_n=20, bb_k=2.0, z_n=20,
                z_in=2.0, exit="sma", exit_n=5, exit_rsi=50.0, tp_atr=0.0, atr_n=14,
                stop_atr=2.5, max_hold=10, adx_n=14, adx_max=0.0, adx_tf="sig", vol_n=100,
                vol_max=0.0, d1_trend="none", d1_n=200, d1_k=3.0, hours="all",
                skip_rollover=True)

KEYS = ["cagr", "max_dd", "sharpe", "mar", "trades", "win_rate", "avg_R", "t_stat_R",
        "profit_factor_R", "worst_year"]


def gross_R(res) -> float:
    """Average R at mid prices (before spread, slippage, commission and swap)."""
    t = res.taken
    if len(t) == 0:
        return float("nan")
    return float((t.dir * (t.exit_mid - t.entry_mid) / t.stop_dist).mean())


def _norm_params(p: dict) -> str:
    """Canonical form of a parameter dict (drops 'stage', casts numbers to float) so
    re-running this script never logs the same trial twice."""
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
    return {_norm_params(r["params"]): r["metrics"] for r in recs if r["period"] == period}


def _key(p, universe):
    return _norm_params({**DEFAULTS, **p, "universe": universe})


def run_is(params: dict, universe: str = "fx15", stage: str = "", log: bool = True) -> dict:
    """Evaluate one parameter set in-sample; logs it (once) as a trial."""
    p = {**DEFAULTS, **params}
    known = _logged("is")
    k = _key(params, universe)
    if k in known:                       # identical trial already logged: reuse it
        return known[k]
    m = evaluate(MeanReversion(**p), UNIVERSES[universe], periods=("is",))["is"]
    res = m.pop("_result")
    m["gross_avg_R"] = gross_R(res)
    t = res.taken
    m["hold_days"] = float(((t.exit_time - t.entry_time).dt.total_seconds() / 86400).mean()) \
        if len(t) else float("nan")
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


def _row(extra: dict, m: dict) -> dict:
    return {**extra, **{k: m.get(k) for k in KEYS}, "gross_R": m.get("gross_avg_R"),
            "hold_d": m.get("hold_days")}


def _p(label, m):
    print(label, {k: round(m.get(k, np.nan), 3) for k in KEYS + ["gross_avg_R"]}, flush=True)


# ------------------------------------------------------------------------- stages
ENTRIES = {
    # each oscillator exits at "its" mean
    "rsi2": dict(entry="rsi", rsi_n=2, rsi_lo=10.0, exit="sma", exit_n=5),
    "rsi14": dict(entry="rsi", rsi_n=14, rsi_lo=30.0, exit="sma", exit_n=14),
    "bb20": dict(entry="bb", bb_n=20, bb_k=2.0, exit="sma", exit_n=20),
    "z20": dict(entry="z", z_n=20, z_in=2.0, exit="sma", exit_n=20),
}
FILTERS1 = {"none": dict(), "adx25": dict(adx_max=25.0)}


def stage1():
    rows = []
    for tf, (en, e), (fn, f) in itertools.product(["D1", "H4", "H1"], ENTRIES.items(),
                                                  FILTERS1.items()):
        m = run_is({"tf": tf, **e, **f}, stage="s1")
        rows.append(_row({"tf": tf, "entry": en, "filt": fn}, m))
        _p(f"{tf} {en} {fn}", m)
    print("\n=== stage 1 (IS, fx15) ===")
    show(rows)


# Stage 1 finding: every structure negative on IS.  H4 has NEGATIVE gross (mid-price)
# edge (short-term continuation); D1 ~0 gross; only H1 RSI(2) shows a gross edge
# (+0.034 R) that spread + commission erase.  Stage 2 therefore tests, one at a time,
# regime / session filters that could concentrate the reversion.
S2_BASES = {
    "H1_rsi2": {"tf": "H1", **ENTRIES["rsi2"]},
    "D1_rsi2": {"tf": "D1", **ENTRIES["rsi2"]},
    "D1_bb20": {"tf": "D1", **ENTRIES["bb20"], "adx_max": 25.0},
    "H4_bb20": {"tf": "H4", **ENTRIES["bb20"], "adx_max": 25.0},
}
S2_VARS = {
    "H1_rsi2": [("hours", "asia"), ("hours", "eu_us"), ("rsi_lo", 5.0), ("vol_max", 1.0),
                ("d1_trend", "flat"), ("d1_trend", "with"), ("exit_n", 10)],
    "D1_rsi2": [("d1_trend", "flat"), ("d1_trend", "with"), ("vol_max", 1.0), ("rsi_lo", 5.0)],
    "D1_bb20": [("d1_trend", "flat"), ("vol_max", 1.0)],
    "H4_bb20": [("d1_trend", "flat"), ("hours", "asia")],
}


def stage2():
    rows = []
    for bn, base in S2_BASES.items():
        for k, v in S2_VARS[bn]:
            m = run_is({**base, k: v}, stage="s2")
            rows.append(_row({"base": bn, "param": k, "value": v}, m))
            _p(f"{bn} {k}={v}", m)
    print("\n=== stage 2 (IS, fx15) ===")
    show(rows)


# Stage 2 finding: H1 stays cost-dominated (Asia-session RSI(2) has +0.031 R gross but
# ~2,700 trades/yr of commission); H4 gross stays negative.  The only positive IS rows
# are D1 Bollinger re-entry + ADX<25 with a volatility (Sharpe 0.18) or D1-flat
# (0.11) filter.  Stage 3 explores that D1 branch one parameter at a time, and applies
# the same filter pair to the other D1 oscillators (is the filter generic?).
S3_BASE = {"tf": "D1", **ENTRIES["bb20"], "adx_max": 25.0, "vol_max": 1.0}
S3_VARS = [
    ("d1_trend", "flat"), ("bb_k", 1.5), ("bb_k", 2.5), ("bb_n", 10), ("bb_n", 40),
    ("exit_n", 10), ("exit", "tp"), ("stop_atr", 1.5), ("stop_atr", 4.0),
    ("max_hold", 5), ("max_hold", 20), ("adx_max", 20.0), ("adx_max", 30.0),
    ("vol_max", 0.8), ("vol_max", 1.2), ("adx_tf", "D1"),
]
S3_OTHER = {"rsi2": ENTRIES["rsi2"], "rsi14": ENTRIES["rsi14"], "z20": ENTRIES["z20"]}


def stage3():
    rows = []
    for k, v in S3_VARS:
        p = {**S3_BASE, k: v}
        if k == "bb_n":            # the exit mean is the Bollinger middle band
            p["exit_n"] = v
        m = run_is(p, stage="s3")
        rows.append(_row({"param": k, "value": v}, m))
        _p(f"{k}={v}", m)
    for en, e in S3_OTHER.items():
        m = run_is({"tf": "D1", **e, "adx_max": 25.0, "vol_max": 1.0}, stage="s3")
        rows.append(_row({"param": "entry", "value": en}, m))
        _p(f"entry={en}", m)
    print("\n=== stage 3 (IS, fx15); base D1 bb20 adx25 vol1.0: sharpe 0.183 ===")
    show(rows)


# Stage 3 finding: adding the D1-flat filter to the bb20+adx25+vol1.0 base gives the best
# IS row (Sharpe 0.37, t 2.0, 383 trades) but most single-parameter neighbours are
# between -0.2 and +0.26 and the filter pair does not help the other oscillators.
# Stage 4: neighbourhood of the flat variant + which of its three filters is needed.
S4_BASE = {**S3_BASE, "d1_trend": "flat"}
S4_VARS = [
    ("d1_k", 2.0), ("d1_k", 4.0), ("d1_n", 100), ("stop_atr", 4.0), ("stop_atr", 1.5),
    ("adx_max", 0.0), ("vol_max", 0.0), ("exit", "tp"), ("exit_n", 10), ("max_hold", 20),
    ("bb_k", 1.5),
]


def stage4():
    rows = []
    for k, v in S4_VARS:
        m = run_is({**S4_BASE, k: v}, stage="s4")
        rows.append(_row({"param": k, "value": v}, m))
        _p(f"{k}={v}", m)
    m = run_is({**S4_BASE, "adx_max": 0.0, "vol_max": 0.0}, stage="s4")
    rows.append(_row({"param": "flat_only", "value": 1}, m))
    _p("flat only", m)
    print("\n=== stage 4 (IS, fx15); base D1 bb20 adx25 vol1.0 flat3: sharpe 0.371 ===")
    show(rows)


# Stage 4 finding: all one-at-a-time neighbours of the flat base stay positive
# (Sharpe 0.10 .. 0.45); every one of the three regime filters is needed (flat alone
# -0.09).  Stage 5: universe choice for the base and its bb_k=1.5 neighbour.
S5_CONFIGS = {"base": S4_BASE, "bbk1.5": {**S4_BASE, "bb_k": 1.5}}


def stage5():
    rows = []
    for (cn, c), u in itertools.product(S5_CONFIGS.items(),
                                        ["range6", "crosses10", "nonjpy_x6", "majors5",
                                         "all16"]):
        m = run_is(c, universe=u, stage="s5")
        rows.append(_row({"config": cn, "universe": u}, m))
        _p(f"{cn} {u}", m)
    print("\n=== stage 5 (IS); fx15: base 0.371, bbk1.5 0.453 ===")
    show(rows)


# Stage 5 finding: contrary to the prior, the "range-prone" cross universes are the
# weakest (Sharpe -0.06 .. 0.17); majors5 is the strongest.  Stage 6: last check of
# the intraday hypothesis on the cheapest pairs (H1 RSI(2), Asia-session fills).
def stage6():
    rows = []
    for u in ["majors5", "range6"]:
        m = run_is({"tf": "H1", **ENTRIES["rsi2"], "hours": "asia"}, universe=u, stage="s6")
        rows.append(_row({"config": "H1_rsi2_asia", "universe": u}, m))
        _p(f"H1 rsi2 asia {u}", m)
    print("\n=== stage 6 (IS) ===")
    show(rows)


STAGES = {"1": stage1, "2": stage2, "3": stage3, "4": stage4, "5": stage5, "6": stage6}


# --------------------------------------------------------------------- selection
# Selected on IS only (see reports/mean_reversion.md, section "選定"):
#   among IS rows with >= 150 trades, "bbk1.5 / majors5" ranks first on all three
#   criteria (Sharpe 0.700, MAR 0.546, t-stat of R 2.57; 209 trades).  Its t-stat is
#   barely above the broad fx15 version (2.48, 608 trades), so fx15 / all16 are carried
#   as universe neighbours in the robustness report.
SELECTED = {**S4_BASE, "bb_k": 1.5}
SELECTED_UNIVERSE = "majors5"

NEIGHBOURS = {  # one-at-a-time, roughly +-20..50 %
    "bb_k": [1.25, 1.75, 2.0], "bb_n": [15, 30], "adx_max": [20.0, 30.0],
    "vol_max": [0.8, 1.2], "d1_k": [2.0, 4.0], "d1_n": [100, 300],
    "stop_atr": [1.5, 2.0, 3.0, 4.0], "max_hold": [5, 20], "exit": ["tp"], "exit_n": [10],
    "universe": ["fx15", "all16"],
}


def n_is_trials() -> int:
    df = LOG.load()
    return int((df.period == "is").sum()) if not df.empty else 0


# ---------------------------------------------------------------- look-ahead test
class _TruncCtx:
    """Knows only D1 bars that opened at or before T (bar T is complete when the
    decision for T is taken, at its close)."""

    def __init__(self, sym, T):
        self.symbol, self.source = sym, "oanda"
        d1 = _bars("oanda", sym, "D1")
        self._d1 = d1[d1.index <= T]

    @property
    def inst(self):
        return SymbolContext(self.symbol).inst

    def bars(self, tf):
        if tf != "D1":
            raise KeyError(tf)
        return self._d1


class _LeakyBB(MeanReversion):
    """Deliberately wrong: re-entry condition uses the NEXT bar's close.  Used only to
    prove the truncation test can detect a leak."""

    def signals(self, b):
        from fxlab import indicators as I
        c = b["close"]
        lb, _, ub = I.bollinger(c, self.bb_n, self.bb_k)
        L = (c < lb) & (c.shift(-1) > lb)
        S = (c > ub) & (c.shift(-1) < ub)
        return (L.fillna(False).to_numpy(bool).copy(), S.fillna(False).to_numpy(bool).copy())


def lookahead_test(strat, symbols=("EURUSD", "USDJPY", "AUDUSD"), n_cuts=120, seed=0) -> int:
    rng = np.random.default_rng(seed)
    bad = 0
    for sym in symbols:
        full = strat.decisions(SymbolContext(sym))
        idx = full.index[(full.index > "2006-01-01") & (full.index < "2020-05-01")]
        # half the cuts on bars with an entry signal (where a leak would matter most)
        sig = full.index[(full.long_entry | full.short_entry) & (full.index > "2006-01-01")]
        cuts = list(rng.choice(idx, n_cuts // 2, replace=False)) + \
            list(rng.choice(sig, min(n_cuts // 2, len(sig)), replace=False))
        for T in cuts:
            T = pd.Timestamp(T)
            a, b = full.loc[T], strat.decisions(_TruncCtx(sym, T)).loc[T]
            for c in full.columns:
                x, y = a[c], b[c]
                same = (pd.isna(x) and pd.isna(y)) or x == y or (
                    isinstance(x, float) and isinstance(y, float) and abs(x - y) < 1e-12)
                bad += 0 if same else 1
    return bad


# ------------------------------------------------------- close-only diagnostic
class _CloseOnlyCtx:
    """OANDA D1 closes reshaped exactly like fxlab.data.fred_as_bars (open = previous
    close, high/low = max/min(open, close)).  Separates 'FRED is close-only' from
    'the edge decayed' when interpreting the FRED periods."""

    def __init__(self, sym):
        self.symbol, self.source = sym, "oanda"
        c = _bars("oanda", sym, "D1")["close"]
        o = c.shift(1).fillna(c)
        self._d1 = pd.DataFrame({"open": o, "high": np.maximum(o, c), "low": np.minimum(o, c),
                                 "close": c, "volume": 0.0})

    @property
    def inst(self):
        return SymbolContext(self.symbol).inst

    def bars(self, tf):
        if tf != "D1":
            raise KeyError(tf)
        return self._d1


def closeonly_eval(strat, symbols, start, end):
    from fxlab.backtest import conversion_table
    from fxlab.engine import run_portfolio, simulate_symbol
    from fxlab.metrics import summarize
    from fxlab.research import _short, research_config
    trades = {}
    for sym in symbols:
        ctx = _CloseOnlyCtx(sym)
        trades[sym] = simulate_symbol(strat.decisions(ctx), "D1", ctx.bars("D1"))
    daily = {sym: _bars("oanda", sym, "D1")["close"] for sym in symbols}
    res = run_portfolio(trades, conversion_table("oanda"), daily, research_config(), start, end)
    m = _short(summarize(res))
    m["_result"] = res
    return m


# ------------------------------------------------------------------------ final
def fmt_row(name, m):
    return {"period": name, "cagr": m.get("cagr"), "max_dd": m.get("max_dd"),
            "sharpe": m.get("sharpe"), "mar": m.get("mar"), "trades": m.get("trades"),
            "avg_R": m.get("avg_R"), "t_stat_R": m.get("t_stat_R"),
            "profit_factor_R": m.get("profit_factor_R"), "worst_year": m.get("worst_year"),
            "win_rate": m.get("win_rate")}


def r_decomp(name, r):
    t = r.taken
    if len(t) == 0:
        print(f"{name}: no trades")
        return
    g = t.dir * (t.exit_mid - t.entry_mid) / t.stop_dist
    tg = g.mean() / (g.std(ddof=1) / np.sqrt(len(g)))
    net = t.pnl_jpy / t.risk_jpy
    tn = net.mean() / (net.std(ddof=1) / np.sqrt(len(net)))
    print(f"{name}: n={len(t)} gross_mid_R={g.mean():.4f} (t={tg:.2f}) "
          f"R_after_spread={t.R.mean():.4f} swap_R={(t.swap_jpy / t.risk_jpy).mean():.4f} "
          f"comm_R={(-t.commission_jpy / t.risk_jpy).mean():.4f} "
          f"net_R={net.mean():.4f} (t={tn:.2f}) "
          f"hold_days={((t.exit_time - t.entry_time).dt.total_seconds() / 86400).mean():.2f} "
          f"long_share={(t.dir > 0).mean():.3f} exits={t.reason.value_counts().to_dict()}")


def final(json_out=None):
    pd.set_option("display.width", 250)
    pd.set_option("display.max_columns", 40)
    pd.set_option("display.float_format", "{:.4f}".format)
    uni = UNIVERSES[SELECTED_UNIVERSE]
    P = {**DEFAULTS, **SELECTED}
    strat = MeanReversion(**P)
    print("SELECTED:", strat, "\nUNIVERSE:", SELECTED_UNIVERSE, uni)

    # 1) look-ahead checks
    nb = lookahead_test(strat)
    nl = lookahead_test(_LeakyBB(**P), symbols=("EURUSD",), n_cuts=80)
    print(f"\nlook-ahead truncation test: mismatches={nb} (must be 0); "
          f"planted-leak control: mismatches={nl} (must be > 0)")

    # 2) neighbours first (IS logged as trials; OOS for reporting only, never selection)
    known = _logged("is")
    known_oos = _logged("oos")
    nrows = []
    for k, vals in NEIGHBOURS.items():
        for v in vals:
            if k == "universe":
                p, u = dict(SELECTED), v
            else:
                p, u = {**SELECTED, k: v}, SELECTED_UNIVERSE
                if k == "bb_n":
                    p["exit_n"] = v
            e = evaluate(MeanReversion(**{**DEFAULTS, **p}), UNIVERSES[u], periods=("is", "oos"))
            e["is"].pop("_result")
            e["oos"].pop("_result")
            if _key(p, u) not in known:
                LOG.log({**DEFAULTS, **p, "universe": u, "stage": "nbr"}, e["is"], "is")
            if _key(p, u) not in known_oos:
                LOG.log({**DEFAULTS, **p, "universe": u, "stage": "nbr"}, e["oos"], "oos")
            nrows.append({"param": k, "value": v, "is_sharpe": e["is"].get("sharpe"),
                          "is_avgR": e["is"].get("avg_R"), "is_trades": e["is"].get("trades"),
                          "is_maxdd": e["is"].get("max_dd"),
                          "oos_sharpe": e["oos"].get("sharpe"), "oos_avgR": e["oos"].get("avg_R"),
                          "oos_trades": e["oos"].get("trades"), "oos_cagr": e["oos"].get("cagr"),
                          "oos_maxdd": e["oos"].get("max_dd")})

    # 3) execution-realism check: same rules filled at 01:00 server time (not rollover)
    from fxlab.strategies.mean_reversion import MeanReversionDelayedD1
    dl = MeanReversionDelayedD1(**P)
    evd = evaluate(dl, uni, periods=("is", "oos"))
    evd2 = evaluate(dl, uni, periods=("is", "oos"), cost_mult=2.0)
    kd = _norm_params({**P, "universe": SELECTED_UNIVERSE, "exec": "01:00"})
    if kd not in known:
        LOG.log({**P, "universe": SELECTED_UNIVERSE, "exec": "01:00", "stage": "exec"},
                {k: v for k, v in evd["is"].items() if k != "_result"}, "is")

    # 4) trial log summary
    df = LOG.load()
    is_df = df[df.period == "is"]
    n_trials = len(is_df)
    print(f"\nIS trials logged (incl. neighbours and exec check): {n_trials}")
    lb = is_df[is_df["metrics.trades"] >= MIN_IS_TRADES].sort_values(
        "metrics.sharpe", ascending=False).head(8)
    cols = ["params.stage", "params.tf", "params.entry", "params.bb_k", "params.adx_max",
            "params.vol_max", "params.d1_trend", "params.stop_atr", "params.universe",
            "metrics.sharpe", "metrics.mar", "metrics.t_stat_R", "metrics.trades"]
    print("top IS trials by Sharpe (trades >= 150):")
    print(lb[cols].to_string(index=False))
    print(f"IS trials with Sharpe > 0: {(is_df['metrics.sharpe'] > 0).sum()}/{n_trials}")

    # 5) main evaluations
    ev = evaluate(strat, uni, periods=("is", "oos", "fred_pre", "fred_oos", "full"))
    ev2 = evaluate(strat, uni, periods=("is", "oos"), cost_mult=2.0)
    res_is, res_oos, res_full = ev["is"]["_result"], ev["oos"]["_result"], ev["full"]["_result"]
    dsr = dsr_for(ev["is"], res_is, n_trials)
    known_p = {per: _logged(per) for per in ("oos", "fred_pre", "fred_oos", "is_cost2x",
                                             "oos_cost2x")}
    for per, m in [("oos", ev["oos"]), ("fred_pre", ev["fred_pre"]),
                   ("fred_oos", ev["fred_oos"]), ("is_cost2x", ev2["is"]),
                   ("oos_cost2x", ev2["oos"])]:
        if _key(SELECTED, SELECTED_UNIVERSE) not in known_p[per]:
            LOG.log({**P, "universe": SELECTED_UNIVERSE, "stage": "final"}, m, per)
    table = {"is": ev["is"], "oos": ev["oos"], "fred_pre": ev["fred_pre"],
             "fred_oos": ev["fred_oos"], "is_cost2x": ev2["is"], "oos_cost2x": ev2["oos"],
             "full_2005_2020": ev["full"], "is_exec0100": evd["is"], "oos_exec0100": evd["oos"],
             "is_exec0100_cost2x": evd2["is"], "oos_exec0100_cost2x": evd2["oos"]}
    print("\n=== FINAL TABLE (1% risk per trade, 500,000 JPY start) ===")
    print(pd.DataFrame([fmt_row(k, v) for k, v in table.items()]).to_string(index=False))
    print(f"DSR (IS, n_trials={n_trials}): {dsr:.4f}")
    print("fred_pre = FRED 1976-2004 close-only, fred_oos = FRED 2020-05..2026-09 close-only "
          f"(pairs: {[s for s in uni if s in FRED_PAIRS]})")

    # close-only diagnostic (OANDA 2005-2020 reshaped like FRED bars, D1 fills)
    from fxlab.backtest import IS_END, IS_START, OOS_END, OOS_START
    co = {"is_closeonly": closeonly_eval(strat, uni, IS_START, IS_END),
          "oos_closeonly": closeonly_eval(strat, uni, OOS_START, OOS_END)}
    known_d = _logged("diag_closeonly")
    if _key(SELECTED, SELECTED_UNIVERSE) not in known_d:
        LOG.log({**P, "universe": SELECTED_UNIVERSE, "stage": "diag"},
                {**{k: v for k, v in co["is_closeonly"].items() if k != "_result"},
                 **{"oos_" + k: v for k, v in co["oos_closeonly"].items() if k != "_result"}},
                "diag_closeonly")
    print("\n=== diagnostic: same rules on OANDA closes reshaped like FRED bars ===")
    print(pd.DataFrame([fmt_row(k, v) for k, v in co.items()]).to_string(index=False))
    table.update(co)

    print("\n=== R decomposition per trade (price R after spread+slip / swap / commission) ===")
    for name in ("is", "oos", "fred_pre", "fred_oos"):
        r_decomp(name, ev[name]["_result"])
    r_decomp("is_exec0100", evd["is"]["_result"])
    r_decomp("oos_exec0100", evd["oos"]["_result"])
    r_decomp("is_closeonly", co["is_closeonly"]["_result"])
    r_decomp("oos_closeonly", co["oos_closeonly"]["_result"])
    t_o = res_oos.taken
    for a, b in [("2015-01-01", "2017-01-01"), ("2017-01-01", "2020-05-15")]:
        x = t_o[(t_o.entry_time >= a) & (t_o.entry_time < b)]
        nr = x.pnl_jpy / x.risk_jpy
        print(f"OOS sub-period {a[:4]}-{b[:4]}: n={len(x)} avg_R={x.R.mean():.4f} "
              f"net_R={nr.mean():.4f} sum_net_R={nr.sum():.2f}")

    # 6) per symbol / per year
    for name in ("is", "oos", "fred_pre", "fred_oos"):
        print(f"\n=== per-symbol R: {name} ===")
        print(per_symbol_R(ev[name]["_result"]).to_string())
    t = res_full.taken
    yr = pd.DataFrame({"ret": per_year(res_full),
                       "trades": t.groupby(t.entry_time.dt.year).size(),
                       "avg_R": t.groupby(t.entry_time.dt.year).R.mean()})
    print("\n=== per-year (full 2005-2020, 1% risk) ===")
    print(yr.to_string())
    for name in ("fred_pre", "fred_oos"):
        r = ev[name]["_result"]
        tt = r.taken
        y = pd.DataFrame({"ret": per_year(r), "trades": tt.groupby(tt.entry_time.dt.year).size(),
                          "avg_R": tt.groupby(tt.entry_time.dt.year).R.mean()})
        print(f"\n=== per-year ({name}) ===")
        print(y.to_string())
    lg = t[t.dir > 0].groupby(t.entry_time.dt.year < 2015).R.agg(["mean", "size"])
    sh = t[t.dir < 0].groupby(t.entry_time.dt.year < 2015).R.agg(["mean", "size"])
    print("\nlong  avg_R (True=IS, False=OOS):", lg.to_dict())
    print("short avg_R (True=IS, False=OOS):", sh.to_dict())

    # 7) neighbour table
    print("\n=== neighbours (one-at-a-time; OOS shown for robustness reporting only) ===")
    print(f"selected: is_sharpe={ev['is']['sharpe']:.4f} oos_sharpe={ev['oos']['sharpe']:.4f}")
    nd = pd.DataFrame(nrows)
    print(nd.to_string(index=False))
    print(f"neighbours with IS Sharpe > 0: {(nd.is_sharpe > 0).sum()}/{len(nd)}; "
          f"OOS avg_R > 0: {(nd.oos_avgR > 0).sum()}/{len(nd)}; "
          f"OOS Sharpe > 0: {(nd.oos_sharpe > 0).sum()}/{len(nd)}")

    # 8) deliverables
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
    if json_out:
        keep = ["cagr", "max_dd", "sharpe", "mar", "trades", "avg_R", "t_stat_R",
                "profit_factor_R", "worst_year", "win_rate"]
        js = {k: {x: v.get(x) for x in keep} for k, v in table.items()}
        js["dsr_is"] = dsr
        js["n_trials"] = n_trials
        js["lookahead"] = [nb, nl]
        js["neighbours"] = nrows
        with open(json_out, "w") as f:
            json.dump(js, f, default=float, indent=1)


# --------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", default=None, help="re-run an IS search stage: " + ",".join(STAGES))
    ap.add_argument("--json", default=None, help="also dump the final metrics to this file")
    args = ap.parse_args()
    if args.stage:
        t0 = time.time()
        STAGES[args.stage]()
        print(f"stage {args.stage} done in {time.time() - t0:.0f}s; trials logged: {LOG.count()}")
        return
    final(args.json)


if __name__ == "__main__":
    main()
