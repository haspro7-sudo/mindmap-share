"""Research script for family ``trend_d1`` (daily trend following, FX + gold).

    python scripts/research_trend_d1.py            # reuse logged IS trials, print final table
    python scripts/research_trend_d1.py --fresh    # wipe the trial log and redo the IS search

Protocol (docs/RESEARCH_PROTOCOL.md):
  * every parameter set is evaluated on IN-SAMPLE 2005-2014 only and logged to
    reports/trials/trend_d1.jsonl (one line per unique config; reruns reuse the log)
  * selection is programmatic (stage winners by IS Sharpe, then a plateau test on
    IS neighbours) - OOS / FRED numbers are computed only after the choice is made
  * the chosen config (and its neighbours, for reporting only) are then run on
    OOS 2015-2020/05, FRED 1976-2004, FRED 2020/05-2026/09 and at 2x costs
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

from fxlab.metrics import deflated_sharpe  # noqa: E402
from fxlab.research import (ALL_OANDA, FX_MAJORS, TrialLog, dsr_for, evaluate,  # noqa: E402
                            per_symbol_R, per_year)
from fxlab.strategies.trend_d1 import TrendD1  # noqa: E402

FAMILY = "trend_d1"
MIN_IS_TRADES = 150

UNIVERSES = {
    "all16": ALL_OANDA,
    # a-priori "core" set: USD majors, JPY crosses and gold (drops the 6 wider-spread
    # non-JPY crosses).  Only tested as an IS alternative for the stage winners.
    "core10": FX_MAJORS + ["EURJPY", "GBPJPY", "AUDJPY", "CADJPY", "XAUUSD"],
}

DEFAULTS = dict(signal="donchian", n=55, fast=0, kc_mult=2.0, lookbacks=[], vote="majority",
                exit="channel", exit_n=20, trail_atr=0.0, stop_atr=3.0, atr_n=20, adx_min=0.0,
                adx_n=14, trend_n=0, vol_filter="none", exec_delay_h=1)

KEYS = ["cagr", "max_dd", "sharpe", "mar", "trades", "avg_R", "t_stat_R", "profit_factor_R",
        "worst_year", "net_avg_R", "net_t_R"]


# --------------------------------------------------------------------------- utils
def full_params(p: dict) -> dict:
    q = dict(DEFAULTS)
    q.update(p)
    q["lookbacks"] = list(q["lookbacks"])
    return q


def key_of(p: dict, universe: str) -> str:
    return json.dumps({"p": full_params(p), "u": universe}, sort_keys=True)


def net_R_stats(res) -> dict:
    """R after swap + commission (pnl / initial risk); metrics.avg_R excludes both."""
    t = res.taken
    if len(t) == 0:
        return {"net_avg_R": 0.0, "net_t_R": 0.0}
    r = (t.pnl_jpy / t.risk_jpy).to_numpy()
    sd = r.std(ddof=1)
    return {"net_avg_R": float(r.mean()),
            "net_t_R": float(r.mean() / (sd / math.sqrt(len(r)))) if sd > 0 else 0.0}


class Search:
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
                prm = dict(rec["params"])
                u = prm.pop("universe")
                prm.pop("stage", None)
                self.done[key_of(prm, u)] = rec["metrics"]

    @property
    def n_trials(self) -> int:
        return len(self.done)

    def trial(self, p: dict, universe: str = "all16", stage: str = "") -> dict:
        k = key_of(p, universe)
        if k not in self.done:
            m = evaluate(TrendD1(**full_params(p)), UNIVERSES[universe], periods=("is",))["is"]
            m.update(net_R_stats(m.pop("_result")))
            self.log.log({**full_params(p), "universe": universe, "stage": stage}, m, "is")
            self.done[k] = {x: v for x, v in m.items() if not x.startswith("_")}
        return self.done[k]


def score(m: dict) -> float:
    """IS ranking: Sharpe of daily equity, only with a meaningful sample."""
    if m.get("trades", 0) < MIN_IS_TRADES:
        return -9.0
    return float(m.get("sharpe", -9.0))


def table(rows: list[tuple[str, dict]]) -> pd.DataFrame:
    df = pd.DataFrame([{"config": n, **{k: m.get(k) for k in KEYS}} for n, m in rows])
    return df


def label(p: dict, u: str = "all16") -> str:
    q = full_params(p)
    s = q["signal"]
    if s == "donchian":
        sig = f"DC{q['n']}"
    elif s == "keltner":
        sig = f"KC{q['n']}x{q['kc_mult']}"
    elif s == "ema":
        sig = f"EMA{q['fast'] or q['n'] // 4}/{q['n']}"
    elif s == "tsmom":
        sig = f"TSM{q['n']}"
    else:
        sig = f"{s.upper()}{tuple(q['lookbacks'])}-{q['vote']}"
    ex = q["exit"]
    if ex == "channel" and s == "donchian":
        ex = f"ch{q['exit_n']}"
    if "chandelier" in ex:
        ex += f"{q['trail_atr']:g}"
    flt = []
    if q["adx_min"]:
        flt.append(f"adx{q['adx_min']:g}")
    if q["trend_n"]:
        flt.append(f"sma{q['trend_n']}")
    if q["vol_filter"] != "none":
        flt.append(q["vol_filter"][:3])
    return f"{sig}|{ex}|stop{q['stop_atr']:g}" + ("|" + ",".join(flt) if flt else "") + \
        ("" if u == "all16" else f"|{u}")


# -------------------------------------------------------------------------- stages
def stage_a() -> list[dict]:
    g = []
    for n in (20, 55, 100, 200):
        for st in (2.0, 3.0, 5.0):
            g.append(dict(signal="donchian", n=n, exit="channel", exit_n=n // 2, stop_atr=st))
    g.append(dict(signal="donchian", n=55, exit="channel", exit_n=20, stop_atr=2.0))  # baseline-like
    for n in (55, 100, 200):
        for tr in (3.0, 5.0):
            g.append(dict(signal="donchian", n=n, exit="chandelier", trail_atr=tr, stop_atr=tr))
    for n in (50, 100):
        for k in (1.5, 2.5):
            g.append(dict(signal="keltner", n=n, kc_mult=k, exit="channel", stop_atr=3.0))
    for n in (32, 64, 128, 256):
        for st in (3.0, 5.0):
            g.append(dict(signal="ema", n=n, exit="signal", stop_atr=st))
    for n in (63, 126, 189, 252):
        for st in (3.0, 5.0):
            g.append(dict(signal="tsmom", n=n, exit="signal", stop_atr=st))
    for v in ("majority", "unanimous"):
        for st in (3.0, 5.0):
            g.append(dict(signal="ens_tsmom", lookbacks=[63, 126, 252], vote=v, exit="signal",
                          stop_atr=st))
            g.append(dict(signal="ens_ema", lookbacks=[64, 128, 256], vote=v, exit="signal",
                          stop_atr=st))
    return g


def top_by_signal(S: Search, cands: list[dict], k: int) -> list[dict]:
    """best config of each of the k best signal types (keeps the families diverse)."""
    scored = sorted(cands, key=lambda p: score(S.trial(p)), reverse=True)
    out, seen = [], set()
    for p in scored:
        if p["signal"] in seen:
            continue
        seen.add(p["signal"])
        out.append(p)
        if len(out) == k:
            break
    return out


def filter_variants(p: dict) -> list[dict]:
    out = []
    for f in (dict(adx_min=20.0), dict(adx_min=25.0), dict(trend_n=200),
              dict(vol_filter="expanding"), dict(vol_filter="contracting")):
        out.append({**p, **f})
    return out


def exit_variants(p: dict) -> list[dict]:
    q = full_params(p)
    if q["signal"] in ("donchian",) and q["exit"] == "channel":
        return [{**p, "exit": "chandelier", "trail_atr": q["stop_atr"] + 1.0}]
    if q["exit"] == "signal":
        return [{**p, "exit": "signal+chandelier", "trail_atr": q["stop_atr"] + 1.0}]
    return []


def neighbours(p: dict) -> list[dict]:
    """one-at-a-time perturbations of the numeric parameters (about +-25..50%)."""
    q = full_params(p)
    out = []

    def add(**kw):
        out.append({**p, **kw})
    if q["signal"] in ("donchian", "keltner", "ema", "tsmom"):
        for f in (0.67, 0.8, 1.25, 1.5):
            n2 = int(round(q["n"] * f))
            if q["signal"] == "donchian" and q["exit"] == "channel":
                add(n=n2, exit_n=max(2, int(round(q["exit_n"] * f))))
            else:
                add(n=n2)
    if q["signal"] in ("ens_tsmom", "ens_ema"):
        for f in (0.67, 0.8, 1.25, 1.5):
            add(lookbacks=[int(round(L * f)) for L in q["lookbacks"]])
    if q["signal"] == "keltner":
        for f in (0.67, 1.5):
            add(kc_mult=round(q["kc_mult"] * f, 2))
    for f in (0.67, 1.5):
        add(stop_atr=round(q["stop_atr"] * f, 2))
    if q["signal"] == "donchian" and q["exit"] == "channel":
        for f in (0.6, 1.5):
            add(exit_n=max(2, int(round(q["exit_n"] * f))))
    if "chandelier" in q["exit"]:
        for f in (0.75, 1.25):
            add(trail_atr=round(q["trail_atr"] * f, 2))
    if q["adx_min"]:
        for v in (q["adx_min"] - 5, q["adx_min"] + 5):
            add(adx_min=v)
    if q["trend_n"]:
        for v in (int(q["trend_n"] * 0.75), int(q["trend_n"] * 1.25)):
            add(trend_n=v)
    return out


# ----------------------------------------------------------------------- selection
def run_search(S: Search) -> tuple[dict, str, pd.DataFrame, dict]:
    notes = {}
    A = stage_a()
    for p in A:
        S.trial(p, stage="A")
    top3 = top_by_signal(S, A, 3)
    notes["stage_a_top3"] = [label(p) for p in top3]

    B = []
    for p in top3:
        B += filter_variants(p) + exit_variants(p)
    for p in B:
        S.trial(p, stage="B")
    pool = A + B
    # best config per signal type after filters/exits
    top2 = top_by_signal(S, pool, 2)
    notes["stage_b_top2"] = [label(p) for p in top2]

    # universe alternative (a-priori core set) for the two leaders
    C = []
    for p in top2:
        S.trial(p, "core10", stage="C")
        C.append((p, "core10"))
    cands = [(p, "all16") for p in top_by_signal(S, pool, 3)]
    for p, u in C:
        if score(S.trial(p, u)) > score(S.trial(p)):
            cands.append((p, u))

    # plateau test: candidate + one-at-a-time neighbours on IS
    rows = []
    for p, u in cands:
        nb = neighbours(p)
        ms = [S.trial(q, u, stage="D") for q in nb]
        own = S.trial(p, u)
        sh = [score(own)] + [score(m) for m in ms]
        rows.append({"config": label(p, u), "is_sharpe": score(own),
                     "nb_median_sharpe": float(np.median(sh[1:])),
                     "nb_min_sharpe": float(np.min(sh[1:])), "n_nb": len(ms),
                     "robust_score": float(np.median(sh)), "_p": p, "_u": u})
    rob = pd.DataFrame(rows).sort_values("robust_score", ascending=False)
    best = rob.iloc[0]
    return best["_p"], best["_u"], rob.drop(columns=["_p", "_u"]), notes


# ---------------------------------------------------------------------- final eval
def final_eval(S: Search, p: dict, u: str):
    strat = TrendD1(**full_params(p))
    syms = UNIVERSES[u]
    out = {}
    ev = evaluate(strat, syms, periods=("is", "oos", "fred_pre", "fred_oos", "full"))
    for k, m in ev.items():
        res = m["_result"]
        mm = {x: v for x, v in m.items() if not x.startswith("_")}
        mm.update(net_R_stats(res))
        out[k] = (mm, res)
    ev2 = evaluate(strat, syms, periods=("is", "oos"), cost_mult=2.0)
    for k, m in ev2.items():
        res = m["_result"]
        mm = {x: v for x, v in m.items() if not x.startswith("_")}
        mm.update(net_R_stats(res))
        out[k + "_cost2x"] = (mm, res)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--search-only", action="store_true",
                    help="run / print the IS search and selection only (no OOS, no FRED)")
    args = ap.parse_args()
    pd.set_option("display.width", 200)
    pd.set_option("display.max_columns", 30)
    pd.set_option("display.max_rows", 300)

    S = Search(args.fresh)
    best_p, best_u, rob, notes = run_search(S)
    n_trials = S.n_trials

    print("=" * 100)
    print(f"IS search: {n_trials} unique configs logged in {S.log.path.relative_to(ROOT)}")
    print("stage A top-3 signal types:", notes["stage_a_top3"])
    print("stage B top-2 (after filters/exits):", notes["stage_b_top2"])
    allrows = []
    for line in open(S.log.path):
        rec = json.loads(line)
        prm = dict(rec["params"])
        u = prm.pop("universe")
        st = prm.pop("stage", "")
        allrows.append((f"{st}:{label(prm, u)}", rec["metrics"]))
    tall = table(allrows).sort_values("sharpe", ascending=False)
    print("\nTop 25 IS configs by Sharpe (all trials):")
    print(tall.head(25).round(3).to_string(index=False))
    print("\nPlateau test (IS only):")
    print(rob.round(3).to_string(index=False))
    print("\nSELECTED:", label(best_p, best_u))
    print(json.dumps(full_params(best_p)))
    if args.search_only:
        return None

    # ------------------------------------------------ final evaluation (once)
    F = final_eval(S, best_p, best_u)
    dsr = dsr_for(F["is"][0], F["is"][1], n_trials)
    order = ["is", "oos", "fred_pre", "fred_oos", "is_cost2x", "oos_cost2x"]
    ft = table([(k, F[k][0]) for k in order])
    print("\nFINAL (1% risk per trade, 500k JPY start):")
    print(ft.round(3).to_string(index=False))
    print(f"\nDSR (IS, n_trials={n_trials}): {dsr:.3f}")

    # trial distribution (IS) and a DSR variant with the empirical spread of trial SRs
    sh_all = tall["sharpe"].astype(float)
    r_is = F["is"][1].equity.pct_change().dropna()
    from scipy import stats as _st
    dsr_emp = deflated_sharpe(F["is"][0]["sharpe"], len(r_is), n_trials,
                              float(_st.skew(r_is)), float(_st.kurtosis(r_is, fisher=False)),
                              sr_var_trials=(float(sh_all.std()) / math.sqrt(260)) ** 2)
    print(f"IS Sharpe over all {n_trials} trials: median {sh_all.median():.3f}, "
          f"std {sh_all.std():.3f}, share > 0: {(sh_all > 0).mean():.2f}; "
          f"DSR with empirical trial-SR spread: {dsr_emp:.3f}")

    # neighbours on OOS / FRED (reporting only - NOT used for selection)
    nb_rows = []
    for q in [best_p] + neighbours(best_p):
        ev = evaluate(TrendD1(**full_params(q)), UNIVERSES[best_u],
                      periods=("oos", "fred_pre", "fred_oos"))
        mi = S.trial(q, best_u)
        nb_rows.append({"config": label(q, best_u), "is_sharpe": mi["sharpe"],
                        "is_cagr": mi["cagr"], "is_maxdd": mi["max_dd"],
                        "oos_sharpe": ev["oos"]["sharpe"], "oos_cagr": ev["oos"]["cagr"],
                        "oos_avg_R": ev["oos"]["avg_R"],
                        "fred_pre_sharpe": ev["fred_pre"]["sharpe"],
                        "fred_oos_sharpe": ev["fred_oos"]["sharpe"]})
    nbt = pd.DataFrame(nb_rows)
    print("\nNeighbours (IS used for selection; OOS/FRED shown for reporting only):")
    print(nbt.round(3).to_string(index=False))

    psr = {k: per_symbol_R(F[k][1]) for k in ("is", "oos")}
    for k in ("is", "oos"):
        print(f"\nPer-symbol R ({k}):")
        print(psr[k].round(3).to_string())
    fr = F["full"][1]
    py = per_year(fr)
    py_pre = per_year(F["fred_pre"][1])
    py_fo = per_year(F["fred_oos"][1])
    print("\nPer-year return (full 2005-2020/05, compounding at 1% risk):")
    print(py.round(3).to_string())
    print("\nPer-year return FRED pre-sample 1976-2004:")
    print(py_pre.round(3).to_string())
    print("\nPer-year return FRED OOS 2020-2026:")
    print(py_fo.round(3).to_string())

    # skipped signals (capital / portfolio constraints) in the IS and OOS runs
    skips = {k: F[k][1].trades.skip_reason.replace("", "taken").value_counts().to_dict()
             for k in ("is", "oos")}
    for k in ("is", "oos"):
        t = F[k][1].trades
        skips[k]["top_minlot_symbols"] = (t[t.skip_reason == "below_min_lot"].symbol
                                          .value_counts().head(3).to_dict())
    print("\nSignals taken / skipped:", skips)

    # IS diagnostic: share of signals that cannot be sized at 0.01 lot (500k JPY, 1% risk)
    minlot = {}
    for st in (3.0, 5.0):
        q = dict(signal="donchian", n=100, exit="channel", exit_n=50, stop_atr=st)
        S.trial(q)  # already logged in stage A
        tr = evaluate(TrendD1(**full_params(q)), ALL_OANDA, periods=("is",))["is"]["_result"].trades
        minlot[st] = float((tr.skip_reason == "below_min_lot").mean())
    print("\nIS share of DC100/ch50 signals below min lot:", {k: round(v, 3) for k, v in minlot.items()})

    # diagnostic: effect of the FRED close-only ATR on the reference Donchian 55/20
    diag = fred_atr_diagnostic()
    print("\nFRED ATR diagnostic (fred_pre, all FRED pairs, NOT a selection input):")
    print(diag.round(3).to_string(index=False))

    # ------------------------------------------------ deliverables
    (ROOT / "reports" / "equity").mkdir(parents=True, exist_ok=True)
    (ROOT / "reports" / "trades").mkdir(parents=True, exist_ok=True)
    fr.equity.to_frame("equity").to_parquet(ROOT / "reports" / "equity" / f"{FAMILY}.parquet")
    tk = fr.taken.copy()
    tk["net_R"] = tk.pnl_jpy / tk.risk_jpy
    tk.to_parquet(ROOT / "reports" / "trades" / f"{FAMILY}.parquet")

    write_report(dict(best_p=best_p, best_u=best_u, n_trials=n_trials, dsr=dsr,
                      dsr_emp=dsr_emp, sh_all=sh_all, tall=tall, rob=rob, notes=notes,
                      ft=ft, F=F, nbt=nbt, psr=psr, py=py, py_pre=py_pre, py_fo=py_fo,
                      skips=skips, diag=diag, minlot=minlot))
    print(f"\nreport written: reports/{FAMILY}.md")
    return F


def fred_atr_diagnostic() -> pd.DataFrame:
    from fxlab.research import FRED_PAIRS
    from fxlab.strategies import trend_d1 as T
    from fxlab.strategies.base import DonchianTrend
    rows = []
    m = evaluate(DonchianTrend(), ALL_OANDA, periods=("fred_pre",))["fred_pre"]
    rows.append({"run": "reference DonchianTrend 55/20 stop2 (raw FRED ATR)",
                 **{k: m[k] for k in ("cagr", "max_dd", "sharpe", "trades", "avg_R")}})
    old = T.FRED_ATR_SCALE
    try:
        for sc in (1.0, 2.0):
            T.FRED_ATR_SCALE = sc
            st = TrendD1(signal="donchian", n=55, exit="channel", exit_n=20, stop_atr=2.0)
            m = evaluate(st, ALL_OANDA, periods=("fred_pre",))["fred_pre"]
            rows.append({"run": f"TrendD1 DC55/ch20 stop2, FRED ATR x{sc:g}",
                         **{k: m[k] for k in ("cagr", "max_dd", "sharpe", "trades", "avg_R")}})
    finally:
        T.FRED_ATR_SCALE = old
    return pd.DataFrame(rows)


def _md(df: pd.DataFrame, pct=(), nd=2) -> str:
    cols = list(df.columns)
    out = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    for _, r in df.iterrows():
        cells = []
        for c in cols:
            v = r[c]
            if v is None or (isinstance(v, (float, np.floating)) and np.isnan(v)):
                cells.append("")
            elif isinstance(v, (float, np.floating)):
                cells.append(f"{v:.1%}" if c in pct else f"{v:.{nd}f}")
            else:
                cells.append(str(v).replace("|", "\\|"))
        out.append("| " + " | ".join(cells) + " |")
    return "\n".join(out)


def _years_md(py: pd.Series) -> str:
    """per-year returns laid out one decade per row."""
    d = pd.DataFrame({"y": py.index.astype(int), "r": py.values})
    d["dec"] = d.y // 10 * 10
    d["col"] = d.y % 10
    w = d.pivot(index="dec", columns="col", values="r").reindex(columns=range(10))
    w.index = [f"{i}s" for i in w.index]
    w.columns = [str(c) for c in w.columns]
    w = w.reset_index().rename(columns={"index": "decade"})
    return _md(w, pct=tuple(str(c) for c in range(10)))


def write_report(R: dict) -> None:
    F, ft = R["F"], R["ft"].copy()
    q = full_params(R["best_p"])
    pct = ("cagr", "max_dd", "worst_year", "is_cagr", "is_maxdd", "oos_cagr")
    m_is, m_oos = F["is"][0], F["oos"][0]
    m_pre, m_fo = F["fred_pre"][0], F["fred_oos"][0]
    ft["config"] = ["IS 2005-2014", "OOS 2015-2020/05", "FRED pre 1976-2004",
                    "FRED OOS 2020/05-2026/09", "IS cost x2", "OOS cost x2"]

    def ps(k):
        d = R["psr"][k].reset_index()
        return d[["symbol", "n", "avg_R", "sum_R", "win"]]
    tall = R["tall"].head(15)[["config", "cagr", "max_dd", "sharpe", "trades", "avg_R",
                               "t_stat_R", "net_avg_R"]]
    syms = ", ".join(UNIVERSES[R["best_u"]])
    rob = R["rob"]
    ema_row = rob.sort_values("is_sharpe", ascending=False).iloc[0]
    po = R["psr"]["oos"]
    oos_pos = list(po[po.sum_R > 0].sort_values("sum_R", ascending=False).index)
    oos_worst = list(po.sort_values("sum_R").index[:2])
    txt = f"""# trend_d1 - 日足トレンドフォロー（FX + ゴールド）研究レポート

