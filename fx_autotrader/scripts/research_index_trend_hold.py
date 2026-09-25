"""Research script for family ``index_trend_hold`` (long-biased holding of stock-index
CFDs + gold with a trend / regime filter).

    python scripts/research_index_trend_hold.py              # reuse logged IS trials, print final table
    python scripts/research_index_trend_hold.py --fresh      # wipe the trial log and redo the IS search
    python scripts/research_index_trend_hold.py --search-only

Protocol (docs/RESEARCH_PROTOCOL.md):
  * every parameter set is evaluated on IN-SAMPLE 2005-2014 only and logged to
    reports/trials/index_trend_hold.jsonl (one line per unique config; reruns reuse it)
  * each IS trial is run twice: with the standard research account (500k JPY, 1% risk)
    and with a 50M JPY account at the same 1% risk ("big"), because at 500k JPY the
    0.1-lot index minimum and the 0.01-lot (1 oz) gold minimum make many wide-stop
    entries impossible (skipped as below_min_lot).  The big run shows the rules
    without lot-granularity noise.  IS score = mean of the two IS Sharpe ratios.
  * selection is programmatic (stage winners by IS score, then a plateau test on IS
    neighbours).  OOS / pst numbers are computed only after the choice is made.
  * the chosen config, two PRE-DECLARED buy-and-hold benchmarks and the chosen
    config's neighbours (reporting only) are then run on OOS 2015-2020/05, the pst
    futures series (pre-2005 and 2020/05-2024/03) and at 2x costs.
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

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
warnings.filterwarnings("ignore")

from fxlab import backtest as B  # noqa: E402
from fxlab.engine import PortfolioConfig, RiskSchedule  # noqa: E402
from fxlab.instruments import INSTRUMENTS, CostModel  # noqa: E402
from fxlab.metrics import deflated_sharpe  # noqa: E402
from fxlab.research import (INDICES, TrialLog, dsr_for, evaluate, per_symbol_R,  # noqa: E402
                            per_year)
from fxlab.strategies.index_trend_hold import IndexTrendHold  # noqa: E402

FAMILY = "index_trend_hold"
MIN_IS_TRADES = 150        # portfolio trades on the big (no lot-rounding) IS run
MIN_IS_TRADES_500K = 100   # and on the standard 500k JPY IS run
BIG_JPY = 50_000_000

UNIVERSES = {
    "all8": INDICES + ["XAUUSD"],
    "idx7": list(INDICES),
}

DEFAULTS = dict(filter="sma", n=200, mom_n=252, band_atr=0.0, vol_max=0.0, dd_atr=0.0,
                rebalance="daily", side="long", stop_atr=5.0, atr_n=20, trail_atr=0.0,
                max_hold=260, warmup=260)

# pre-declared benchmarks (never selected; reported for comparison)
BENCH_WIDE = dict(filter="none", stop_atr=10.0, atr_n=100, max_hold=260)

KEYS = ["cagr", "max_dd", "sharpe", "mar", "trades", "avg_R", "t_stat_R", "profit_factor_R",
        "worst_year"]
BIG_KEYS = ["cagr", "max_dd", "sharpe", "trades", "avg_R", "t_stat_R"]


def big_cfg(cost_mult: float = 1.0) -> PortfolioConfig:
    return PortfolioConfig(initial_jpy=BIG_JPY, risk=RiskSchedule(base_risk=0.01),
                           costs=CostModel(multiplier=cost_mult))


# --------------------------------------------------------------------------- utils
def full_params(p: dict) -> dict:
    q = dict(DEFAULTS)
    q.update(p)
    return q


def key_of(p: dict, universe: str) -> str:
    return json.dumps({"p": full_params(p), "u": universe}, sort_keys=True)


def label(p: dict, u: str = "all8") -> str:
    q = full_params(p)
    f = q["filter"]
    if f == "none":
        s = "B&H"
    elif f in ("sma", "ema"):
        s = f"{f.upper()}{q['n']}"
    elif f == "mom":
        s = f"MOM{q['mom_n']}"
    else:
        s = f"SMA{q['n']}&MOM{q['mom_n']}"
    extra = []
    if q["band_atr"]:
        extra.append(f"band{q['band_atr']:g}")
    if q["vol_max"]:
        extra.append(f"vr<{q['vol_max']:g}")
    if q["dd_atr"]:
        extra.append(f"dd{q['dd_atr']:g}")
    if q["rebalance"] != "daily":
        extra.append("monthly")
    if q["side"] != "long":
        extra.append("L/S")
    risk = f"stop{q['stop_atr']:g}xATR{q['atr_n']}"
    if q["trail_atr"]:
        risk += f"|trail{q['trail_atr']:g}"
    risk += f"|mh{q['max_hold']}"
    return s + ("|" + ",".join(extra) if extra else "") + "|" + risk + \
        ("" if u == "all8" else f"|{u}")


def exposure_stats(res, source: str = "oanda") -> dict:
    """Implied gross notional exposure (sum |notional| of open positions / equity)."""
    eq = res.equity
    tk = res.taken
    days = eq.index
    if len(tk) == 0 or len(days) == 0:
        return {"expo_avg": 0.0, "expo_invested": 0.0, "expo_max": 0.0, "time_in_mkt": 0.0}
    conv = B.conversion_table(source)
    notional = np.zeros(len(days))
    for sym, g in tk.groupby("symbol"):
        ins = INSTRUMENTS[sym]
        cl = B._bars(source, sym, "D1")["close"].reindex(days, method="ffill").to_numpy()
        q = conv.rate(ins.quote, days + pd.Timedelta(hours=23, minutes=59))
        e0 = np.searchsorted(days.values, g.entry_time.dt.normalize().values)
        e1 = np.searchsorted(days.values, g.exit_time.dt.normalize().values)
        for a, b, lt in zip(e0, e1, g.lots.to_numpy()):
            notional[a:b] += lt * ins.contract * np.nan_to_num(cl[a:b]) * q[a:b]
    lev = notional / eq.to_numpy()
    inv = lev > 0
    return {"expo_avg": float(lev.mean()),
            "expo_invested": float(lev[inv].mean()) if inv.any() else 0.0,
            "expo_max": float(lev.max()), "time_in_mkt": float(inv.mean())}


def swap_exact(res, source: str = "oanda") -> dict:
    """Diagnostic: re-accrue each taken trade's financing day by day, on the CURRENT
    notional (previous daily close) at the rate of the CURRENT calendar year.  The
    engine charges the entry-year rate on the entry notional for the whole holding
    period, which is inexact for multi-year holds (rates moved 2005-2024)."""
    from dataclasses import replace as _replace

    from fxlab.engine import _ROLL_WEIGHT
    tk = res.taken
    if len(tk) == 0:
        return {"swap_engine": 0.0, "swap_exact": 0.0, "swap_bias_pct_yr": 0.0}
    costs = res.cfg.costs
    if source == "pst":
        costs = _replace(costs, carry_mode="futures")
    conv = B.conversion_table(source)
    total = 0.0
    for t in tk.itertuples():
        ins = INSTRUMENTS[t.symbol]
        days = pd.date_range(t.entry_time.normalize() + pd.Timedelta(days=1),
                             t.exit_time.normalize(), freq="D")
        if len(days) == 0:
            continue
        w = _ROLL_WEIGHT[days.dayofweek]
        cl = B._bars(source, t.symbol, "D1")["close"]
        px = cl.reindex(days - pd.Timedelta(days=1), method="ffill").to_numpy()
        px = np.where(np.isnan(px), t.entry_mid, px)
        q = conv.rate(ins.quote, days)
        yrs = days.year.to_numpy()
        rate = np.array([costs.swap_rate_annual(ins, int(t.dir), int(y)) for y in yrs])
        total += float((t.lots * ins.contract * px * rate / 365.0 * w * q).sum())
    eng = float(tk.swap_jpy.sum())
    years = max(len(res.equity) / 260.0, 1e-9)
    return {"swap_engine": eng, "swap_exact": total,
            "swap_bias_pct_yr": (total - eng) / years / float(res.equity.mean())}


def carry_share(res) -> dict:
    t = res.taken
    if len(t) == 0:
        return {"swap_jpy": 0.0, "comm_jpy": 0.0, "net_pnl_jpy": 0.0}
    return {"swap_jpy": float(t.swap_jpy.sum()), "comm_jpy": float(t.commission_jpy.sum()),
            "net_pnl_jpy": float(t.pnl_jpy.sum())}


def strip(m: dict) -> dict:
    return {k: v for k, v in m.items() if not k.startswith("_")}


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

    def trial(self, p: dict, universe: str = "all8", stage: str = "") -> dict:
        k = key_of(p, universe)
        if k not in self.done:
            strat = IndexTrendHold(**full_params(p))
            syms = UNIVERSES[universe]
            m = evaluate(strat, syms, periods=("is",))["is"]
            res = m.pop("_result")
            m.update(exposure_stats(res))
            mb = evaluate(strat, syms, periods=("is",), cfg=big_cfg())["is"]
            resb = mb.pop("_result")
            for x in BIG_KEYS:
                m["big_" + x] = mb.get(x)
            m["big_expo_avg"] = exposure_stats(resb)["expo_avg"]
            self.log.log({**full_params(p), "universe": universe, "stage": stage}, m, "is")
            self.done[k] = strip(m)
        return self.done[k]


def score(m: dict) -> float:
    """IS ranking: mean of the daily-equity Sharpe at 500k JPY and at 50M JPY
    (1% risk both), only with a meaningful sample."""
    if m.get("big_trades", 0) < MIN_IS_TRADES or m.get("trades", 0) < MIN_IS_TRADES_500K:
        return -9.0
    return 0.5 * (float(m.get("sharpe", -9.0)) + float(m.get("big_sharpe", -9.0)))


# -------------------------------------------------------------------------- stages
def stage_a() -> list[dict]:
    g = []
    for st in (3.0, 5.0, 8.0):                       # buy-and-hold references
        g.append(dict(filter="none", stop_atr=st))
    g.append(dict(filter="none", stop_atr=5.0, max_hold=65))
    for n in (100, 150, 200, 250):
        g.append(dict(filter="sma", n=n))
        g.append(dict(filter="ema", n=n))
    for mn in (126, 189, 252):
        g.append(dict(filter="mom", mom_n=mn))
    for n, mn in ((100, 126), (150, 189), (200, 252)):
        g.append(dict(filter="sma_mom", n=n, mom_n=mn))
    return g


def top_by_filter(S: Search, cands: list[dict], k: int, u: str = "all8",
                  exclude=("none",)) -> list[dict]:
    scored = sorted(cands, key=lambda p: score(S.trial(p, u)), reverse=True)
    out, seen = [], set()
    for p in scored:
        f = full_params(p)["filter"]
        if f in seen or f in exclude:
            continue
        seen.add(f)
        out.append(p)
        if len(out) == k:
            break
    return out


def addon_variants(p: dict) -> list[dict]:
    q = full_params(p)
    out = [{**p, "rebalance": "monthly"}]
    if q["filter"] in ("sma", "ema", "sma_mom"):
        out += [{**p, "band_atr": 0.5}, {**p, "band_atr": 1.0}]
    out += [{**p, "vol_max": 1.3}, {**p, "vol_max": 1.6}]
    out += [{**p, "dd_atr": 8.0}, {**p, "dd_atr": 12.0}]
    if q["filter"] != "none":
        out.append({**p, "side": "long_short"})
    return out


def risk_variants(p: dict) -> list[dict]:
    q = full_params(p)
    out = []
    for st, an in ((3.0, 20), (8.0, 20), (3.0, 100), (5.0, 100), (8.0, 100)):
        if (st, an) != (q["stop_atr"], q["atr_n"]):
            out.append({**p, "stop_atr": st, "atr_n": an})
    for mh in (0, 65):
        if mh != q["max_hold"]:
            out.append({**p, "max_hold": mh})
    out.append({**p, "trail_atr": q["stop_atr"] + 2.0})
    return out


def neighbours(p: dict) -> list[dict]:
    """one-at-a-time perturbations (about +-25..50%) of the numeric parameters."""
    q = full_params(p)
    out = []

    def add(**kw):
        r = {**p, **kw}
        if key_of(r, "x") != key_of(p, "x"):
            out.append(r)
    if q["filter"] in ("sma", "ema", "sma_mom"):
        for f in (0.75, 1.25):
            add(n=int(round(q["n"] * f)))
    if q["filter"] in ("mom", "sma_mom"):
        for f in (0.75, 1.25):
            add(mom_n=int(round(q["mom_n"] * f)))
    for f in (0.67, 1.5):
        add(stop_atr=round(q["stop_atr"] * f, 2))
    if q["band_atr"]:
        for f in (0.5, 1.5):
            add(band_atr=round(q["band_atr"] * f, 2))
    if q["vol_max"]:
        for d in (-0.15, 0.2):
            add(vol_max=round(q["vol_max"] + d, 2))
    if q["dd_atr"]:
        for f in (0.75, 1.25):
            add(dd_atr=round(q["dd_atr"] * f, 2))
    if q["trail_atr"]:
        for f in (0.75, 1.25):
            add(trail_atr=round(q["trail_atr"] * f, 2))
    if q["max_hold"]:
        add(max_hold=int(q["max_hold"] // 2))
        add(max_hold=0)
    return out


def run_search(S: Search):
    notes = {}
    A = stage_a()
    for p in A:
        S.trial(p, stage="A")
    top3 = top_by_filter(S, A, 3)
    notes["A_top3"] = [label(p) for p in top3]

    Bs = []
    for p in top3 + [dict(filter="none", stop_atr=5.0, max_hold=65)]:
        Bs += addon_variants(p)
    for p in Bs:
        S.trial(p, stage="B")
    pool = A + Bs
    # best three configs (distinct filter types) after add-ons
    topC = top_by_filter(S, pool, 3)
    notes["B_top3"] = [label(p) for p in topC]

    Cs = []
    for p in topC:
        Cs += risk_variants(p)
    for p in Cs:
        S.trial(p, stage="C")
    pool += Cs

    # D: for the two leaders, combine the two best single add-ons of different kinds
    # that beat their add-on-free stage-A base in stage B (evidence from stage B only)
    leaders = top_by_filter(S, pool, 2)
    Ds = []
    for p in leaders:
        f = full_params(p)["filter"]
        base = next((a for a in A if full_params(a)["filter"] == f and
                     all(full_params(a)[k] == full_params(p)[k] for k in ("n", "mom_n"))), None)
        if base is None or key_of(base, "all8") not in S.done:
            continue
        s0 = score(S.trial(base))
        gains = []
        for v in addon_variants(base):
            if key_of(v, "all8") not in S.done:
                continue
            diff = {k: w for k, w in v.items() if k not in base}
            gains.append((score(S.trial(v)), diff))
        gains = sorted([g for g in gains if g[0] > s0], key=lambda x: -x[0])
        kinds, chosen = set(), {}
        for _, d in gains:
            kd = list(d)[0]
            if kd not in kinds and kd != "side":
                kinds.add(kd)
                chosen.update(d)
            if len(kinds) == 2:
                break
        if len(kinds) == 2:
            Ds.append({**p, **chosen})
    for p in Ds:
        S.trial(p, stage="D")
    pool += Ds

    # E: universe alternative (indices only, no gold) for the two leaders
    leaders = top_by_filter(S, pool, 2)
    cands = [(p, "all8") for p in top_by_filter(S, pool, 3)]
    for p in leaders:
        if score(S.trial(p, "idx7", stage="E")) > score(S.trial(p)):
            cands.append((p, "idx7"))
    notes["candidates"] = [label(p, u) for p, u in cands]

    # F: plateau test on IS neighbours
    rows = []
    for p, u in cands:
        ms = [S.trial(q, u, stage="F") for q in neighbours(p)]
        own = S.trial(p, u)
        sh = [score(m) for m in ms]
        rows.append({"config": label(p, u), "is_score": score(own),
                     "is_sharpe_500k": own["sharpe"], "is_sharpe_50M": own["big_sharpe"],
                     "nb_median": float(np.median(sh)), "nb_min": float(np.min(sh)),
                     "n_nb": len(ms), "robust_score": float(np.median([score(own)] + sh)),
                     "_p": p, "_u": u})
    rob = pd.DataFrame(rows).sort_values("robust_score", ascending=False)
    best = rob.iloc[0]
    return best["_p"], best["_u"], rob.drop(columns=["_p", "_u"]), notes


# ---------------------------------------------------------------------- final eval
PERIODS = ("is", "oos", "pst_pre", "pst_oos", "full")


def run_all(p: dict, u: str, cfg=None, cost_mult: float = 1.0,
            periods=PERIODS) -> dict:
    strat = IndexTrendHold(**full_params(p))
    ev = evaluate(strat, UNIVERSES[u], periods=periods, cost_mult=cost_mult, cfg=cfg)
    out = {}
    for k, m in ev.items():
        res = m["_result"]
        mm = strip(m)
        mm.update(exposure_stats(res, "pst" if k.startswith("pst") else "oanda"))
        mm.update(carry_share(res))
        out[k] = (mm, res)
    return out


def final_eval(p: dict, u: str) -> dict:
    out = run_all(p, u)
    c2 = run_all(p, u, cost_mult=2.0, periods=("is", "oos"))
    out["is_cost2x"], out["oos_cost2x"] = c2["is"], c2["oos"]
    return out


def table(rows: list[tuple[str, dict]], keys=None) -> pd.DataFrame:
    keys = keys or KEYS + ["expo_avg", "expo_invested", "time_in_mkt"]
    return pd.DataFrame([{"period": n, **{k: m.get(k) for k in keys}} for n, m in rows])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--search-only", action="store_true")
    ap.add_argument("--save", action="store_true", help="write equity/trades parquet")
    args = ap.parse_args()
    pd.set_option("display.width", 220)
    pd.set_option("display.max_columns", 40)
    pd.set_option("display.max_rows", 400)

    S = Search(args.fresh)
    best_p, best_u, rob, notes = run_search(S)
    n_trials = S.n_trials

    print("=" * 110)
    print(f"IS search: {n_trials} unique configs logged in {S.log.path.relative_to(ROOT)}")
    for k, v in notes.items():
        print(f"  {k}: {v}")
    allrows = []
    for line in open(S.log.path):
        rec = json.loads(line)
        prm = dict(rec["params"])
        u = prm.pop("universe")
        st = prm.pop("stage", "")
        m = rec["metrics"]
        allrows.append({"cfg": f"{st}:{label(prm, u)}", "score": score(m),
                        **{k: m.get(k) for k in ("cagr", "max_dd", "sharpe", "trades",
                                                 "avg_R", "t_stat_R", "expo_avg")},
                        **{k: m.get(k) for k in ("big_cagr", "big_sharpe", "big_trades",
                                                 "big_expo_avg")}})
    tall = pd.DataFrame(allrows).drop_duplicates("cfg").sort_values("score", ascending=False)
    print("\nAll IS trials (score = mean of 500k and 50M IS Sharpe; -9 = too few trades):")
    print(tall.round(3).to_string(index=False))
    print("\nPlateau test (IS only):")
    print(rob.round(3).to_string(index=False))
    print("\nSELECTED:", label(best_p, best_u))
    print(json.dumps(full_params(best_p)), best_u)
    if args.search_only:
        return

    # ------------------------------------------------ final evaluation (once)
    F = final_eval(best_p, best_u)
    order = ["is", "oos", "pst_pre", "pst_oos", "is_cost2x", "oos_cost2x", "full"]
    print("\nFINAL (500k JPY start, 1% risk per trade, standard research config):")
    print(table([(k, F[k][0]) for k in order if k in F]).round(3).to_string(index=False))
    dsr = dsr_for(F["is"][0], F["is"][1], n_trials)
    sh_all = tall["sharpe"].astype(float)
    r_is = F["is"][1].equity.pct_change().dropna()
    from scipy import stats as _st
    dsr_emp = deflated_sharpe(F["is"][0]["sharpe"], len(r_is), n_trials,
                              float(_st.skew(r_is)), float(_st.kurtosis(r_is, fisher=False)),
                              sr_var_trials=(float(sh_all.std()) / math.sqrt(260)) ** 2)
    print(f"\nDSR (IS, n_trials={n_trials}): {dsr:.3f};  with empirical trial-SR spread "
          f"(std {sh_all.std():.3f}): {dsr_emp:.3f}")
    print("\nCarry detail (500k): engine swap vs exact daily accrual at current-year rate "
          "on current notional; bias = extra cost per year as a share of average equity")
    for k in ("is", "oos", "pst_pre", "pst_oos"):
        m = F[k][0]
        sx = swap_exact(F[k][1], "pst" if k.startswith("pst") else "oanda")
        print(f"  {k:8s} net pnl {m['net_pnl_jpy']:>12,.0f}  swap(engine) {sx['swap_engine']:>11,.0f}"
              f"  swap(exact) {sx['swap_exact']:>11,.0f}  commission {m['comm_jpy']:>9,.0f}"
              f"  -> CAGR impact of exact carry {sx['swap_bias_pct_yr']:+.2%}/yr")

    FB = run_all(best_p, best_u, cfg=big_cfg(), periods=("is", "oos", "pst_pre", "pst_oos"))
    FB2 = run_all(best_p, best_u, cfg=big_cfg(2.0), periods=("is", "oos"))
    FB["is_cost2x"], FB["oos_cost2x"] = FB2["is"], FB2["oos"]
    print("\nSame config on a 50M JPY account (1% risk; no min-lot skipping) - diagnostic:")
    print(table([(k, FB[k][0]) for k in ["is", "oos", "pst_pre", "pst_oos", "is_cost2x",
                                           "oos_cost2x"]]).round(3).to_string(index=False))

    # ---- concentration of the IS result
    for acct, res in (("500k", F["is"][1]), ("50M", FB["is"][1])):
        eq = res.equity
        r = eq.pct_change().dropna()
        yr = per_year(res)
        tk = res.taken
        by_sym = tk.groupby("symbol").pnl_jpy.sum()
        r_x = r[r.index.year != int(yr.idxmax())]
        sh_x = float(r_x.mean() / r_x.std() * math.sqrt(260))
        print(f"\nIS concentration ({acct}): best year {yr.idxmax()} = {yr.max():+.1%} "
              f"(cumulative IS return {eq.iloc[-1] / eq.iloc[0] - 1:+.1%}); IS Sharpe without "
              f"that year {sh_x:.3f}; best symbol {by_sym.idxmax()} = "
              f"{by_sym.max() / by_sym.sum():.0%} of IS net P&L")

    # ---- pre-declared buy-and-hold benchmarks
    bh_same = {"filter": "none", "stop_atr": full_params(best_p)["stop_atr"],
               "atr_n": full_params(best_p)["atr_n"],
               "max_hold": full_params(best_p)["max_hold"] or 260}
    BH = {}
    for name, bp in (("B&H same stop", bh_same), ("B&H very wide stop", BENCH_WIDE)):
        for acct, cfg in (("500k", None), ("50M", big_cfg())):
            R = run_all(bp, best_u, cfg=cfg, periods=("is", "oos", "pst_pre", "pst_oos", "full"))
            BH[(name, acct)] = R
            print(f"\nBenchmark {name} [{label(bp, best_u)}] - {acct} account:")
            print(table([(k, R[k][0]) for k in R]).round(3).to_string(index=False))

    FBf = run_all(best_p, best_u, cfg=big_cfg(), periods=("full",))["full"]
    yy = pd.DataFrame({
        "strategy_500k": per_year(F["full"][1]),
        "B&H_500k": per_year(BH[("B&H same stop", "500k")]["full"][1]),
        "strategy_50M": per_year(FBf[1]),
        "B&H_50M": per_year(BH[("B&H same stop", "50M")]["full"][1])})
    print("\nPer-year return, strategy vs B&H with the same stop (full 2005-2020/05):")
    print(yy.round(3).to_string())
    yp = pd.DataFrame({"strategy_500k": per_year(F["pst_pre"][1]),
                       "B&H_500k": per_year(BH[("B&H same stop", "500k")]["pst_pre"][1])})
    print("\nPer-year return, strategy vs B&H, pst pre-sample:")
    print(yp.round(3).to_string())

    # ---- neighbours out of sample (reporting only - NOT used for selection)
    nb_rows = []
    for q in [best_p] + neighbours(best_p):
        R = run_all(q, best_u, periods=("oos", "pst_pre", "pst_oos"))
        mi = S.trial(q, best_u)
        nb_rows.append({"config": label(q, best_u), "is_sharpe": mi["sharpe"],
                        "is_sharpe_50M": mi["big_sharpe"], "is_cagr": mi["cagr"],
                        "oos_sharpe": R["oos"][0]["sharpe"], "oos_cagr": R["oos"][0]["cagr"],
                        "oos_avg_R": R["oos"][0]["avg_R"],
                        "pst_pre_sharpe": R["pst_pre"][0]["sharpe"],
                        "pst_oos_sharpe": R["pst_oos"][0]["sharpe"]})
    print("\nNeighbours (IS used for selection; OOS/pst shown for reporting only):")
    print(pd.DataFrame(nb_rows).round(3).to_string(index=False))

    for k in ("is", "oos", "pst_pre", "pst_oos"):
        print(f"\nPer-symbol net R ({k}, 500k):")
        print(per_symbol_R(F[k][1]).round(3).to_string())
    for k in ("is", "oos"):
        print(f"\nPer-symbol net R ({k}, 50M):")
        print(per_symbol_R(FB[k][1]).round(3).to_string())
    print("\nPer-year return, pst 2020/05-2024/03 (500k):")
    print(per_year(F["pst_oos"][1]).round(3).to_string())
    skips = {}
    for k in ("is", "oos", "pst_pre", "pst_oos"):
        t = F[k][1].trades
        skips[k] = t.skip_reason.replace("", "taken").value_counts().to_dict()
        skips[k]["below_min_lot_by_symbol"] = (t[t.skip_reason == "below_min_lot"].symbol
                                               .value_counts().to_dict())
    print("\nSignals taken / skipped (500k):", json.dumps(skips))
    for k in ("is", "oos"):
        t = F[k][1].taken
        print(f"exit reasons {k}:", t.reason.value_counts().to_dict(),
              "| long share", round(float((t.dir > 0).mean()), 3),
              "| avg hold days", round(float((t.exit_time - t.entry_time).dt.days.mean()), 1))

    if args.save:
        eq = F["full"][1].equity
        (ROOT / "reports" / "equity").mkdir(parents=True, exist_ok=True)
        (ROOT / "reports" / "trades").mkdir(parents=True, exist_ok=True)
        eq.to_frame("equity").to_parquet(ROOT / "reports" / "equity" / f"{FAMILY}.parquet")
        tk = F["full"][1].taken.copy()
        for c in tk.columns:
            if tk[c].dtype == object:
                tk[c] = tk[c].astype(str)
        tk.to_parquet(ROOT / "reports" / "trades" / f"{FAMILY}.parquet")
        print(f"\nsaved reports/equity/{FAMILY}.parquet ({len(eq)} days) and "
              f"reports/trades/{FAMILY}.parquet ({len(tk)} trades)")


if __name__ == "__main__":
    main()
