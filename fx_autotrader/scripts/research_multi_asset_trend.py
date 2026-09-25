"""Research script for family ``multi_asset_trend`` (diversified daily trend following
across FX, gold and stock-index CFDs, long and short).

    python scripts/research_multi_asset_trend.py           # reuse logged IS trials, print final tables
    python scripts/research_multi_asset_trend.py --fresh   # wipe the trial log and redo the IS search
    python scripts/research_multi_asset_trend.py --save    # also write equity / trades parquet

Protocol (docs/RESEARCH_PROTOCOL.md):
  * every parameter set is evaluated on IN-SAMPLE 2005-2014 only and logged to
    reports/trials/multi_asset_trend.jsonl (one line per unique config+universe; reruns
    reuse the log).  Each trial is run on two account sizes with 1% risk per trade:
    the standard 500k JPY account (where the 0.01-lot FX / 0.1-lot index minimums bind)
    and a 50M JPY account (no lot rounding).  IS score = mean of the two IS Sharpes,
    only for configs with >= 150 IS trades on both.
  * selection is programmatic (stage winners by IS score, then a plateau test on IS
    neighbours).  OOS / FRED / pst numbers are computed only for the chosen config
    (and, for reporting only, its neighbours and sub-universes).

Engine workaround (reported, shared code not edited): run_portfolio closes trades that
are still open at a period ``end`` with exit_time == end, which is not a day of the
daily equity index (days < end).  _daily_equity then books their realized P&L on the
last day AND keeps their open P&L on that day, so the last equity point double counts
every open position (IS 2005-2014: +20% on the last day for a trend book).  It affects
periods whose end lies inside the data (is, fred_pre, pst_pre).  ``fixed_eval`` below
re-dates those exits to the last equity day and rebuilds the equity with the engine's
own _daily_equity, then recomputes the metrics; trade statistics are unaffected.
"""
from __future__ import annotations

import argparse
import dataclasses
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import warnings  # noqa: E402

warnings.filterwarnings("ignore")

from fxlab import backtest as B  # noqa: E402
from fxlab import engine as E  # noqa: E402
from fxlab.instruments import INSTRUMENTS  # noqa: E402
from fxlab.metrics import equity_stats, trade_stats  # noqa: E402
from fxlab.research import (ALL_OANDA, ALL_OANDA_PLUS, FRED_PAIRS, INDICES,  # noqa: E402
                            PST_SYMBOLS, TrialLog, _short, dsr_for, evaluate, per_symbol_R,
                            per_year, research_config)
from fxlab.strategies.multi_asset_trend import RISK_ASSETS, MultiAssetTrend  # noqa: E402

FAMILY = "multi_asset_trend"
MIN_IS_TRADES = 150
BIG_ACCOUNT = 50_000_000.0

FX6 = ["USDJPY", "EURUSD", "GBPUSD", "AUDUSD", "USDCAD", "AUDJPY"]
IDX5 = ["US500", "JPN225", "UK100", "FRA40", "AUS200"]
UNIVERSES = {
    # a-priori balanced book: 5 USD majors + one JPY cross (6 FX), gold, and one index
    # per region (US, Japan, UK, euro area, Australia) - the three US indices are
    # near-duplicates, so only US500 is kept.  Risk share by count: FX 50 / eq 42 / gold 8.
    "bal12": FX6 + ["XAUUSD"] + IDX5,
    "bal14": FX6 + ["XAUUSD"] + INDICES,          # + NAS100, US2000
    "all23": ALL_OANDA_PLUS,                       # every instrument
    "risk8": ["XAUUSD"] + INDICES,                 # no FX: gold + 7 indices
    "fx16": ALL_OANDA,                             # wave-1 universe (15 FX + gold)
}