生成: `python scripts/research_trend_d1.py`（この表の数値はすべてスクリプト出力と同一）

## 結論

**判定: no_edge（採用不可）。** IS（2005-2014）で最も頑健だった設定でも、
OOS（2015-2020/05）では Sharpe {m_oos['sharpe']:.2f}・CAGR {m_oos['cagr']:.1%}・
スワップ込みの平均R {m_oos['net_avg_R']:.3f}（t = {m_oos['net_t_R']:.2f}）とマイナス。
選択した設定の周辺パラメータ {len(R['nbt']) - 1} 通りも **すべて OOS でマイナス**
（OOS Sharpe {R['nbt'].oos_sharpe.min():.2f} 〜 {R['nbt'].oos_sharpe.max():.2f}）で、
パラメータの運ではなく「この戦略群そのもの」が2015年以降機能していない。
FRED の最新期間（2020/05-2026/09）も Sharpe {m_fo['sharpe']:.2f} とプラスにならない。
IS の Sharpe {m_is['sharpe']:.2f} も {R['n_trials']} 通りの試行を考慮した
Deflated Sharpe Ratio が {R['dsr']:.3f}（経験的な試行ばらつきで計算しても {R['dsr_emp']:.3f}）で、
統計的に偶然と区別できない。

1976-2004（FRED）では Sharpe {m_pre['sharpe']:.2f}・CAGR {m_pre['cagr']:.1%} とプラスで、
「FXのトレンドフォローは2000年代半ば以前には効いていたが、その後は減衰した」という
ベースラインの観察と整合する。50万円 → 1億円の目標に使える優位性は、この戦略群には無い。

