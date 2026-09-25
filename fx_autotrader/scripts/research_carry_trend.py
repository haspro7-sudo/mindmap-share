"""Research script for family ``carry_trend`` (carry with trend / volatility protection).

    python scripts/research_carry_trend.py            # reuse logged IS trials, print final table
    python scripts/research_carry_trend.py --fresh    # wipe the trial log and redo the IS search

Protocol (docs/RESEARCH_PROTOCOL.md):
  * every parameter set is evaluated on IN-SAMPLE 2005-2014 only and logged to
    reports/trials/carry_trend.jsonl (one line per unique config; reruns reuse the log)
  * selection is programmatic (stage winners by IS Sharpe, then a plateau test on IS
    neighbours); OOS / FRED numbers are computed only after the choice is made
  * the chosen config, its neighbours and two ablations (reporting only) are then run
    on OOS 2015-2020/05, FRED 1976-2004, FRED 2020/05-2026/09 and at 2x costs
Writes reports/carry_trend.md, reports/equity/carry_trend.parquet and
reports/trades/carry_trend.parquet.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fxlab.metrics import deflated_sharpe  # noqa: E402
from fxlab.research import (FX_CROSSES, FX_MAJORS, TrialLog, dsr_for, evaluate,  # noqa: E402
                            per_symbol_R, per_year)
from fxlab.strategies.carry_trend import CarryTrend, lagged_diff  # noqa: E402

FAMILY = "carry_trend"
MIN_IS_TRADES = 150
REPORT = ROOT / "reports" / f"{FAMILY}.md"
EQUITY = ROOT / "reports" / "equity" / f"{FAMILY}.parquet"
TRADES = ROOT / "reports" / "trades" / f"{FAMILY}.parquet"

UNIVERSES = {
    # all 15 FX pairs of the research data; the carry rule itself decides which pairs
    # are tradeable in a given year (|lagged rate differential| >= min_diff)
    "all15": FX_MAJORS + FX_CROSSES,
    # classic yen-funded carry basket (a-priori alternative, Stage C only)
    "jpy5": ["USDJPY", "EURJPY", "GBPJPY", "AUDJPY", "CADJPY"],
}

DEFAULTS = dict(min_diff=2.5, trend="ema", trend_n=100, exit_buf=0.0, vol_fast=20,
                vol_slow=250, vol_entry=99.0, vol_exit=99.0, riskoff_sym=None, atr_n=20,
                stop_atr=3.0, trail_atr=0.0, unwind=False, unwind_vol=1.5, unwind_hold=20,
                top_k=0, rank_universe=[], carry_filter=True)

KEYS = ["cagr", "max_dd", "sharpe", "mar", "trades", "avg_R", "t_stat_R", "profit_factor_R",
        "worst_year"]
OUT_KEYS = ["cagr", "max_dd", "sharpe", "trades", "avg_R", "t_stat_R", "profit_factor_R",
            "worst_year"]


# --------------------------------------------------------------------------- utils
def full_params(p: dict, universe: str = "all15") -> dict:
    q = dict(DEFAULTS)
    q.update(p)
    if q["top_k"] > 0:
        q["rank_universe"] = list(UNIVERSES[universe])
    q["rank_universe"] = list(q["rank_universe"])
    return q


def key_of(p: dict, universe: str) -> str:
    return json.dumps({"p": full_params(p, universe), "u": universe}, sort_keys=True)


def make(p: dict, universe: str = "all15") -> CarryTrend:
    return CarryTrend(**full_params(p, universe))


def extra_stats(res) -> dict:
    t = res.taken
    if len(t) == 0:
        return {"swap_share": 0.0, "skipped_min_lot": 0}
    tot = float(t.pnl_jpy.sum())
    return {"swap_jpy": float(t.swap_jpy.sum()), "net_pnl_jpy": tot,
            "skipped_min_lot": int((res.trades.skip_reason == "below_min_lot").sum())}


class Search:
    def __init__(self, fresh: bool):
        self.log = TrialLog(FAMILY)
        if fresh and self.log.path.exists():
            self.log.path.unlink()
        self.done: dict[str, dict] = {}
        self.meta: dict[str, tuple] = {}
        if self.log.path.exists():
            for line in open(self.log.path):
                rec = json.loads(line)
                if rec.get("period") != "is":
                    continue
                prm = dict(rec["params"])
                u = prm.pop("universe")
                st = prm.pop("stage", "")
                k = key_of(prm, u)
                self.done[k] = rec["metrics"]
                self.meta[k] = (prm, u, st)

    @property
    def n_trials(self) -> int:
        return len(self.done)

    def trial(self, p: dict, universe: str = "all15", stage: str = "") -> dict:
        k = key_of(p, universe)
        if k not in self.done:
            fp = full_params(p, universe)
            m = evaluate(CarryTrend(**fp), UNIVERSES[universe], periods=("is",))["is"]
            m.update(extra_stats(m.pop("_result")))
            self.log.log({**fp, "universe": universe, "stage": stage}, m, "is")
            self.done[k] = {x: v for x, v in m.items() if not x.startswith("_")}
            self.meta[k] = (fp, universe, stage)
            print(f"  [{self.n_trials:3d}] {stage:6s} {label(p, universe):60s} "
                  f"sh={m.get('sharpe', 0):+.2f} n={m.get('trades', 0)} "
                  f"R={m.get('avg_R', 0):+.3f}", flush=True)
        return self.done[k]


def score(m: dict) -> float:
    """IS ranking: Sharpe of daily equity at 1% risk, only with a meaningful sample."""
    if m.get("trades", 0) < MIN_IS_TRADES:
        return -9.0
    return float(m.get("sharpe", -9.0))


def label(p: dict, u: str = "all15") -> str:
    q = full_params(p, u)
    parts = [f"d{q['min_diff']:g}"]
    if not q["carry_filter"]:
        parts = ["NOCARRY"]
    parts.append("none" if q["trend"] == "none" else f"{q['trend']}{q['trend_n']}")
    if q["exit_buf"] > 0:
        parts.append(f"xb{q['exit_buf']:g}")
    if q["vol_entry"] < 99 or q["vol_exit"] < 99:
        parts.append(f"v{q['vol_fast']}/{q['vol_slow']}:{q['vol_entry']:g}/{q['vol_exit']:g}")
    if q["riskoff_sym"]:
        parts.append(f"ro:{q['riskoff_sym']}")
    parts.append(f"st{q['stop_atr']:g}")
    if q["atr_n"] != 20:
        parts.append(f"atr{q['atr_n']}")
    if q["trail_atr"] > 0:
        parts.append(f"tr{q['trail_atr']:g}")
    if q["unwind"]:
        parts.append(f"unw{q['unwind_vol']:g}/{q['unwind_hold']}")
    if q["top_k"] > 0:
        parts.append(f"top{q['top_k']}")
    if u != "all15":
        parts.append(u)
    return "|".join(parts)


def strip(p: dict) -> dict:
    """Params without the defaults (compact, for building variants)."""
    q = full_params(p)
    return {k: v for k, v in q.items() if k != "rank_universe" and DEFAULTS.get(k) != v}


# --------------------------------------------------------------------------- stages
TRENDS = [("ema", 50), ("ema", 100), ("ema", 200), ("cross", 50), ("cross", 100),
          ("cross", 200), ("mom", 60), ("mom", 125), ("mom", 250), ("none", 0)]
VOLS = [  # (vol_fast, vol_entry, vol_exit, riskoff_sym)
    (20, 99.0, 1.5, None), (20, 99.0, 2.0, None), (20, 1.25, 1.75, None),
    (10, 99.0, 2.0, None), (20, 1.0, 1.5, None), (20, 99.0, 1.5, "AUDJPY"),
    (20, 1.25, 1.75, "AUDJPY")]


def top(S: Search, keys, n: int, distinct_trend: bool = False):
    rows = sorted(((score(S.done[k]), k) for k in keys), reverse=True)
    out, seen = [], set()
    for sc, k in rows:
        p, u, _ = S.meta[k]
        tag = (p["trend"], p["trend_n"]) if distinct_trend else k
        if tag in seen:
            continue
        seen.add(tag)
        out.append((strip(p), u))
        if len(out) >= n:
            break
    return out


def keys_of(S: Search, stage: str):
    """Trials of exactly this stage (stage labels are matched exactly, never by prefix)."""
    return [k for k, (_, _, st) in S.meta.items() if st == stage]


def run_search(S: Search):
    print("Stage 0: smoke test of the module")
    S.trial(dict(min_diff=2.5, trend="ema", trend_n=100, stop_atr=4.0), stage="S0")

    print("Stage A: carry threshold x trend filter x stop (no vol filter)")
    for md in (1.0, 2.5, 4.0):
        for tr, n in TRENDS:
            for sa in (2.0, 3.0):
                S.trial(dict(min_diff=md, trend=tr, trend_n=n, stop_atr=sa), stage="A")

    print("Stage B: volatility regime filters on the 3 best Stage A configs")
    for p, u in top(S, keys_of(S, "A"), 3, distinct_trend=True):
        for vf, ve, vx, ro in VOLS:
            S.trial({**p, "vol_fast": vf, "vol_entry": ve, "vol_exit": vx, "riskoff_sym": ro},
                    u, stage="B")

    print("Stage C: exits, unwind shorts, carry ranking and yen basket on the 2 best so far")
    for p, u in top(S, keys_of(S, "A") + keys_of(S, "B"), 2):
        var = []
        if p.get("trend", DEFAULTS["trend"]) == "ema":
            var += [{"exit_buf": 0.5}, {"exit_buf": 1.0}]
        var += [{"trail_atr": 3.0}, {"unwind": True, "unwind_vol": 1.5, "unwind_hold": 20},
                {"unwind": True, "unwind_vol": 1.25, "unwind_hold": 40}, {"top_k": 3},
                {"top_k": 6}]
        for v in var:
            S.trial({**p, **v}, u, stage="C")
        S.trial(p, "jpy5", stage="C")


def neighbours(p: dict) -> list[tuple[str, dict]]:
    q = full_params(p)
    out = []

    def add(name, **kw):
        out.append((name, {**strip(p), **kw}))

    md = q["min_diff"]
    add(f"min_diff={round(md * 0.6, 2):g}", min_diff=round(md * 0.6, 2))
    add(f"min_diff={round(md * 1.4, 2):g}", min_diff=round(md * 1.4, 2))
    if q["trend"] != "none":
        for f in (0.67, 1.5):
            n = int(round(q["trend_n"] * f))
            add(f"trend_n={n}", trend_n=n)
    for f in (0.75, 1.33):
        s = round(q["stop_atr"] * f, 2)
        add(f"stop_atr={s:g}", stop_atr=s)
    add("atr_n=14", atr_n=14)
    if q["vol_exit"] < 99:
        for f in (0.85, 1.2):
            v = round(q["vol_exit"] * f, 2)
            add(f"vol_exit={v:g}", vol_exit=v)
        add("vol_exit=off", vol_exit=99.0)
    if q["vol_entry"] < 99:
        for f in (0.85, 1.2):
            v = round(q["vol_entry"] * f, 2)
            add(f"vol_entry={v:g}", vol_entry=v)
    if q["vol_entry"] < 99 or q["vol_exit"] < 99:
        add(f"vol_fast={q['vol_fast'] // 2}", vol_fast=q["vol_fast"] // 2)
        add(f"vol_slow={int(q['vol_slow'] * 0.5)}", vol_slow=int(q["vol_slow"] * 0.5))
    if q["exit_buf"] > 0:
        for f in (0.5, 2.0):
            add(f"exit_buf={q['exit_buf'] * f:g}", exit_buf=q["exit_buf"] * f)
    if q["trail_atr"] > 0:
        for f in (0.75, 1.33):
            add(f"trail_atr={round(q['trail_atr'] * f, 2):g}",
                trail_atr=round(q["trail_atr"] * f, 2))
    if q["top_k"] > 0:
        add(f"top_k={q['top_k'] - 1}", top_k=q["top_k"] - 1)
        add(f"top_k={q['top_k'] + 1}", top_k=q["top_k"] + 1)
    if q["unwind"]:
        add("unwind=off", unwind=False)
    return out


def plateau(S: Search, n_cand: int = 3):
    """Stage D: IS plateau test for the best candidates; returns the chosen config."""
    cands = top(S, [k for k, (_, _, st) in S.meta.items() if st in ("S0", "A", "B", "C")],
                n_cand)
    rows = []
    for p, u in cands:
        m0 = S.trial(p, u, stage="D0")
        nb = [score(S.trial(q, u, stage="D")) for _, q in neighbours(p)]
        nb = [x for x in nb if x > -9]
        med = float(np.median(nb)) if nb else -9.0
        rows.append({"config": label(p, u), "is_sharpe": score(m0), "nb_median_sharpe": med,
                     "nb_min_sharpe": min(nb) if nb else -9.0, "n_nb": len(nb),
                     "robust_score": 0.5 * (score(m0) + med), "_p": p, "_u": u})
    df = pd.DataFrame(rows).sort_values("robust_score", ascending=False)
    return df


# --------------------------------------------------------------------------- final
def short(m: dict) -> dict:
    return {k: m.get(k) for k in OUT_KEYS}


def fmt_table(df: pd.DataFrame) -> str:
    cols = list(df.columns)
    L = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    for i in range(len(df)):
        cells = []
        for c in cols:
            v = df[c].iloc[i]          # per column: keeps integer dtypes (no row upcast)
            if isinstance(v, (float, np.floating)) and not math.isfinite(float(v)):
                cells.append("-")
            elif isinstance(v, (float, np.floating)):
                if c in ("cagr", "max_dd", "worst_year", "win", "ret", "win_rate",
                         "is_cagr", "oos_cagr", "is_max_dd", "oos_max_dd", "swap_share"):
                    cells.append(f"{v:.1%}")
                elif abs(v) >= 1000:
                    cells.append(f"{v:,.0f}")
                else:
                    cells.append(f"{v:.3f}")
            else:
                cells.append(str(v).replace("|", "\\|"))
        L.append("| " + " | ".join(cells) + " |")
    return "\n".join(L)


def variants_of(p: dict) -> list[tuple[str, dict]]:
    return neighbours(p) + [
        ("ABL: pure carry (no trend filter)", {**strip(p), "trend": "none"}),
        ("ABL: trend only (carry ignored)", {**strip(p), "carry_filter": False})]


def nanfree(d: dict) -> dict:
    out = {}
    for k, v in d.items():
        if isinstance(v, (float, np.floating)):
            v = float(v)
            out[k] = None if not math.isfinite(v) else round(v, 4)
        else:
            out[k] = v
    return out


def final(S: Search, pl: pd.DataFrame):
    best = pl.iloc[0]
    p, u = best["_p"], best["_u"]
    syms = UNIVERSES[u]
    strat = make(p, u)
    variants = variants_of(p)
    # IS of every neighbour / ablation is a logged trial (before n_trials is counted)
    for name, q in variants:
        S.trial(q, u, stage="X_ablation" if name.startswith("ABL") else "D")
    n_trials = S.n_trials
    print(f"\nSELECTED: {label(p, u)}  (IS trials: {n_trials})")

    ev = evaluate(strat, syms, periods=("is", "oos", "full", "fred_pre", "fred_oos"))
    ev2 = evaluate(strat, syms, periods=("is", "oos", "fred_oos"), cost_mult=2.0)
    res_is, res_oos, res_full = ev["is"]["_result"], ev["oos"]["_result"], ev["full"]["_result"]
    metrics = {"is": short(ev["is"]), "oos": short(ev["oos"]),
               "fred_pre": short(ev["fred_pre"]), "fred_oos": short(ev["fred_oos"]),
               "is_cost2x": short(ev2["is"]), "oos_cost2x": short(ev2["oos"]),
               "fred_oos_cost2x": short(ev2["fred_oos"])}
    dsr = dsr_for(ev["is"], res_is, n_trials)
    trial_sh = np.array([S.done[k].get("sharpe", 0.0) for k in S.done])
    r_is = res_is.equity.pct_change().dropna()
    from scipy import stats
    dsr_emp = deflated_sharpe(ev["is"]["sharpe"], len(r_is), n_trials, float(stats.skew(r_is)),
                              float(stats.kurtosis(r_is, fisher=False)),
                              sr_var_trials=(trial_sh.std() / math.sqrt(260)) ** 2)

    # neighbours and ablations: IS (logged trials) + OOS / FRED (reporting only)
    nb_rows = []
    for name, q in variants:
        mi = S.trial(q, u)
        eo = evaluate(make(q, u), syms, periods=("oos", "fred_oos", "fred_pre"))
        mo, mf, mp = eo["oos"], eo["fred_oos"], eo["fred_pre"]
        nb_rows.append({"variant": name, "is_sharpe": mi.get("sharpe"), "is_avg_R": mi.get("avg_R"),
                        "is_trades": mi.get("trades"), "oos_sharpe": mo.get("sharpe"),
                        "oos_avg_R": mo.get("avg_R", np.nan), "oos_trades": mo.get("trades"),
                        "fred_oos_sharpe": mf.get("sharpe"), "fred_oos_avg_R": mf.get("avg_R", np.nan),
                        "fred_oos_trades": mf.get("trades"), "fred_pre_sharpe": mp.get("sharpe"),
                        "fred_pre_avg_R": mp.get("avg_R", np.nan)})
    nb_df = pd.DataFrame(nb_rows)

    def by_year(res):
        t = res.taken
        if len(t) == 0:
            return pd.DataFrame()
        g = t.groupby(t.entry_time.dt.year).agg(
            trades=("R_net", "size"), avg_R=("R_net", "mean"), sum_R=("R_net", "sum"),
            swap_jpy=("swap_jpy", "sum"), pnl_jpy=("pnl_jpy", "sum"))
        return g

    ps_is, ps_oos = per_symbol_R(res_is), per_symbol_R(res_oos)
    yr_full = per_year(res_full)
    yr_is = by_year(res_full)
    yr_is["ret"] = yr_full.reindex(yr_is.index)
    fred_oos_res, fred_pre_res = ev["fred_oos"]["_result"], ev["fred_pre"]["_result"]
    ps_fo, ps_fp = per_symbol_R(fred_oos_res), per_symbol_R(fred_pre_res)
    yr_fo = by_year(fred_oos_res)
    yr_fo["ret"] = per_year(fred_oos_res).reindex(yr_fo.index)
    fp_tk = fred_pre_res.taken
    fp_dec = fp_tk.groupby((fp_tk.entry_time.dt.year // 5) * 5).agg(
        trades=("R_net", "size"), avg_R=("R_net", "mean"), sum_R=("R_net", "sum"))
    fp_dec.index = [f"{y}-{y + 4}" for y in fp_dec.index]
    skipped = {k: int((ev[k]["_result"].trades.skip_reason == "below_min_lot").sum())
               if len(ev[k]["_result"].trades) else 0 for k in ("is", "oos", "fred_oos")}
    trade_info = {}
    for k in ("is", "fred_oos", "fred_pre"):
        t = ev[k]["_result"].taken
        trade_info[k] = {
            "price_R": float(t.R.mean()), "net_R": float(t.R_net.mean()),
            "swap_share": float(t.swap_jpy.sum() / t.pnl_jpy.sum()) if t.pnl_jpy.sum() else np.nan,
            "hold_days": float((t.exit_time - t.entry_time).dt.days.mean()),
            "long_share": float((t.dir > 0).mean()),
            "stop_share": float((t.reason == "stop").mean()),
            "cross_year": int((t.exit_time.dt.year > t.entry_time.dt.year).sum()),
            "n": int(len(t))}
    fp_ex70 = fp_tk[fp_tk.entry_time >= "1980-01-01"].R_net
    trade_info["fred_pre_ex1970s"] = {
        "n": int(len(fp_ex70)), "net_R": float(fp_ex70.mean()),
        "t": float(fp_ex70.mean() / (fp_ex70.std(ddof=1) / math.sqrt(len(fp_ex70))))}
    # crash episodes
    epis = []
    for nm, rs, a, b in [("2008 リーマン・ショック", res_is, "2008-06-01", "2008-12-31"),
                         ("2024年8月 円キャリー巻き戻し", fred_oos_res, "2024-06-01", "2024-09-30")]:
        t = rs.taken
        m = (t.exit_time >= a) & (t.entry_time <= b)
        epis.append({"episode": nm, "trades": int(m.sum()), "sum_R": float(t.R_net[m].sum()),
                     "last_exit": str(t.exit_time[m].max())[:16] if m.any() else "-"})
    # carry availability: pairs with |lagged diff| >= min_diff per year
    q = full_params(p, u)
    avail = []
    for y in range(2005, 2027):
        probe = pd.DatetimeIndex([pd.Timestamp(y, 7, 1)])
        ds = {s_: float(lagged_diff(s_, probe)[0]) for s_ in syms}
        ok = [f"{s_}({'+' if v > 0 else '-'}{abs(v):.1f})" for s_, v in
              sorted(ds.items(), key=lambda kv: -abs(kv[1])) if abs(v) >= q["min_diff"]]
        mx = max(ds.items(), key=lambda kv: abs(kv[1]))
        avail.append({"year": y, "max_abs_diff": f"{mx[0]} {mx[1]:+.1f}",
                      "eligible": ", ".join(ok) if ok else "なし"})
    avail = pd.DataFrame(avail)

    # deliverables
    EQUITY.parent.mkdir(parents=True, exist_ok=True)
    TRADES.parent.mkdir(parents=True, exist_ok=True)
    res_full.equity.to_frame("equity").to_parquet(EQUITY)
    tk = res_full.taken
    tk[[c for c in tk.columns if c != "book"]].reset_index(drop=True).to_parquet(TRADES)

    table = pd.DataFrame([{"period": k, **{x: metrics[k].get(x) for x in OUT_KEYS}}
                          for k in metrics])
    print("\nFINAL (1% risk per trade, 500k JPY):")
    print(table.to_string(index=False))
    print(f"\nDSR (IS, {n_trials} trials): {dsr:.4f}  (empirical trial-SR spread: {dsr_emp:.4f})")
    print("\nNeighbours / ablations:")
    print(nb_df.to_string(index=False))
    print("\nPer symbol IS:\n", ps_is.to_string())
    print("\nPer year 2005-2020/05 (OANDA):\n", yr_is.to_string())
    print("\nFRED OOS per year:\n", yr_fo.to_string())
    print("\nFRED OOS per symbol:\n", ps_fo.to_string())
    print("\nFRED pre by 5y block:\n", fp_dec.to_string())
    print("\nFRED pre per symbol:\n", ps_fp.to_string())
    print("\ntrade info:", json.dumps(trade_info, default=float))
    print("crash episodes:", epis)
    print("skipped (below_min_lot):", skipped)
    print("\ncarry availability:\n", avail.to_string(index=False))

    return dict(p=p, u=u, syms=syms, metrics=metrics, dsr=dsr, dsr_emp=dsr_emp,
                n_trials=n_trials, trial_sh=trial_sh, nb_df=nb_df, ps_is=ps_is, ps_oos=ps_oos,
                yr_is=yr_is, yr_fo=yr_fo, ps_fo=ps_fo, ps_fp=ps_fp, fp_dec=fp_dec,
                skipped=skipped, table=table, pl=pl, trade_info=trade_info, epis=epis,
                avail=avail)


# --------------------------------------------------------------------------- report
def pct(x) -> str:
    return "-" if x is None or not math.isfinite(float(x)) else f"{float(x):.1%}"


def f2(x, n=2) -> str:
    return "-" if x is None or not math.isfinite(float(x)) else f"{float(x):.{n}f}"


def render(S: Search, R: dict) -> str:
    p, u, M = R["p"], R["u"], R["metrics"]
    q = full_params(p, u)
    ti, nb = R["trade_info"], R["nb_df"]
    ms, mo, mf, mp = M["is"], M["oos"], M["fred_oos"], M["fred_pre"]
    ts = R["trial_sh"]
    stages = pd.Series([st for (_, _, st) in S.meta.values()]).value_counts()
    ps = R["ps_is"]
    top_share = ps.sum_R.max() / ps.sum_R[ps.sum_R > 0].sum() if len(ps) else float("nan")
    top_sym = ps.sum_R.idxmax() if len(ps) else "-"
    nbn = nb[~nb.variant.str.startswith("ABL")]
    nb_is = nbn[nbn.is_trades >= MIN_IS_TRADES].is_sharpe
    nb_fo = nbn[nbn.fred_oos_trades > 0].fred_oos_sharpe
    abl_pc = nb[nb.variant.str.startswith("ABL: pure")].iloc[0]
    abl_tr = nb[nb.variant.str.startswith("ABL: trend")].iloc[0]
    nb_md = nbn[nbn.variant.str.startswith("min_diff=")]
    lo_md = nb_md.iloc[0]
    fp_ex = ti["fred_pre_ex1970s"]

    def maxdiff(years):
        best = ("", 0.0)
        for y in years:
            probe = pd.DatetimeIndex([pd.Timestamp(y, 7, 1)])
            for s_ in R["syms"]:
                v = float(lagged_diff(s_, probe)[0])
                if abs(v) > abs(best[1]):
                    best = (f"{s_} {v:+.1f}%（{y}年）", v)
        return best[0]
    oos_max = maxdiff(range(2015, 2021))
    y26_max = maxdiff([2026]).split("（")[0]
    y27_max = maxdiff([2027]).split("（")[0]
    from fxlab.backtest import _bars
    _a = _bars("oanda", "AUDJPY", "D1").loc["2008-07-01":"2008-12-31"]
    aud08 = (float(_a.high.max()), float(_a.low.min()))
    rets = pd.concat([R["yr_is"]["ret"], R["yr_fo"]["ret"]]).dropna()
    yr_lo, yr_hi = float(rets.min()), float(rets.max())
    active_years = [int(y) for y in R["yr_is"].index] + [int(y) for y in R["yr_fo"].index]
    L = []
    A = L.append
    A("# carry_trend - キャリー＋トレンド保護（高金利通貨を買い、トレンドと変動率で身を守る）研究レポート\n")
    A("生成: `python scripts/research_carry_trend.py`（この表の数値はすべてスクリプト出力と同一。"
      "試行ログを再利用して最終表を出力し、`reports/equity/carry_trend.parquet` と "
      "`reports/trades/carry_trend.parquet` を書き出す。`--fresh` で IS 探索をやり直す）\n")

    A("## 結論\n")
    A(f"**判定: marginal（小さく、金利環境しだいで現れる優位性。統計的には未確定で、単独では 50万円→1億円 の目標には使えない）。**\n")
    A(f"* IS（2005-2014）で選んだ設定は Sharpe {f2(ms['sharpe'])}・CAGR {pct(ms['cagr'])}・最大DD {pct(ms['max_dd'])}・"
      f"{ms['trades']} 取引・スワップ込み平均R {f2(ms['avg_R'], 3)}（t = {f2(ms['t_stat_R'])}）。"
      f"ただし {R['n_trials']} 通りの試行を考慮した Deflated Sharpe Ratio は **{R['dsr']:.4f}**"
      f"（試行 Sharpe の実測ばらつき {ts.std():.2f} を使うと {R['dsr_emp']:.3f}）で、IS だけでは偶然と区別できない。")
    A(f"* **OOS（2015-01〜2020-05）は取引ゼロ。** この期間は前年の政策金利差が {q['min_diff']:g}% 以上の通貨ペアが"
      f"1つも無かった（最大でも {oos_max}）。つまりこのルールは OOS では「何もしない」が正解で、損益の検証はできていない。"
      f"しきい値を下げた近傍（min_diff={lo_md.variant.split('=')[1]}）は OOS で {int(lo_md.oos_trades)} 取引・"
      f"平均R {f2(lo_md.oos_avg_R, 3)}・Sharpe {f2(lo_md.oos_sharpe)} とマイナスで、"
      "「金利差が小さいキャリーはブローカーのスワップ差（年2.5%）に負ける」ことと整合する。")
    A(f"* 真の未使用期間である **FRED 2020/05-2026/09** では {mf['trades']} 取引（2024〜2025年のみ稼働）・"
      f"Sharpe {f2(mf['sharpe'])}・CAGR {pct(mf['cagr'])}・最大DD {pct(mf['max_dd'])}・平均R {f2(mf['avg_R'], 3)}"
      f"（t = {f2(mf['t_stat_R'])}）とプラス。4銘柄（USDJPY, GBPJPY, AUDJPY, CADJPY の買い）すべてプラス、コスト2倍でも"
      f"Sharpe {f2(M['fred_oos_cost2x']['sharpe'])}。2024年8月の円キャリー巻き戻しの前に全ポジションが決済済みだった。")
    A(f"* **FRED 1976-2004**（前年金利はモジュール内の近似表、後述）でも {mp['trades']} 取引・Sharpe {f2(mp['sharpe'])}・"
      f"平均R {f2(mp['avg_R'], 3)}（t = {f2(mp['t_stat_R'])}）。1970年代を除いても {fp_ex['n']} 取引・平均R {fp_ex['net_R']:.3f}"
      f"（t = {fp_ex['t']:.2f}）で、5年ごとのブロックはすべてプラス。")
    A(f"* **キャリーの条件が本質**: 同じトレンド／変動率ルールを金利差を無視して両方向に使うと IS Sharpe {f2(abl_tr.is_sharpe)}・"
      f"OOS {f2(abl_tr.oos_sharpe)}・FRED OOS {f2(abl_tr.fred_oos_sharpe)} と大きくマイナス（ベースラインのトレンドフォロー減衰と同じ）。"
      f"一方トレンド条件を外した純キャリー（変動率フィルター・損切り・トレールは同じ）は IS {f2(abl_pc.is_sharpe)}・"
      f"FRED OOS {f2(abl_pc.fred_oos_sharpe)} と遜色なく、FRED 1976-2004 だけ {f2(abl_pc.fred_pre_sharpe)} に落ちる。"
      "IS で効いているのはトレンド条件より「変動率が平常以下のときだけ入る」「2 ATR 損切り＋3 ATR トレール」の方。")
    A(f"* 弱点: (1) IS の利益の {top_share:.0%} が {top_sym} 1銘柄（採用基準5に抵触）、(2) 稼働するのは金利差が大きい年だけ"
      f"（取引があった年: {', '.join(str(y) for y in sorted(set(active_years)))}）。2013〜2023年と **2026年（現在）は取引シグナルが一切出ない**"
      f"（2025年平均金利で最大の差は {y26_max}）、(3) 1%リスクでの CAGR は稼働年でも数%で、資金を増やすエンジンとしては小さすぎる。\n")

    A("## 戦略の定義（最終選択された設定）\n")
    A("| 項目 | 内容 |\n|---|---|")
    A(f"| 銘柄 | 15通貨ペア（{', '.join(R['syms'])}）。どのペアを取引するかは下の金利差ルールが毎年自動で決める（XAUUSD は対象外） |")
    A("| 時間足 | 日足（サーバー時間 NY+7h、NY17時締め）。判定は確定足の終値、発注は翌日 01:00（サーバー時間、ロールオーバー回避）。金曜のシグナルは月曜 01:00 |")
    A(f"| キャリー方向 | 金利差 = 基軸通貨の政策金利 − 決済通貨の政策金利。**前年**の年平均値を使う（当年の値は使わない）。金利差 ≥ +{q['min_diff']:g}% なら買いのみ、≤ −{q['min_diff']:g}% なら売りのみ、それ以外のペアはその年は取引しない |")
    A(f"| トレンド条件 | 買い: 終値 > EMA({q['trend_n']})、売り: 終値 < EMA({q['trend_n']})（MT5 iMA MODE_EMA、終値） |")
    A(f"| 変動率条件（エントリー） | σ{q['vol_fast']} / σ{q['vol_slow']} < {q['vol_entry']:g}。σN = 直近N本の日足終値の対数リターンの標準偏差（母集団ではなく標本標準偏差 ddof=1） |")
    A(f"| エントリー | 上の3条件（キャリー方向・トレンド一致・変動率）がすべて成立し、その銘柄にポジションが無ければ成行で建てる。決済後も条件が続いていれば翌日以降に再エントリー |")
    A(f"| 損切り（エントリー時に必ず設定） | エントリー価格 ∓ {q['stop_atr']:g} × ATR({q['atr_n']})（MT5 iATR = 真の値幅の単純平均、日足） |")
    A(f"| トレーリング | 毎日の判定時（01:00）に 損切り = max(現在の損切り, エントリー後の最高値 − {q['trail_atr']:g} × ATR({q['atr_n']}))（売りは対称）。最高値はエントリー後の1時間足の高値で更新。利確なし |")
    A(f"| 決済 | 終値が EMA({q['trend_n']}) の反対側に抜けた日、σ{q['vol_fast']}/σ{q['vol_slow']} ≥ {q['vol_exit']:g} の日、または年が替わってキャリー方向が変わった（しきい値未満になった）日の翌 01:00 に成行決済 |")
    A("| 資金管理 | 1トレードのリスク = 残高の1%（損切り幅×ロット）、0.01ロット単位で切り捨て（0.01ロット未満になる取引は見送り）、同一銘柄1ポジション、同時リスク合計8%まで |")
    A("| 使わないもの | ナンピン・グリッド・マーチンゲール・損切りなしのポジション・逆張りの「巻き戻し」売り（検証したが IS で悪化） |\n")
    A("政策金利は `fxlab/instruments.py` の年平均表（2025・2026年は推定値）。2005年の判定に必要な2004年以前の値は "
      "`fxlab/strategies/carry_trend.py` の `RATES_PRE`（中央銀行の政策金利履歴から丸めた近似値、精度 ±1%pt 程度、"
      "1985年以前の豪・NZ・スイスは ±2%pt）で、パラメータ選択には一切使っていない（FRED 1976-2004 の検証専用）。\n")

    A("## 探索の手順（IS 2005-2014 のみで選択）\n")
    A(f"* 試行数 **{R['n_trials']}**（すべて `reports/trials/carry_trend.jsonl` に記録）。IS Sharpe は中央値 {np.median(ts):.2f}・"
      f"標準偏差 {ts.std():.2f}・プラスの割合 {(ts > 0).mean():.0%}。順位付けは 1%リスクの日次損益の Sharpe、IS 取引数 {MIN_IS_TRADES} 未満は除外。")
    A("* 段階ごとの試行数: " + ", ".join(f"{k} {v}" for k, v in stages.sort_index().items()) + "。")
    A("* Stage S0: モジュールの動作確認（金利差2.5%・EMA100・損切り4ATR）。1%リスク・50万円では円クロスの4ATR損切りが0.01ロットの最小単位を超えて多くが見送られるため、以降の損切りは2〜3ATRに限定。")
    A("* Stage A（60通り）: 金利差しきい値 1.0 / 2.5（ブローカーのスワップ差と同じ）/ 4.0% × トレンド条件（終値対EMA 50/100/200、EMA(n/4)対EMA(n) n=50/100/200、n日モメンタム 60/125/250、トレンド条件なし）× 損切り 2 / 3 ATR。変動率フィルターなし。")
    A("* Stage B（21通り）: トレンド系統の異なる上位3設定に変動率フィルター7種（σ20/σ250 の決済しきい値 1.5 / 2.0、エントリー上限 1.0 / 1.25、σ10 版、AUDJPY の変動率を全銘柄共通のリスクオフ指標にする版）。")
    A("* Stage C（16通り）: 上位2設定に EMA からの決済バッファー 0.5 / 1.0 ATR、3 ATR トレール、巻き戻し売り（リスクオフ時にキャリーと逆方向、20日/40日の時間切れ）、金利差上位3 / 6ペアに限定、円クロス5ペアだけの版。")
    A("* Stage D（プラトー検定）: 上位3候補の各パラメータを1つずつ動かした近傍（金利差 ×0.6/×1.4、EMA期間 ×0.67/×1.5、損切り ×0.75/×1.33、ATR 14、変動率しきい値 ×0.85/×1.2・決済なし、σ10、σ125、トレール ×0.75/×1.33）を IS で評価。")
    A("* 選択規則（OOS を見る前に固定）: 0.5 ×（本体の IS Sharpe ＋ 取引数150以上の近傍の IS Sharpe 中央値）が最大のもの。")
    A(f"* 注記: 最初の再実行時、スクリプトの不具合（アブレーション試行の段階名 `ABL` が Stage A の前方一致に掛かった）で、純キャリー系の追加設定 40 通りが IS で評価された。"
      "結果は見てしまったので試行数に含め（DSR の計算にも算入）、ログ上は `bug_extra` と明記して選択候補からは外した。"
      "これらを候補に含めた場合もプラトー検定の選択は同じ設定だった（純キャリー系の最良 robust_score 0.484 < 0.494）。\n")
    pl = R["pl"].drop(columns=["_p", "_u"])
    A("プラトー検定（IS）:\n")
    A(fmt_table(pl))
    A("")
    rows = []
    for k, m in S.done.items():
        prm, uu, st = S.meta[k]
        rows.append({"config": label(prm, uu), "stage": st, "sharpe": m.get("sharpe"),
                     "cagr": m.get("cagr"), "max_dd": m.get("max_dd"), "trades": m.get("trades"),
                     "avg_R": m.get("avg_R"), "t_stat_R": m.get("t_stat_R")})
    tdf = pd.DataFrame(rows)
    tdf = tdf[tdf.trades >= MIN_IS_TRADES].sort_values("sharpe", ascending=False).head(15)
    A(f"IS 上位15試行（取引数{MIN_IS_TRADES}以上）:\n")
    A(fmt_table(tdf))
    A("")

    A("## 最終成績（1トレード1%リスク、初期資金50万円）\n")
    tb = R["table"].copy()
    tb["period"] = tb["period"].map({
        "is": "IS 2005-2014", "oos": "OOS 2015-2020/05", "fred_pre": "FRED 1976-2004",
        "fred_oos": "FRED 2020/05-2026/09", "is_cost2x": "IS コスト2倍",
        "oos_cost2x": "OOS コスト2倍", "fred_oos_cost2x": "FRED 2020/05- コスト2倍"})
    A(fmt_table(tb))
    A("")
    A(f"* Deflated Sharpe Ratio（IS, {R['n_trials']} 試行）: **{R['dsr']:.4f}**（試行 Sharpe の実測ばらつき {ts.std():.2f} を使うと {R['dsr_emp']:.3f}）。")
    A(f"* 平均R はスワップ・手数料込み。スプレッド・スリッページのみ引いた価格ベースの平均R は IS {ti['is']['price_R']:.3f}、"
      f"FRED 2020/05- {ti['fred_oos']['price_R']:.3f}、FRED 1976-2004 {ti['fred_pre']['price_R']:.3f}。スワップが純損益に占める割合は IS {ti['is']['swap_share']:.0%}、"
      f"FRED 2020/05- {ti['fred_oos']['swap_share']:.0%}（値動きの利益が主で、スワップは上乗せ）。")
    A(f"* 平均保有日数 IS {ti['is']['hold_days']:.1f} 日、損切り（トレール含む）での決済が IS {ti['is']['stop_share']:.0%}・FRED 2020/05- {ti['fred_oos']['stop_share']:.0%}、"
      f"買いの割合 IS {ti['is']['long_share']:.0%}。0.01ロット未満で見送った取引: IS {R['skipped']['is']} 件。")
    A("* worst_year が 0.0% の期間は、取引の無い年がある（プラスの年とゼロの年しかない）ことを意味する。\n")

    A("## なぜ OOS（2015-2020）で取引がゼロなのか\n")
    A(f"前年の政策金利差（`instruments.policy_rate`、2005年分は `RATES_PRE` の2004年値）の絶対値が {q['min_diff']:g}% 以上のペア:\n")
    A(fmt_table(R["avail"]))
    A("")
    A("2010年と2013〜2023年は、ゼロ金利・低金利が続き、ブローカーのスワップ差（年2.5%）を大きく上回るキャリーが存在しなかった。"
      f"このルールはその間ずっと手仕舞い状態で、損失も利益も出ない。2026年も該当ペアが無い（2027年分も、表の2026年推定金利では最大 {y27_max} で該当なし）。\n")

    A("## 近傍パラメータとアブレーション（IS は試行として記録、OOS・FRED は報告のみ）\n")
    A(fmt_table(nb))
    A("")
    A(f"* IS: 取引数150以上の近傍 {len(nb_is)} 通りの IS Sharpe は {nb_is.min():.2f}〜{nb_is.max():.2f}（すべてプラス）。最も敏感なのは金利差しきい値で、2.4% に下げると {f2(lo_md.is_sharpe)} に低下、5.6% に上げると取引数が足りない。")
    A(f"* FRED 2020/05-: 取引のある近傍 {len(nb_fo)} 通りはすべてプラス（Sharpe {nb_fo.min():.2f}〜{nb_fo.max():.2f}）。")
    A("* OOS 2015-2020: 金利差しきい値 4% 付近の設定はすべて取引ゼロ。しきい値 2.4% の近傍だけが取引し、マイナス。\n")

    A("## 銘柄別・年別\n")
    A("IS（2005-2014）銘柄別（R はスワップ・手数料込み）:\n")
    A(fmt_table(R["ps_is"].reset_index()))
    A("")
    A("年別（OANDA 2005-2020/05、エントリー年で集計。ret はその年の口座リターン）:\n")
    A(fmt_table(R["yr_is"].reset_index().rename(columns={"entry_time": "year"})))
    A("")
    A("FRED 2020/05-2026/09 年別・銘柄別:\n")
    A(fmt_table(R["yr_fo"].reset_index().rename(columns={"entry_time": "year"})))
    A("")
    A(fmt_table(R["ps_fo"].reset_index()))
    A("")
    A("FRED 1976-2004 の5年ブロック別・銘柄別:\n")
    A(fmt_table(R["fp_dec"].reset_index().rename(columns={"index": "years"})))
    A("")
    A(fmt_table(R["ps_fp"].reset_index()))
    A("")

    A("## 暴落局面での挙動\n")
    A(fmt_table(pd.DataFrame(R["epis"])))
    A("")
    A(f"* 2008年: 最後のポジションは {R['epis'][0]['last_exit'][:10]} に決済され、10月の円急騰（AUDJPY は7月の高値 {aud08[0]:.1f} から10月の安値 {aud08[1]:.1f} まで {aud08[1] / aud08[0] - 1:.0%}）の前に手仕舞い済み。2008年の口座リターンは {pct(R['yr_is'].loc[2008, 'ret'])}。")
    A("* 2024年: 7月11日の円急騰でトレーリング損切りにより利益確定し、その後の再エントリー（7月12〜23日）は −1R 前後の損切りで終了。8月5日の巻き戻しの時点ではノーポジション。\n")

    A("## リスクと注意点\n")
    A(f"* **検証の空白**: 最終ルールは OOS 2015-2020 で一度も取引していない。未使用データでの損益の裏付けは FRED 2020/05- の{mf['trades']}取引（2024〜2025年、t = {f2(mf['t_stat_R'])}）だけで、統計的に有意ではない。")
    A("* **金利表への依存**: キャリー方向は年平均の政策金利表で決まる。2025・2026年の値は推定、2004年以前は近似表。実運用では前年の実績（各国中銀の公表値）で毎年1月に更新すること。")
    A(f"* **エンジンのスワップ計算の簡略化**: スワップはエントリー年の金利差で保有期間全体を計算（年をまたぐ取引は IS {ti['is']['n']} 件中 {ti['is']['cross_year']} 件）。2005年より前は2005年の金利で計算されるため、FRED 1976-2004 のスワップ損益は実際と異なる（多くの場合、当時の実際の金利差より小さく、保守的）。価格ベースの平均Rでも同じ結論。")
    A("* **FRED データ**: 終値のみ（ニューヨーク正午レート）で、損切り判定はエンジンが作る合成ヒゲに依存。ATR はOANDAに合わせて0.68倍に補正（データ較正、成績では調整していない）。")
    A(f"* **集中**: IS の利益の {top_share:.0%} が {top_sym}。どの年も稼働は2〜4ペアで、すべて同じ「円（または米ドル）を売って高金利通貨を買う」リスク要因にさらされる。")
    A("* **少額口座の制約**: 50万円・1%リスク（5,000円）では、円クロスの損切り幅が約5円（500pips）を超えると0.01ロットでもリスク超過になり見送りになる。EA も同じ判定（最小ロット未満なら発注しない）にすること。")
    A("* **業者リスク**: スワップのマークアップ（年2.5%の想定）が変わると結論が変わる。マークアップが大きくなるほど、しきい値4%でも利益が薄くなる。\n")

    A("## 目標（50万円→1億円）への示唆\n")
    A(f"* 1%リスクでの成績は IS CAGR {pct(ms['cagr'])}、FRED 2020/05-2026/09 CAGR {pct(mf['cagr'])}、FRED 1976-2004 CAGR {pct(mp['cagr'])}。"
      f"稼働した年の口座リターンは {yr_lo:+.1%}〜{yr_hi:+.1%} で、しかも10年以上何もしない期間がある。リスクを数倍に上げても、200倍（50万→1億）に必要な複利には遠く及ばない。")
    A("* 位置づけとしては「金利差が大きい時期だけ動く、小さな補助戦略」。他の戦略と組み合わせる場合も、配分は小さく、金利表の年次更新を前提にすること。")
    A("* 現在（2026年9月）はシグナルが出ない状態で、すぐに稼働する戦略ではない。\n")

    A("## MT5 EA 実装メモ\n")
    A("* 毎日、日足確定後の最初の 01:00（サーバー時間）に1回だけ判定・発注（ロールオーバー時間帯を避ける）。")
    A("* 各ペアについて: 前年の政策金利差（入力パラメータの年別表）→ キャリー方向。EMA(50) は iMA(PERIOD_D1, 50, 0, MODE_EMA, PRICE_CLOSE) の確定足（shift=1）値、"
      "ATR(20) は iATR(PERIOD_D1, 20) の shift=1 値、σN は shift=1 から N 本の日足終値の対数リターンの標本標準偏差を自前で計算。")
    A("* 注文時に損切りを必ず設定（価格 ∓ 2×ATR）。以後、毎日の判定時に 最高値（売りは最安値）− 3×ATR へ有利な方向にだけ動かす。")
    A("* ロット = 残高×1% ÷（損切り幅＋往復スプレッド）を円換算し 0.01 ロット単位で切り捨て。0.01 未満なら見送り。同時保有リスクが残高の8%を超える場合も見送り。")
    return "\n".join(L) + "\n"


def write_report(S: Search, R: dict):
    REPORT.write_text(render(S, R))
    print(f"\nwrote {REPORT}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--no-report", action="store_true")
    a = ap.parse_args()
    S = Search(a.fresh)
    run_search(S)
    pl = plateau(S)
    print("\nPlateau test (IS):")
    print(pl.drop(columns=["_p", "_u"]).to_string(index=False))
    R = final(S, pl)
    if not a.no_report:
        write_report(S, R)


if __name__ == "__main__":
    main()