DEFAULTS = dict(signal="ema", n=128, fast=0, lookbacks=[32, 64, 128, 256], entry_thr=1.0,
                exit_thr=0.0, exit_n=0, entry_mode="state", stop_atr=3.0, atr_n=20,
                trail_atr=0.0, short_risk=True, carry_min=None, warmup=260)

SPANS = {"is": ("oanda", B.IS_START, B.IS_END), "oos": ("oanda", B.OOS_START, B.OOS_END),
         "full": ("oanda", B.IS_START, B.OOS_END),
         "fred_pre": ("fred", B.FRED_PRE_START, B.FRED_PRE_END),
         "fred_oos": ("fred", B.FRED_OOS_START, B.FRED_OOS_END),
         "pst_pre": ("pst", None, B.PST_PRE_END),
         "pst_oos": ("pst", B.PST_OOS_START, B.PST_OOS_END)}
KEYS = ["cagr", "max_dd", "sharpe", "mar", "trades", "avg_R", "t_stat_R", "profit_factor_R",
        "worst_year"]


# --------------------------------------------------------------------------- utils
def full_params(p: dict) -> dict:
    q = dict(DEFAULTS)
    q.update(p)
    q["lookbacks"] = list(q["lookbacks"])
    return q


def key_of(p: dict, universe: str) -> str:
    return json.dumps({"p": full_params(p), "u": universe}, sort_keys=True)


def make(p: dict) -> MultiAssetTrend:
    return MultiAssetTrend(**full_params(p))


def cfg_for(account: float = 500_000.0, cost_mult: float = 1.0):
    cfg = research_config(risk=0.01, cost_mult=cost_mult)
    return dataclasses.replace(cfg, initial_jpy=float(account))


def period_symbols(period: str, symbols: list[str]) -> list[str]:
    if period.startswith("pst"):
        return [x for x in symbols if x in PST_SYMBOLS]
    if period.startswith("fred"):
        return [x for x in symbols if x in FRED_PAIRS]
    return list(symbols)


def fix_equity(res, period: str, symbols: list[str]) -> pd.Series:
    """Rebuild the daily equity without the end-of-period double count (see module doc)."""
    tk = res.taken
    source, start, end = SPANS[period]
    if len(tk) == 0 or end is None:
        return res.equity
    days = res.equity.index
    te = pd.Timestamp(end)
    late = (tk.exit_time >= te).to_numpy()
    if not late.any():
        return res.equity
    tk = tk.copy()
    tk.loc[late, "exit_time"] = days[-1]
    syms = period_symbols(period, symbols)
    daily = {s: B._bars(source, s, "D1")["close"] for s in syms}
    eq = E._daily_equity(tk, daily, B.conversion_table(source), res.cfg, start, end,
                         res.withdrawals)
    expect = res.cfg.initial_jpy + res.taken.pnl_jpy.sum() - res.withdrawn
    assert abs(eq.iloc[-1] - expect) < 1e-6 * max(1.0, abs(expect)), (eq.iloc[-1], expect)
    return eq


def fixed_eval(p: dict, symbols: list[str], periods=("is",), account=500_000.0,
               cost_mult=1.0, cfg=None) -> dict:
    """research.evaluate() + the end-of-period equity fix; metrics recomputed."""
    out = evaluate(make(p), symbols, periods=periods, cfg=cfg or cfg_for(account, cost_mult))
    for per, m in out.items():
        res = m["_result"]
        eq = fix_equity(res, per, symbols)
        if eq is not res.equity:
            res.equity = eq
            s = equity_stats(eq)
            s.update(trade_stats(res.taken))
            s["skipped"] = int((~res.trades.taken).sum())
            m2 = _short(s)
            m2["_result"] = res
            out[per] = m2
    return out