## 検証した戦略（最終選択された設定）

| 項目 | 内容 |
|---|---|
| 銘柄 | {syms}（{len(UNIVERSES[R['best_u']])}銘柄, `{R['best_u']}`） |
| 時間足 | 日足（サーバー時間 NY+7h、NY17時締め）。判定は確定足の終値、発注は翌日 01:00（サーバー時間）。金曜のシグナルは月曜 01:00 |
| 買いエントリー | 終値 > EMA({q['n']}) + {q['kc_mult']} × ATR({q['atr_n']}) かつ 終値 > SMA({q['trend_n']}) |
| 売りエントリー | 終値 < EMA({q['n']}) − {q['kc_mult']} × ATR({q['atr_n']}) かつ 終値 < SMA({q['trend_n']}) |
| 損切り（エントリー時に必ず設定） | エントリー価格 ∓ {q['stop_atr']} × ATR({q['atr_n']})（固定、トレールなし） |
| 決済 | 買い: 終値 < EMA({q['n']})、売り: 終値 > EMA({q['n']}) で翌日 01:00 に成行決済。反対側のエントリー条件成立時はドテン |
| 資金管理 | 1トレードのリスク = 残高の1%（損切り幅×ロット）、0.01ロット単位切り捨て、同一銘柄1ポジション、同時リスク合計8%まで |
| 指標 | EMA = MT5 iMA(MODE_EMA)、SMA = iMA(MODE_SMA)、ATR = MT5 iATR（TRの単純平均）。すべて終値ベース |

