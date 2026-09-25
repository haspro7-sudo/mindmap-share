"""Research script for family ``index_dip_buy`` (short-term dip buying on stock-index
CFDs in the direction of the long-term trend).

    python scripts/research_index_dip_buy.py            # reuse logged IS trials, print final table
    python scripts/research_index_dip_buy.py --fresh    # wipe the trial log and redo the IS search

Protocol (docs/RESEARCH_PROTOCOL.md):
  * universe fixed a priori: the 7 stock-index CFDs (US500 NAS100 US2000 JPN225 UK100
    FRA40 AUS200).  Gold is only run as a separate check with the final rules.
  * every parameter set is evaluated on IN-SAMPLE 2005-2014 only and logged to
    reports/trials/index_dip_buy.jsonl (one line per unique config; reruns reuse it)
  * selection is programmatic: in every stage the winner is the config with the best
    NEIGHBOUR-SMOOTHED IS Sharpe (mean of the config and its grid neighbours), among
    configs with >= 150 IS trades.  OOS / pst numbers are computed only afterwards.
  * the chosen config (and its one-at-a-time neighbours, for reporting only) are then
    run on OOS 2015-01..2020-05, pst futures pre-sample (..2004) and 2020-05..2024-03,
    and at 2x costs.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fxlab.research import (INDICES, TrialLog, dsr_for, evaluate, per_symbol_R,  # noqa: E402
                            per_year)
from fxlab.strategies.index_dip_buy import IndexDipBuy  # noqa: E402

FAMILY = "index_dip_buy"
MIN_IS_TRADES = 150
UNIVERSE = list(INDICES)            # fixed a priori
CHECK_SYMBOLS = ["XAUUSD"]           # gold: separate check only

DEFAULTS = dict(tf="D1", entry="rsi", rsi_n=2, rsi_lo=10.0, down_n=3, ibs_lo=0.2, bb_n=20,
                bb_k=2.0, nlow_n=7, trend_n=200, exit="sma", exit_n=5, exit_rsi=70.0,
                max_hold=10, atr_n=20, atr_tf="sig", stop_atr=5.0, shorts=False, longs=True)

KEYS = ["cagr", "max_dd", "sharpe", "mar", "trades", "avg_R", "t_stat_R", "profit_factor_R",
        "win_rate", "worst_year"]


# --------------------------------------------------------------------------- utils
def canon(p: dict) -> dict:
    """Full parameter dict with parameters that cannot affect the result reset to
    their defaults (so equivalent configs share one trial)."""
    q = dict(DEFAULTS)
    q.update(p)
    uses_rsi = q["entry"] == "rsi" or q["exit"] == "rsi"
    if not uses_rsi:
        q["rsi_n"] = DEFAULTS["rsi_n"]
    if q["entry"] != "rsi":
        q["rsi_lo"] = DEFAULTS["rsi_lo"]
    if q["entry"] != "down":
        q["down_n"] = DEFAULTS["down_n"]
    if q["entry"] != "ibs":
        q["ibs_lo"] = DEFAULTS["ibs_lo"]
    if q["entry"] != "bb":
        q["bb_n"], q["bb_k"] = DEFAULTS["bb_n"], DEFAULTS["bb_k"]
    if q["entry"] != "nlow":
        q["nlow_n"] = DEFAULTS["nlow_n"]
    if q["exit"] != "sma":
        q["exit_n"] = DEFAULTS["exit_n"]
    if q["exit"] != "rsi":
        q["exit_rsi"] = DEFAULTS["exit_rsi"]
    if q["tf"] == "D1":
        q["atr_tf"] = "sig"
    for k in ("rsi_lo", "ibs_lo", "bb_k", "exit_rsi", "stop_atr"):
        q[k] = float(q[k])
    for k in ("rsi_n", "down_n", "bb_n", "nlow_n", "trend_n", "exit_n", "max_hold", "atr_n"):
        q[k] = int(q[k])
    return q


def key_of(p: dict, universe) -> str:
    return json.dumps({"p": canon(p), "u": list(universe)}, sort_keys=True)


def make(p: dict) -> IndexDipBuy:
    return IndexDipBuy(**canon(p))


def short_metrics(m: dict) -> dict:
    return {k: m.get(k) for k in KEYS}


class Search:
    """IS-only evaluation with an append-only trial log; reruns reuse logged trials."""

    def __init__(self, fresh: bool):
        self.log = TrialLog(FAMILY)
        if fresh and self.log.path.exists():
            self.log.path.unlink()
        self.done: dict[str, dict] = {}
        if self.log.path.exists():
            for line in open(self.log.path):
                rec = json.loads(line)
                if rec.get("period") != "is":
                    continue
                k = json.dumps({"p": canon(rec["params"]["p"]), "u": rec["params"]["u"]},
                               sort_keys=True)
                self.done[k] = rec["metrics"]

    def run(self, p: dict, stage: str, universe=UNIVERSE) -> dict:
        k = key_of(p, universe)
        if k not in self.done:
            m = evaluate(make(p), list(universe), periods=("is",))["is"]
            m = {kk: v for kk, v in m.items() if not kk.startswith("_")}
            self.log.log({"p": canon(p), "u": list(universe), "stage": stage}, m, "is")
            self.done[k] = m
            print(f"  [{stage}] {describe(p)}  sharpe={m.get('sharpe', 0):.2f} "
                  f"cagr={m.get('cagr', 0):.2%} dd={m.get('max_dd', 0):.1%} "
                  f"n={m.get('trades', 0)} avgR={m.get('avg_R', 0):.3f} "
                  f"t={m.get('t_stat_R', 0):.2f}", flush=True)
        return self.done[k]

    @property
    def n_trials(self) -> int:
        return len(self.done)


def describe(p: dict) -> str:
    q = canon(p)
    e = q["entry"]
    ent = {"rsi": f"rsi({q['rsi_n']})<{q['rsi_lo']:g}", "down": f"down>={q['down_n']}",
           "ibs": f"ibs<{q['ibs_lo']:g}", "bb": f"bb({q['bb_n']},{q['bb_k']:g})",
           "nlow": f"nlow({q['nlow_n']})"}[e]
    x = q["exit"]
    ex = {"sma": f"sma{q['exit_n']}", "rsi": f"rsi>{q['exit_rsi']:g}", "hi": "hi", "up": "up",
          "none": "none"}[x]
    s = (f"{q['tf']} {ent} trend={q['trend_n']} exit={ex} hold={q['max_hold']} "
         f"stop={q['stop_atr']:g}xATR{q['atr_n']}")
    if q["shorts"]:
        s += " +shorts" if q["longs"] else " shorts-only"
    return s


def score(m: dict) -> float:
    return m.get("sharpe", 0.0) if m.get("trades", 0) >= MIN_IS_TRADES else -9.0


RULE = {"v": "v2"}


def smoothed(search: Search, axes: list[list[dict]], stage: str) -> list[tuple[float, dict, dict]]:
    """Evaluate every config on its 1-D axes and score it by IS Sharpe smoothed over
    its immediate grid neighbours.  Returns [(score, params, m)].

      rule v1 (first pre-registered rule, superseded):  mean(own, neighbours).
          Defect found on IS: an axis END point next to an isolated peak inherits the
          peak (down>=4 with own Sharpe 0.10 scored 0.33 because down>=3 had 0.55).
      rule v2 (used for the final choice):  min(own, mean(own, neighbours)) - a config
          can never score above its own IS Sharpe and is penalised by weak neighbours.
    """
    out = []
    for axis in axes:
        ms = [search.run(p, stage) for p in axis]
        sh = [m.get("sharpe", 0.0) for m in ms]
        for i, (p, m) in enumerate(zip(axis, ms)):
            nb = sh[max(0, i - 1):i + 2]
            sm = float(np.mean(nb))
            if RULE["v"] == "v2":
                sm = min(sm, sh[i])
            if m.get("trades", 0) < MIN_IS_TRADES:
                sm = -9.0
            out.append((sm, p, m))
    return out


def best(rows):
    return max(rows, key=lambda r: r[0])


# --------------------------------------------------------------------------- stages
def entry_axes(base: dict, family: str) -> list[list[dict]]:
    b = dict(base)
    if family == "rsi":
        return [[{**b, "entry": "rsi", "rsi_n": 2, "rsi_lo": x} for x in (5, 10, 20)],
                [{**b, "entry": "rsi", "rsi_n": 3, "rsi_lo": x} for x in (10, 20, 30)]]
    if family == "down":
        return [[{**b, "entry": "down", "down_n": x} for x in (2, 3, 4)]]
    if family == "ibs":
        return [[{**b, "entry": "ibs", "ibs_lo": x} for x in (0.1, 0.2, 0.3)]]
    if family == "bb":
        return [[{**b, "entry": "bb", "bb_n": n, "bb_k": k} for k in (1.5, 2.0)] for n in (10, 20)]
    if family == "nlow":
        return [[{**b, "entry": "nlow", "nlow_n": x} for x in (5, 7, 10)]]
    raise ValueError(family)


def axis_containing(p: dict, family: str) -> list[dict]:
    for axis in entry_axes(p, family):
        if any(key_of(q, UNIVERSE) == key_of(p, UNIVERSE) for q in axis):
            return axis
    return entry_axes(p, family)[0]


FAMILIES = ["rsi", "down", "ibs", "bb", "nlow"]
EXIT_CHOICES = [("sma", 3), ("sma", 5), ("sma", 10), ("rsi", 50), ("rsi", 70), ("hi", None),
                ("up", None)]


def exit_axes(base: dict) -> list[list[dict]]:
    axes = []
    for x, v in EXIT_CHOICES:
        axis = []
        for mh in (5, 10, 20):
            p = {**base, "exit": x, "max_hold": mh}
            if x == "sma":
                p["exit_n"] = v
            if x == "rsi":
                p["exit_rsi"] = float(v)
            axis.append(p)
        axes.append(axis)
    axes.append([{**base, "exit": "none", "max_hold": mh} for mh in (3, 5, 10)])
    return axes


STOPS = (2.0, 3.0, 4.0, 5.0, 7.0, 10.0)


def run_search(search: Search) -> dict:
    print(f"== Stage A: entry families (D1, exit sma5, hold 10, stop 5xATR20), "
          f"trend filter 200 vs none")
    base = dict(DEFAULTS)
    fam_best = {}
    trend_avg = {}
    for tn in (200, 0):
        allsm = []
        for fam in FAMILIES:
            rows = smoothed(search, entry_axes({**base, "trend_n": tn}, fam), f"A_{fam}_t{tn}")
            allsm += [r[1] for r in rows]
            fam_best[(fam, tn)] = best(rows)
        ms = [search.run(p, "A") for p in allsm]
        trend_avg[tn] = float(np.mean([m.get("sharpe", 0.0) for m in ms]))
    # pre-registered default: trend filter ON unless "no filter" is better on average
    tn = 200 if trend_avg[200] >= trend_avg[0] else 0
    print(f"  mean IS Sharpe over all stage-A configs: trend200={trend_avg[200]:.3f} "
          f"none={trend_avg[0]:.3f}  -> trend_n={tn}")
    ranked = sorted(FAMILIES, key=lambda f: fam_best[(f, tn)][0], reverse=True)
    for f in ranked:
        sm, p, m = fam_best[(f, tn)]
        print(f"  family {f:5s} smoothed={sm:.3f}  best={describe(p)}  sharpe={m['sharpe']:.2f}"
              f" n={m['trades']}")
    finalists = ranked[:2]

    results = {}
    for fam in finalists:
        p0 = fam_best[(fam, tn)][1]
        print(f"== Stage B [{fam}]: exits x max_hold on {describe(p0)}")
        sm, pB, mB = best(smoothed(search, exit_axes(p0), f"B_{fam}"))
        print(f"  -> {describe(pB)} smoothed={sm:.3f} sharpe={mB['sharpe']:.2f}")
        print(f"== Stage C [{fam}]: stop multiple")
        sm, pC, mC = best(smoothed(search, [[{**pB, "stop_atr": s} for s in STOPS]], f"C_{fam}"))
        print(f"  -> {describe(pC)} smoothed={sm:.3f} sharpe={mC['sharpe']:.2f}")
        print(f"== Stage E [{fam}]: entry threshold re-check with final exit/stop")
        sm, pE, mE = best(smoothed(search, entry_axes(pC, fam), f"E_{fam}"))
        print(f"  -> {describe(pE)} smoothed={sm:.3f} sharpe={mE['sharpe']:.2f}")
        results[fam] = (sm, pE, mE)
    fam = max(results, key=lambda f: results[f][0])
    sm, pD1, mD1 = results[fam]
    print(f"== D1 winner: {describe(pD1)} smoothed={sm:.3f}")

    print("== Stage D: shorts (mirror image below SMA200); adopt only if the combined "
          "IS Sharpe improves AND the short leg alone has IS t-stat(R) > 1.5")
    m_both = search.run({**pD1, "shorts": True}, "D_shorts")
    m_sonly = search.run({**pD1, "shorts": True, "longs": False}, "D_shorts")
    if m_both.get("sharpe", 0) > mD1["sharpe"] and m_sonly.get("t_stat_R", 0) > 1.5:
        pD1 = {**pD1, "shorts": True}
        print("  shorts adopted")
    else:
        print("  shorts rejected")

    print("== Stage F: H4 variant (D1 trend + D1 ATR stop; adopt only if smoothed IS "
          "Sharpe beats D1 by > 0.2)")
    h4_axes = []
    for en in (5, 10):
        for mh in (12, 30):
            h4_axes.append([{**p, "tf": "H4", "atr_tf": "D1", "exit": "sma", "exit_n": en,
                             "max_hold": mh}
                            for p in axis_containing(pD1, fam)])
    smH, pH, mH = best(smoothed(search, h4_axes, "F_H4"))
    print(f"  H4 best {describe(pH)} smoothed={smH:.3f} sharpe={mH['sharpe']:.2f}")
    chosen = pH if smH > sm + 0.2 else pD1
    print(f"== CHOSEN: {describe(chosen)}")
    return canon(chosen)


# --------------------------------------------------------------------------- final
def neighbours(p: dict) -> list[tuple[str, dict]]:
    q = canon(p)
    out = []
    e = q["entry"]
    if e == "rsi":
        for v in (q["rsi_lo"] * 0.5, q["rsi_lo"] * 1.5):
            out.append((f"rsi_lo={v:g}", {**q, "rsi_lo": v}))
        out.append((f"rsi_n={q['rsi_n'] + 1}", {**q, "rsi_n": q["rsi_n"] + 1}))
    elif e == "down":
        for v in (q["down_n"] - 1, q["down_n"] + 1):
            out.append((f"down_n={v}", {**q, "down_n": v}))
    elif e == "ibs":
        for v in (q["ibs_lo"] - 0.1, q["ibs_lo"] + 0.1):
            out.append((f"ibs_lo={v:.1f}", {**q, "ibs_lo": round(v, 2)}))
    elif e == "bb":
        for v in (q["bb_k"] - 0.5, q["bb_k"] + 0.5):
            out.append((f"bb_k={v:g}", {**q, "bb_k": v}))
        for v in (max(5, q["bb_n"] // 2), q["bb_n"] * 2):
            out.append((f"bb_n={v}", {**q, "bb_n": v}))
    elif e == "nlow":
        for v in (max(3, round(q["nlow_n"] * 0.7)), round(q["nlow_n"] * 1.4)):
            out.append((f"nlow_n={v}", {**q, "nlow_n": v}))
    if q["exit"] == "sma":
        for v in (max(2, round(q["exit_n"] * 0.6)), round(q["exit_n"] * 1.6)):
            out.append((f"exit_n={v}", {**q, "exit_n": v}))
    if q["exit"] == "rsi":
        for v in (q["exit_rsi"] - 15, q["exit_rsi"] + 15):
            out.append((f"exit_rsi={v:g}", {**q, "exit_rsi": v}))
    if q["max_hold"]:
        for v in (max(2, round(q["max_hold"] * 0.5)), round(q["max_hold"] * 2)):
            out.append((f"max_hold={v}", {**q, "max_hold": v}))
    for v in (round(q["stop_atr"] * 0.6, 1), round(q["stop_atr"] * 1.5, 1)):
        out.append((f"stop_atr={v:g}", {**q, "stop_atr": v}))
    for v in (100, 150, 250):
        out.append((f"trend_n={v}", {**q, "trend_n": v}))
    out.append(("trend_n=0 (no filter)", {**q, "trend_n": 0}))
    for v in (10, 40):
        out.append((f"atr_n={v}", {**q, "atr_n": v}))
    return out


def exposure(res) -> dict:
    """Implied notional exposure of the taken trades relative to account equity."""
    t = res.taken
    eq = res.equity
    if len(t) == 0:
        return {}
    from fxlab.instruments import INSTRUMENTS
    notional = t.lots * np.array([INSTRUMENTS[s].contract for s in t.symbol]) \
        * t.entry_mid * t.q_entry
    gross = pd.Series(0.0, index=eq.index)
    days = eq.index.values
    for (a, b, v) in zip(t.entry_time.dt.normalize().values, t.exit_time.dt.normalize().values,
                         notional.to_numpy()):
        i0 = np.searchsorted(days, a, side="left")
        i1 = np.searchsorted(days, b, side="left")
        if i1 > i0:
            gross.iloc[i0:i1] += v
    lev = gross / eq
    stop_pct = (t.stop_dist / t.entry_mid)
    eq_at_entry = eq.reindex(t.entry_time.dt.normalize(), method="ffill").to_numpy()
    per_trade = notional.to_numpy() / eq_at_entry
    return {"avg_leverage_all_days": float(lev.mean()),
            "avg_leverage_when_invested": float(lev[lev > 0].mean()) if (lev > 0).any() else 0.0,
            "max_leverage": float(lev.max()), "time_in_market": float((lev > 0).mean()),
            "avg_stop_pct": float(stop_pct.mean()),
            "avg_notional_per_trade_x_equity": float(np.nanmean(per_trade))}


def fmt_row(name: str, m: dict) -> str:
    if not m:
        return f"| {name} | n/a |||||||||"
    return (f"| {name} | {m.get('cagr', 0):.2%} | {m.get('max_dd', 0):.1%} | "
            f"{m.get('sharpe', 0):.2f} | {m.get('mar', 0):.2f} | {m.get('trades', 0)} | "
            f"{m.get('avg_R', 0):.3f} | {m.get('t_stat_R', 0):.2f} | "
            f"{m.get('profit_factor_R', 0):.2f} | {m.get('win_rate', 0):.1%} | "
            f"{m.get('worst_year', 0):.1%} |")


HEADER = ("| period | CAGR | maxDD | Sharpe | MAR | trades | avg R (net) | t(R) | PF(R) | win | "
          "worst yr |\n|---|---|---|---|---|---|---|---|---|---|---|")


def final_report(search: Search, chosen: dict) -> dict:
    strat = make(chosen)
    print(f"\n#### FINAL: {describe(chosen)}\n")
    ev = evaluate(strat, UNIVERSE, periods=("is", "oos", "full", "pst_pre", "pst_oos"))
    ev2 = evaluate(strat, UNIVERSE, periods=("is", "oos"), cost_mult=2.0)
    metrics = {p: {k: v for k, v in ev[p].items() if not k.startswith("_")}
               for p in ("is", "oos", "pst_pre", "pst_oos") if p in ev}
    metrics["is_cost2x"] = {k: v for k, v in ev2["is"].items() if not k.startswith("_")}
    metrics["oos_cost2x"] = {k: v for k, v in ev2["oos"].items() if not k.startswith("_")}
    print(HEADER)
    for p in ("is", "oos", "is_cost2x", "oos_cost2x", "pst_pre", "pst_oos"):
        print(fmt_row(p, metrics.get(p, {})))
    full = ev["full"]
    print(fmt_row("full 2005-2020/05", {k: v for k, v in full.items() if not k.startswith("_")}))

    # pst coverage
    from fxlab.backtest import _bars
    cov = {}
    for s in UNIVERSE:
        try:
            b = _bars("pst", s, "D1")
            cov[s] = f"{b.index[0].date()}..{b.index[-1].date()}"
        except Exception:
            cov[s] = "n/a"
    print("pst coverage:", cov)

    # exposure
    ex_is = exposure(ev["is"]["_result"])
    ex_full = exposure(full["_result"])
    print("\nimplied exposure (full 2005-2020/05):",
          {k: round(v, 3) for k, v in ex_full.items()})

    # per symbol
    print("\nper-symbol net R (IS):")
    ps_is = per_symbol_R(ev["is"]["_result"])
    print(ps_is.round(3).to_string())
    print("\nper-symbol net R (OOS):")
    ps_oos = per_symbol_R(ev["oos"]["_result"])
    print(ps_oos.round(3).to_string())
    print("\nper-symbol net R (pst_pre / pst_oos):")
    ps_pp = per_symbol_R(ev["pst_pre"]["_result"]) if "pst_pre" in ev else pd.DataFrame()
    ps_po = per_symbol_R(ev["pst_oos"]["_result"]) if "pst_oos" in ev else pd.DataFrame()
    print(ps_pp.round(3).to_string())
    print(ps_po.round(3).to_string())

    # long/short split
    t_full = full["_result"].taken
    ls = t_full.groupby(np.where(t_full.dir > 0, "long", "short")).R_net.agg(["size", "mean"])
    print("\nlong/short split (full):\n", ls.round(3).to_string())

    # per year
    py = per_year(full["_result"])
    print("\nper-year return (full, 1% risk):")
    print(py.map(lambda x: f"{x:.2%}").to_string())
    py_pst = per_year(ev["pst_pre"]["_result"]) if "pst_pre" in ev else pd.Series(dtype=float)
    py_pst_oos = per_year(ev["pst_oos"]["_result"]) if "pst_oos" in ev else pd.Series(dtype=float)

    # exit reasons
    print("\nexit reasons (full):", t_full.reason.value_counts().to_dict())
    print("avg hold days (full):", round(float(((t_full.exit_time - t_full.entry_time)
                                                 .dt.total_seconds() / 86400).mean()), 2))
    print("swap JPY / commission JPY (full):", round(float(t_full.swap_jpy.sum())),
          round(float(t_full.commission_jpy.sum())), " gross price-R avg:",
          round(float(t_full.R.mean()), 3))

    skips = full["_result"].trades.skip_reason.value_counts().to_dict()
    print("skip reasons (full):", skips)

    # gold check (not part of the portfolio).  At 500k JPY most gold signals are below
    # the 0.01-lot minimum with a 4xATR stop, so the signal is checked on a 10M JPY account.
    from fxlab.engine import PortfolioConfig, RiskSchedule
    from fxlab.instruments import CostModel
    big = PortfolioConfig(initial_jpy=10_000_000, risk=RiskSchedule(base_risk=0.01),
                          costs=CostModel())
    gold = evaluate(strat, CHECK_SYMBOLS, periods=("is", "oos", "pst_pre", "pst_oos"), cfg=big)
    gold_m = {p: {k: v for k, v in gold[p].items() if not k.startswith("_")} for p in gold}
    print("\nGOLD CHECK (XAUUSD alone, not in portfolio; 10M JPY account to avoid min-lot skips):")
    print(HEADER)
    for p in ("is", "oos", "pst_pre", "pst_oos"):
        print(fmt_row(p, gold_m.get(p, {})))

    # neighbours (IS logged as trials; OOS for reporting only)
    print("\nneighbours (one-at-a-time):")
    nb_rows = []
    for name, q in neighbours(chosen):
        m_is = search.run(q, "robustness")
        m_oos = evaluate(make(q), UNIVERSE, periods=("oos",))["oos"]
        nb_rows.append({"change": name, "is_sharpe": m_is.get("sharpe"),
                        "is_cagr": m_is.get("cagr"), "is_trades": m_is.get("trades"),
                        "is_avgR": m_is.get("avg_R"), "oos_sharpe": m_oos.get("sharpe"),
                        "oos_cagr": m_oos.get("cagr"), "oos_avgR": m_oos.get("avg_R"),
                        "oos_trades": m_oos.get("trades")})
    nb = pd.DataFrame(nb_rows)
    print(nb.round(3).to_string(index=False))

    # IS leaderboard
    recs = [json.loads(x) for x in open(search.log.path)]
    recs = [r for r in recs if r["period"] == "is" and r["params"]["p"]["tf"] == "D1"
            and r["params"]["u"] == UNIVERSE]
    recs.sort(key=lambda r: r["metrics"].get("sharpe", 0.0), reverse=True)
    print("\nIS top-10 D1 configs by Sharpe (all logged trials on the 7-index universe):")
    for r in recs[:10]:
        m = r["metrics"]
        print(f"  {describe(r['params']['p'])}  sharpe={m['sharpe']:.2f} "
              f"n={m['trades']} avgR={m['avg_R']:.3f} t={m['t_stat_R']:.2f}")

    # deliverables
    eq = full["_result"].equity
    (ROOT / "reports" / "equity").mkdir(parents=True, exist_ok=True)
    (ROOT / "reports" / "trades").mkdir(parents=True, exist_ok=True)
    eq.to_frame("equity").to_parquet(ROOT / "reports" / "equity" / f"{FAMILY}.parquet")
    tk = full["_result"].taken.copy()
    tk.to_parquet(ROOT / "reports" / "trades" / f"{FAMILY}.parquet")

    return {"params": chosen, "metrics": metrics, "is_eval": ev["is"],
            "exposure_full": ex_full, "exposure_is": ex_is, "gold": gold_m,
            "neighbours": nb, "per_year": py, "per_year_pst_pre": py_pst,
            "per_year_pst_oos": py_pst_oos, "ps_is": ps_is, "ps_oos": ps_oos,
            "ps_pst_pre": ps_pp, "ps_pst_oos": ps_po}


# --------------------------------------------------------------------------- diagnostics
def forward_excess(chosen: dict) -> pd.DataFrame:
    """Entry-signal test independent of exits/stops/costs: mean forward return (next
    open -> open h bars later, in ATR(atr_n) units of the signal bar) after every
    signal bar vs. after every trend-up bar, pooled over the indices.  (t-stats ignore
    overlapping windows and cross-index correlation, so they are optimistic.)"""
    from fxlab.backtest import _bars
    q = canon(chosen)
    strat = make(q)
    rows = []
    for src, syms in (("oanda", UNIVERSE), ("pst", [s for s in UNIVERSE if s != "AUS200"])):
        for sym in syms:
            from fxlab.backtest import SymbolContext
            ctx = SymbolContext(sym, src)
            d = ctx.bars("D1")
            dec = strat.decisions(ctx)
            import fxlab.indicators as I
            a = I.atr(d, q["atr_n"])
            c = d["close"]
            up = (c > I.sma(c, q["trend_n"])) if q["trend_n"] else pd.Series(True, index=d.index)
            for h in (1, 3, 5, 10):
                fr = (d["open"].shift(-1 - h) - d["open"].shift(-1)) / a
                rows.append(pd.DataFrame({"fr": fr, "sig": dec["long_entry"], "up": up,
                                          "h": h, "src": src}))
    D = pd.concat(rows).dropna()
    D = D[D.up]
    t = D.index
    D["period"] = np.where(t < pd.Timestamp("2005-01-01"), "pre2005",
                           np.where(t < pd.Timestamp("2015-01-01"), "2005-14",
                                    np.where(t < pd.Timestamp("2020-05-15"), "2015-20/05",
                                             "2020/05-24/03")))
    D["src_period"] = D.src + " " + D.period

    def f(x):
        s_ = x.fr[x.sig]
        diff = s_.mean() - x.fr.mean()
        return pd.Series({"n_signals": int(x.sig.sum()), "signal_fwd_atr": s_.mean(),
                          "all_uptrend_fwd_atr": x.fr.mean(), "excess_atr": diff,
                          "t_naive": diff / (s_.std() / math.sqrt(len(s_)))})
    return D.groupby(["src_period", "h"]).apply(f)


def cost_breakdown(res) -> pd.DataFrame:
    from fxlab.instruments import INSTRUMENTS
    t = res.taken.copy()
    cm = res.cfg.costs
    t["mid_R"] = t.dir * (t.exit_mid - t.entry_mid) / t.stop_dist
    t["spread_slip_R"] = [(2 * cm.half_spread_plus_slip(INSTRUMENTS[s]) +
                           (cm.stop_slip(INSTRUMENTS[s]) if r == "stop" else 0.0)) / sd
                          for s, r, sd in zip(t.symbol, t.reason, t.stop_dist)]
    t["commission_R"] = t.commission_jpy / t.risk_jpy
    t["swap_R"] = t.swap_jpy / t.risk_jpy
    t["comm_pct_notional"] = t.commission_jpy / (t.lots * t.entry_mid * t.q_entry)
    g = t.groupby("symbol")[["mid_R", "spread_slip_R", "commission_R", "swap_R", "R_net",
                             "comm_pct_notional"]].mean()
    g.loc["ALL"] = t[["mid_R", "spread_slip_R", "commission_R", "swap_R", "R_net",
                      "comm_pct_notional"]].mean()
    return g


def jpn_commission_sensitivity(res) -> dict:
    """Net R if JPN225 paid the same commission (as % of notional) as the median of the
    other indices (the 72 JPY / 1-unit lot assumption makes JPN225 ~10-20x dearer)."""
    t = res.taken.copy()
    pct = t.commission_jpy / (t.lots * t.entry_mid * t.q_entry)
    ref = float(pct[t.symbol != "JPN225"].median())
    j = t.symbol == "JPN225"
    adj_comm = np.where(j, ref * t.lots * t.entry_mid * t.q_entry, t.commission_jpy)
    r_adj = (t.pnl_jpy + t.commission_jpy - adj_comm) / t.risk_jpy
    return {"ref_comm_pct_notional": ref, "jpn_avg_R_model": float(t.R_net[j].mean()),
            "jpn_avg_R_adjusted": float(r_adj[j].mean()),
            "all_avg_R_model": float(t.R_net.mean()), "all_avg_R_adjusted": float(r_adj.mean())}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fresh", action="store_true")
    args = ap.parse_args()
    search = Search(args.fresh)
    print("################ selection with rule v1 (superseded, kept for the record)")
    RULE["v"] = "v1"
    chosen_v1 = run_search(search)
    # the v1 choice was the final config of the first run: its IS neighbours were
    # evaluated then, so they are part of the trial count (re-created here)
    for _, q in neighbours(chosen_v1):
        search.run(q, "robustness_v1")
    print("################ selection with rule v2 (final)")
    RULE["v"] = "v2"
    chosen = run_search(search)
    out = final_report(search, chosen)
    if canon(chosen_v1) != canon(chosen):
        print(f"\n#### rule-v1 choice (superseded): {describe(chosen_v1)}")
        ev1 = evaluate(make(chosen_v1), UNIVERSE, periods=("is", "oos", "pst_pre", "pst_oos"))
        print(HEADER)
        for p in ("is", "oos", "pst_pre", "pst_oos"):
            if p in ev1:
                print(fmt_row(p, {k: v for k, v in ev1[p].items() if not k.startswith("_")}))
        nb1 = []
        for name, q in neighbours(chosen_v1):
            m_is = search.run(q, "robustness_v1")
            m_oos = evaluate(make(q), UNIVERSE, periods=("oos",))["oos"]
            nb1.append({"change": name, "is_sharpe": m_is.get("sharpe"),
                        "is_trades": m_is.get("trades"), "oos_sharpe": m_oos.get("sharpe"),
                        "oos_avgR": m_oos.get("avg_R")})
        print("rule-v1 neighbours:")
        print(pd.DataFrame(nb1).round(3).to_string(index=False))
        out["v1"] = {"params": canon(chosen_v1),
                     "metrics": {p: short_metrics(ev1[p]) for p in ev1}}
    print("\n#### DIAGNOSTICS (not used for selection)")
    fx = forward_excess(chosen)
    print("\nentry-signal forward returns (ATR units) vs all uptrend days:")
    print(fx.round(3).to_string())
    out["forward_excess"] = fx
    for per in ("is", "oos"):
        res = evaluate(make(chosen), UNIVERSE, periods=(per,))[per]["_result"]
        cb = cost_breakdown(res)
        print(f"\ncost breakdown per trade in R ({per}):")
        print(cb.round(4).to_string())
        out[f"cost_{per}"] = cb
        js = jpn_commission_sensitivity(res)
        print(f"JPN225 commission sensitivity ({per}):", {k: round(v, 4) for k, v in js.items()})
        out[f"jpn_{per}"] = js
    # post-hoc subset: US indices only (NOT a selection; the universe was fixed a priori)
    us = ["US500", "NAS100", "US2000"]
    m_us_is = search.run(chosen, "diag_us_only", universe=us)
    ev_us = evaluate(make(chosen), us, periods=("oos", "pst_pre", "pst_oos"))
    print("\nPOST-HOC diagnostic, US indices only (US500 NAS100 US2000) - not a selection:")
    print(HEADER)
    print(fmt_row("is", m_us_is))
    us_m = {"is": short_metrics(m_us_is)}
    for p in ("oos", "pst_pre", "pst_oos"):
        mm = {k: v for k, v in ev_us[p].items() if not k.startswith("_")}
        print(fmt_row(p, mm))
        us_m[p] = short_metrics(mm)
    out["us_only"] = us_m
    # deflated Sharpe with ALL unique IS configs logged (incl. neighbours / diagnostics)
    n_trials = search.n_trials
    dsr = dsr_for(out["is_eval"], out["is_eval"]["_result"], n_trials)
    out["n_trials"], out["dsr_is"] = n_trials, dsr
    print(f"\nn_trials (unique IS configs logged) = {n_trials}   DSR(IS) = {dsr:.4f}")
    summary = {"params": out["params"], "dsr_is": out["dsr_is"], "n_trials": out["n_trials"],
               "metrics": {p: short_metrics(m) for p, m in out["metrics"].items()},
               "exposure_full": out["exposure_full"]}
    print("\nSUMMARY_JSON " + json.dumps(summary, default=float))
    return out


if __name__ == "__main__":
    main()