def score(m: dict) -> float:
    """IS ranking: mean Sharpe of the 500k and 50M accounts, with a meaningful sample."""
    if m.get("trades", 0) < MIN_IS_TRADES or m.get("trades_50m", 0) < MIN_IS_TRADES:
        return -9.0
    return 0.5 * (float(m.get("sharpe", -9.0)) + float(m.get("sharpe_50m", -9.0)))


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

    def trial(self, p: dict, universe: str = "bal12", stage: str = "") -> dict:
        k = key_of(p, universe)
        if k not in self.done:
            syms = UNIVERSES[universe]
            m = fixed_eval(p, syms, ("is",))["is"]
            m.pop("_result")
            big = fixed_eval(p, syms, ("is",), account=BIG_ACCOUNT)["is"]
            for x in ("sharpe", "cagr", "max_dd", "trades", "avg_R", "t_stat_R", "mar"):
                m[f"{x}_50m"] = big.get(x)
            m["score"] = score(m)
            self.log.log({**full_params(p), "universe": universe, "stage": stage}, m, "is")
            self.done[k] = {x: v for x, v in m.items() if not x.startswith("_")}
            print(f"  [{self.n_trials:3d}] {label(p, universe):55s} score={m['score']:.3f} "
                  f"sh500k={m['sharpe']:.3f} sh50M={m['sharpe_50m']:.3f} "
                  f"tr={m['trades']}/{m['trades_50m']} cagr={m['cagr']:.3f}", flush=True)
        return self.done[k]

    def s(self, p: dict, u: str = "bal12") -> float:
        return score(self.trial(p, u))


def label(p: dict, u: str = "bal12") -> str:
    q = full_params(p)
    s = q["signal"]
    if s == "donchian":
        sig = f"DC{q['n']}/{q['exit_n'] or q['n'] // 2}"
    elif s == "ema":
        sig = f"EMA{q['fast'] or q['n'] // 4}/{q['n']}"
    elif s == "tsmom":
        sig = f"TSM{q['n']}"
    else:
        sig = f"{s.upper()}{tuple(q['lookbacks'])}>={q['entry_thr']:g}"
    out = f"{sig}|stop{q['stop_atr']:g}xATR{q['atr_n']}"
    if q["trail_atr"]:
        out += f"|trail{q['trail_atr']:g}"
    if q["entry_mode"] != "state":
        out += f"|{q['entry_mode']}"
    if not q["short_risk"]:
        out += "|idxLongOnly"
    if q["carry_min"] is not None:
        out += f"|carry>={q['carry_min']:g}"
    if q["exit_thr"]:
        out += f"|exit<={q['exit_thr']:g}"
    return out + f"|{u}"


# -------------------------------------------------------------------------- stages
def stage_a() -> list[dict]:
    g = []
    for st in (3.0, 5.0):
        for n in (64, 128, 256):
            g.append(dict(signal="ema", n=n, stop_atr=st))
        for n in (63, 126, 252):
            g.append(dict(signal="tsmom", n=n, stop_atr=st))
        for n in (50, 100, 200):
            g.append(dict(signal="donchian", n=n, stop_atr=st))
        for thr in (0.5, 1.0):
            g.append(dict(signal="ens_ema", lookbacks=[32, 64, 128, 256], entry_thr=thr,
                          stop_atr=st))
        for thr in (0.3, 1.0):
            g.append(dict(signal="ens_tsmom", lookbacks=[63, 126, 252], entry_thr=thr,
                          stop_atr=st))
    return g


def ranked(S: Search, cands, u="bal12"):
    return sorted(cands, key=lambda p: S.s(p, u), reverse=True)


def top_by_signal(S: Search, cands: list[dict], k: int) -> list[dict]:
    out, seen = [], set()
    for p in ranked(S, cands):
        if p["signal"] in seen:
            continue
        seen.add(p["signal"])
        out.append(p)
        if len(out) == k:
            break
    return out


def dedup(ps: list[dict]) -> list[dict]:
    out, seen = [], set()
    for p in ps:
        k = key_of(p, "")
        if k not in seen:
            seen.add(k)
            out.append(p)
    return out