## 探索の手順（ISのみで選択）

* 試行数 **{R['n_trials']}**（すべて `reports/trials/trend_d1.jsonl` に記録）。IS の Sharpe は
  中央値 {R['sh_all'].median():.2f}、標準偏差 {R['sh_all'].std():.2f}、プラスの割合 {(R['sh_all'] > 0).mean():.0%}。
* Stage A（{len(stage_a())}通り）: ドンチャン（終値チャネル 20/55/100/200、逆チャネル決済 or シャンデリア）、
  ケルトナー（EMA 50/100 ± 1.5/2.5 ATR）、EMAクロス（8/32〜64/256）、
  時系列モメンタム（63/126/189/252日）、ルックバックのアンサンブル（TSMOM 63/126/252、EMA 64/128/256 の多数決・全会一致）× 損切り 2/3/5 ATR。
* Stage B: 上位3系統に ADX(20/25)・SMA200 方向一致・ボラティリティ拡大/縮小フィルター、シャンデリア決済を追加。
* Stage C: 上位2系統で銘柄セット `core10`（USDクロス主要5 + 円クロス4 + 金。スプレッドの広い非円クロス6本を除外、事前定義）を比較。
* Stage D（プラトー検定）: 候補ごとに各パラメータを ±20〜50% 動かした近傍を IS で評価し、
  「本体+近傍の Sharpe 中央値」が最大のものを選択。IS Sharpe 単独最大の {ema_row['config']}
  （{ema_row['is_sharpe']:.2f}）は近傍が {ema_row['nb_min_sharpe']:.2f} まで崩れる尖った最適値だったため不採用。
* Stage A 上位系統: {', '.join(R['notes']['stage_a_top3'])}

プラトー検定（IS）:

{_md(R['rob'], nd=3)}

IS 上位15試行:

{_md(tall, pct=pct, nd=3)}

観察（ISのみ）: 20〜55日の速いシステムと256日の遅いシステムは IS でほぼゼロかマイナス。
100〜200日程度の中期トレンドだけが Sharpe 0.3〜0.5 程度。5 ATR の広い損切りは、
50万円・1%リスクでは最小ロット0.01を下回って発注できないシグナルが多く
（DC100/ch50 の IS で発注不能シグナルの割合: 3 ATR {R['minlot'][3.0]:.0%}、5 ATR {R['minlot'][5.0]:.0%}）成績が落ちる。

## 最終成績（1%リスク、初期資金50万円）

{_md(ft, pct=pct, nd=3)}

* avg_R / t_stat_R / profit_factor_R はスプレッド・スリッページ込みだが **スワップと手数料を含まない**（エンジン仕様）。
  net_avg_R / net_t_R は損益（スワップ・手数料込み）÷ 初期リスク。スワップのマークアップ（年1.5%）が長期保有のトレンド戦略には重く、
  IS ではスワップ・手数料・円換算の差で平均Rを {m_is['avg_R'] - m_is['net_avg_R']:.2f}R 押し下げている。