def risk_variants(p: dict) -> list[dict]:
    out = [{**p, "stop_atr": st} for st in (2.0, 4.0, 7.0)]
    for tr in (3.0, 5.0):
        out.append({**p, "stop_atr": tr, "trail_atr": tr})
    return out


def filter_variants(p: dict) -> list[dict]:
    return [{**p, "atr_n": 100}, {**p, "short_risk": False}, {**p, "entry_mode": "cross"},
            {**p, "carry_min": -3.0}]


def _scale_n(p: dict, f: float) -> dict:
    q = full_params(p)
    if q["signal"] in ("ens_ema", "ens_tsmom"):
        return {**p, "lookbacks": [int(round(L * f)) for L in q["lookbacks"]]}
    out = {**p, "n": int(round(q["n"] * f))}
    if q["signal"] == "donchian" and q["exit_n"]:
        out["exit_n"] = int(round(q["exit_n"] * f))
    return out


def neighbours(p: dict) -> list[dict]:
    """one-at-a-time perturbations (+-25-33%) of the speed and the stop / trail."""
    q = full_params(p)
    out = [_scale_n(p, 0.75), _scale_n(p, 1.33)]
    out += [{**p, "stop_atr": round(q["stop_atr"] * 0.75, 2)},
            {**p, "stop_atr": round(q["stop_atr"] * 1.33, 2)}]
    if q["trail_atr"]:
        out += [{**p, "trail_atr": round(q["trail_atr"] * 0.75, 2)},
                {**p, "trail_atr": round(q["trail_atr"] * 1.33, 2)}]
    if q["signal"] in ("ens_ema", "ens_tsmom"):
        alt = {0.5: 1.0, 1.0: 0.5, 0.3: 1.0}.get(q["entry_thr"])
        if alt is not None:
            out.append({**p, "entry_thr": alt})
    return out


def search(S: Search):
    print("stage A: signal type x speed x stop (bal12)")
    A = stage_a()
    for p in A:
        S.trial(p, stage="A")
    topA = top_by_signal(S, A, 3)
    print("stage B: stop / trail around the 3 best signal types")
    Bc = []
    for p in topA:
        for q in risk_variants(p):
            S.trial(q, stage="B")
            Bc.append(q)
    pool = dedup(A + Bc)
    top2 = ranked(S, pool)[:2]
    print("stage C: ATR length, index long-only, cross entry, carry filter")
    Cc = []
    for p in top2:
        base = S.s(p)
        better = []
        for q in filter_variants(p):
            S.trial(q, stage="C")
            Cc.append(q)
            if S.s(q) > base:
                better.append(q)
        if len(better) >= 2:  # combine the two best improving variants
            b1, b2 = sorted(better, key=S.s, reverse=True)[:2]
            comb = {**b1, **{k: v for k, v in b2.items() if k not in p or p[k] != v}}
            S.trial(comb, stage="C")
            Cc.append(comb)
    pool = dedup(pool + Cc)
    top2 = ranked(S, pool)[:2]
    print("stage D: universes")
    cands = [(p, "bal12") for p in ranked(S, pool)[:3]]
    for p in top2:
        for u in ("bal14", "all23", "risk8", "fx16"):
            S.trial(p, u, stage="D")
            cands.append((p, u))
    cands = sorted(cands, key=lambda x: S.s(*x), reverse=True)
    # plateau test on the 3 best distinct candidates
    print("stage E: plateau (one-at-a-time neighbours)")
    uniq, seen = [], set()
    for p, u in cands:
        k = key_of(p, u)
        if k in seen:
            continue
        seen.add(k)
        uniq.append((p, u))
        if len(uniq) == 3:
            break
    plateau = []
    for p, u in uniq:
        sc = [S.s(p, u)]
        for q in neighbours(p):
            S.trial(q, u, stage="E")
            sc.append(S.s(q, u))
        plateau.append((float(np.mean(sc)), float(np.min(sc)), p, u))
    plateau.sort(key=lambda x: x[0], reverse=True)
    return plateau


# ------------------------------------------------------------------------ reporting
def exposure(res, source: str) -> pd.Series:
    """Gross notional of open positions / equity, per day."""
    tk = res.taken
    eq = res.equity
    days = eq.index
    gross = np.zeros(len(days))
    if len(tk):
        conv = B.conversion_table(source)
        for sym, g in tk.groupby("symbol"):
            ins = INSTRUMENTS[sym]
            cl = B._bars(source, sym, "D1")["close"].reindex(days, method="ffill").to_numpy()
            q = conv.rate(ins.quote, days + pd.Timedelta(hours=23, minutes=59))
            e0 = np.searchsorted(days.values, g.entry_time.dt.normalize().values, side="left")
            e1 = np.searchsorted(days.values, g.exit_time.dt.normalize().values, side="left")
            for a, b, lt in zip(e0, e1, g.lots.to_numpy()):
                if b > a:
                    gross[a:b] += lt * ins.contract * cl[a:b] * q[a:b]
    return pd.Series(gross / eq.to_numpy(), index=days)


def asset_class(sym: str) -> str:
    if sym == "XAUUSD":
        return "gold"
    return "index" if sym in RISK_ASSETS else "fx"


def class_table(res) -> pd.DataFrame:
    t = res.taken
    if len(t) == 0:
        return pd.DataFrame()
    t = t.assign(cls=t.symbol.map(asset_class))
    g = t.groupby("cls")
    return pd.DataFrame({"n": g.size(), "avg_R": g.R_net.mean(), "sum_R": g.R_net.sum(),
                         "pnl_jpy": g.pnl_jpy.sum(), "swap_jpy": g.swap_jpy.sum(),
                         "long_share": g.dir.apply(lambda d: (d > 0).mean())}).round(3)