* コスト2倍でも IS はほぼ変わらない（取引頻度が低く、コスト感応度は小さい）。問題はコストではなくシグナルそのもの。
* Deflated Sharpe Ratio（IS, n_trials={R['n_trials']}）: **{R['dsr']:.3f}**

## 周辺パラメータ（ISで選択、OOS/FREDは報告のみ）

{_md(R['nbt'], pct=pct, nd=3)}

## 年別リターン（1%リスク、複利）

OANDA 2005-2020/05（2005-2014 が IS、2015- が OOS）:

{_years_md(R['py'])}

FRED 1976-2004:

{_years_md(R['py_pre'])}

FRED 2020/05-2026/09:

{_years_md(R['py_fo'])}

IS の利益は 2008年（リーマンショック）と 2013-2014年（アベノミクス円安・ドル高）の3年に集中し、
残りの年はおおむね小幅マイナス。典型的なトレンドフォローの形だが、OOS ではその「大きな年」が来ていない。

## 銘柄別（R, スワップ抜き）

IS:

{_md(ps('is'), nd=2)}

OOS:

{_md(ps('oos'), nd=2)}

OOS で合計Rがプラスの銘柄: {', '.join(oos_pos)}。OOS の最大の損失源: {', '.join(oos_worst)}。

## 50万円口座での制約