def fmt_row(name: str, m: dict, extra: dict | None = None) -> dict:
    r = {"period": name}
    for k in KEYS:
        v = m.get(k)
        r[k] = round(v, 4) if isinstance(v, float) else v
    if extra:
        r.update(extra)
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--save", action="store_true")
    args = ap.parse_args()
    pd.set_option("display.width", 250)
    pd.set_option("display.max_columns", 40)
    pd.set_option("display.max_rows", 200)

    S = Search(args.fresh)
    plateau = search(S)
    print(f"\nIS trials logged: {S.n_trials}")
    print("\nplateau test (mean / min IS score over config + one-at-a-time neighbours):")
    for mean_s, min_s, p, u in plateau:
        print(f"  {label(p, u):60s} own={S.s(p, u):.3f} plateau_mean={mean_s:.3f} min={min_s:.3f}")
    _, _, best, uni = plateau[0]
    syms = UNIVERSES[uni]
    print(f"\nCHOSEN: {label(best, uni)}\n  params={full_params(best)}\n  universe={syms}")

    # ---- the only out-of-sample evaluation of the chosen config
    periods = ("is", "oos", "fred_pre", "fred_oos", "pst_pre", "pst_oos")
    std = fixed_eval(best, syms, periods)
    c2 = fixed_eval(best, syms, ("is", "oos"), cost_mult=2.0)
    big = fixed_eval(best, syms, periods, account=BIG_ACCOUNT)
    full = fixed_eval(best, syms, ("full",))["full"]
    n_trials = S.n_trials
    dsr = dsr_for(std["is"], std["is"]["_result"], n_trials)

    rows, rows_big = [], []
    src_of = {k: v[0] for k, v in SPANS.items()}
    for per in periods + ("full",):
        m = full if per == "full" else std.get(per)
        if m is None:
            continue
        ex = exposure(m["_result"], src_of[per])
        extra = {"avg_expo": round(float(ex.mean()), 3),
                 "expo_when_in": round(float(ex[ex > 0].mean()), 3) if (ex > 0).any() else 0.0,
                 "in_mkt": round(float((ex > 0).mean()), 3),
                 "skip_min_lot": int((m["_result"].trades.skip_reason == "below_min_lot").sum()),
                 "skip_cap": int(m["_result"].trades.skip_reason.isin(
                     ["risk_cap", "max_open"]).sum())}
        rows.append(fmt_row(per, m, extra))
    for per in ("is", "oos"):
        rows.append(fmt_row(per + "_cost2x", c2[per]))
    for per in periods:
        if per in big:
            ex = exposure(big[per]["_result"], src_of[per])
            rows_big.append(fmt_row(per + "_50M", big[per], {"avg_expo": round(float(ex.mean()), 3)}))
    print("\n=== FINAL (1% risk per trade, 500k JPY start; metrics.py definitions) ===")
    print(pd.DataFrame(rows).to_string(index=False))
    print("\n=== diagnostic: same rules on a 50M JPY account (no lot rounding) ===")
    print(pd.DataFrame(rows_big).to_string(index=False))
    print(f"\nDSR (IS, {n_trials} trials) = {dsr:.4f}")

    # ---- attribution / robustness (reporting only)
    for per in ("is", "oos", "fred_oos", "pst_oos"):
        if per in std:
            print(f"\nby asset class, {per}:")
            print(class_table(std[per]["_result"]).to_string())
    for per in ("is", "oos"):
        print(f"\nper-symbol net R, {per}:")
        t = std[per]["_result"].taken
        g = t.groupby("symbol").R_net
        print(pd.DataFrame({"n": g.size(), "avg_R": g.mean().round(3),
                            "sum_R": g.sum().round(2)}).sort_values("sum_R").T.to_string())
    py = per_year(full["_result"])
    print("\nper-year return (full 2005-2020/05, 500k):")
    print((py * 100).round(1).to_frame("ret_%").T.to_string())
    print("\nsub-universes of the chosen universe (reporting only):")
    sub = {"fx_only": [s for s in syms if asset_class(s) == "fx"],
           "gold_idx_only": [s for s in syms if asset_class(s) != "fx"]}
    srows = []
    for nm, ss in sub.items():
        if not ss:
            continue
        r = fixed_eval(best, ss, ("is", "oos"))
        rb = fixed_eval(best, ss, ("is", "oos"), account=BIG_ACCOUNT)
        for per in ("is", "oos"):
            srows.append(fmt_row(f"{nm}_{per}", r[per], {"sharpe_50M": round(rb[per]["sharpe"], 3)}))
    print(pd.DataFrame(srows).to_string(index=False))
    print("\nneighbours of the chosen config (IS score used for the plateau; OOS for reporting):")
    nrows = []
    for q in [best] + neighbours(best):
        mi = S.trial(q, uni)
        mo = fixed_eval(q, syms, ("oos", "pst_oos", "fred_oos"))
        nrows.append({"config": label(q, uni), "IS_sh500k": round(mi["sharpe"], 3),
                      "IS_sh50M": round(mi["sharpe_50m"], 3), "IS_cagr": round(mi["cagr"], 4),
                      "OOS_sh": round(mo["oos"]["sharpe"], 3), "OOS_cagr": round(mo["oos"]["cagr"], 4),
                      "pst_oos_sh": round(mo["pst_oos"]["sharpe"], 3) if "pst_oos" in mo else None,
                      "fred_oos_sh": round(mo["fred_oos"]["sharpe"], 3) if "fred_oos" in mo else None})
    print(pd.DataFrame(nrows).to_string(index=False))

    t_is = std["is"]["_result"].taken
    print("\nIS cost breakdown (JPY): net", round(t_is.pnl_jpy.sum()), "swap", round(t_is.swap_jpy.sum()),
          "commission", round(t_is.commission_jpy.sum()))
    t_oos = std["oos"]["_result"].taken
    print("OOS cost breakdown (JPY): net", round(t_oos.pnl_jpy.sum()), "swap", round(t_oos.swap_jpy.sum()),
          "commission", round(t_oos.commission_jpy.sum()))

    # ---- diagnostics (reporting only; nothing below feeds back into the choice)
    r_is = std["is"]["_result"].equity.pct_change().dropna()
    r_x13 = r_is[r_is.index.year != 2013]
    print(f"\nIS Sharpe without 2013: {r_x13.mean() / r_x13.std() * math.sqrt(260):.3f}"
          f"  (with: {std['is']['sharpe']:.3f})")
    print("\ndiagnostic: chosen rules WITHOUT swap (use_swap=False), 500k / 50M:")
    drows = []
    for acct, tag in ((500_000.0, "500k"), (BIG_ACCOUNT, "50M")):
        base = cfg_for(acct)
        ns = dataclasses.replace(base, costs=dataclasses.replace(base.costs, use_swap=False))
        r = fixed_eval(best, syms, periods, cfg=ns)
        for per in periods:
            if per in r:
                drows.append(fmt_row(f"{per}_noswap_{tag}", r[per]))
    print(pd.DataFrame(drows).to_string(index=False))
    print("\ndiagnostic: chosen rules without the 8% open-risk / 10-position caps (50M):")
    unc = dataclasses.replace(cfg_for(BIG_ACCOUNT), max_open_risk=1.0, max_open_trades=100)
    r = fixed_eval(best, syms, ("is", "oos"), cfg=unc)
    print(pd.DataFrame([fmt_row(f"{per}_uncapped_50M", r[per]) for per in ("is", "oos")])
          .to_string(index=False))
    print("\nother top IS candidates (by IS score) - OOS / checks for reporting only:")
    recs = []
    for line in open(S.log.path):
        rec = json.loads(line)
        prm = dict(rec["params"])
        u = prm.pop("universe")
        prm.pop("stage", None)
        recs.append((score(rec["metrics"]), prm, u))
    recs.sort(key=lambda x: x[0], reverse=True)
    orows, seen = [], {key_of(best, uni)}
    for sc, prm, u in recs:
        if key_of(prm, u) in seen:
            continue
        seen.add(key_of(prm, u))
        mo = fixed_eval(prm, UNIVERSES[u], ("oos", "fred_oos", "pst_oos"))
        orows.append({"config": label(prm, u), "IS_score": round(sc, 3),
                      "OOS_sh": round(mo["oos"]["sharpe"], 3),
                      "OOS_cagr": round(mo["oos"]["cagr"], 4),
                      "OOS_avgR": round(mo["oos"]["avg_R"], 3),
                      "fred_oos_sh": round(mo["fred_oos"]["sharpe"], 3) if "fred_oos" in mo else None,
                      "pst_oos_sh": round(mo["pst_oos"]["sharpe"], 3) if "pst_oos" in mo else None})
        if len(orows) == 6:
            break
    print(pd.DataFrame(orows).to_string(index=False))

    if args.save:
        (ROOT / "reports" / "equity").mkdir(parents=True, exist_ok=True)
        (ROOT / "reports" / "trades").mkdir(parents=True, exist_ok=True)
        full["_result"].equity.to_frame("equity").to_parquet(
            ROOT / "reports" / "equity" / f"{FAMILY}.parquet")
        tk = full["_result"].taken.copy()
        for c in tk.columns:
            if tk[c].dtype == object:
                tk[c] = tk[c].astype(str)
        tk.to_parquet(ROOT / "reports" / "trades" / f"{FAMILY}.parquet")
        print("saved equity / trades parquet")

    summary = {"best": full_params(best), "universe": uni, "n_trials": n_trials, "dsr_is": dsr,
               "metrics": {r["period"]: {k: v for k, v in r.items() if k != "period"} for r in rows}}
    print("\nJSON", json.dumps(summary, default=float))


if __name__ == "__main__":
    main()