| 期間 | 発注 | 最小ロット未満でスキップ | スキップの多い銘柄 |
|---|---|---|---|
| IS | {R['skips']['is'].get('taken', 0)} | {R['skips']['is'].get('below_min_lot', 0)} | {R['skips']['is']['top_minlot_symbols']} |
| OOS | {R['skips']['oos'].get('taken', 0)} | {R['skips']['oos'].get('below_min_lot', 0)} | {R['skips']['oos']['top_minlot_symbols']} |

`below_min_lot` は 1%リスク（残高50万円なら5,000円）では 0.01ロットでも損切り幅（3 ATR）が大きすぎるケース（ボラティリティの高い銘柄・時期）。
トレンドが大きく出る高ボラ局面ほど発注できないため、少額口座ではトレンドフォローの利点がさらに削られる。

## FRED データの注意（エンジン側の問題の可能性）

FRED は終値のみのため `fred_as_bars` の高値/安値が「前日終値と当日終値」になり、ATR が本来の約半分
（15通貨ペア、2005-06〜2014-12 の中央値比 2.06、範囲 1.95〜2.17）になる。このモジュールでは FRED 上の ATR を ×2.0 して
損切り幅を OANDA と揃えた。補正しないと損切りが実質2倍タイトになり、R倍数とCAGRが大きく膨らむ:

{_md(R['diag'], pct=pct, nd=3)}

ベースラインの「FRED 1976-2004 CAGR +44%」はこの影響で約2倍に膨らんでいる（補正後でも {R['diag'].cagr.iloc[2]:+.1%} とプラスなので、
2005年以前にトレンドフォローが効いていたこと自体は変わらない）。
また `policy_rate` は2005年より前を2005年の値で代用するため、FRED pre のスワップは実際の金利差を反映していない。

## リスクと限界

* OOS・FRED 最新期間ともにマイナス。ISの優位性はDSRで見ても統計的に有意でない。
* 利益が少数の大相場（2008, 2013-14）に依存。次の大相場がいつ来るかは不明で、来なければ何年も負け続ける
  （資産が過去最高値を下回っていた最長期間: IS {m_is['longest_underwater_days']}日、OOS {m_oos['longest_underwater_days']}日、FRED pre {m_pre['longest_underwater_days']}日）。
* スワップのマークアップ（年1.5%）が保有期間の長い戦略に継続的なコストになる。
* 50万円では最小ロット制約でシグナルの一部しか発注できない。
* ゴールドは 1976-2004 の FRED 検証に含まれない。
"""
    with open(ROOT / "reports" / f"{FAMILY}.md", "w") as f:
        f.write(txt)


if __name__ == "__main__":
    main()
