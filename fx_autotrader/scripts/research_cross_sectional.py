"""Research script for family ``cross_sectional`` (currency ranking strategies).

    python scripts/research_cross_sectional.py            # reuse logged IS trials, print final table
    python scripts/research_cross_sectional.py --fresh    # wipe the trial log and redo the IS search

Protocol (docs/RESEARCH_PROTOCOL.md):
  * every parameter set is evaluated on IN-SAMPLE 2005-2014 only and logged to
    reports/trials/cross_sectional.jsonl (one line per unique config; reruns reuse the log)
  * selection is programmatic: stage winners by IS Sharpe (>= 150 IS trades), then a
    plateau test on one-at-a-time IS neighbours; the config with the best
    0.5 * (own IS Sharpe + median neighbour IS Sharpe) is chosen.
  * OOS / FRED / cost-stress numbers are computed only after the choice is made, for
    the chosen config (and its neighbours, for the robustness table only).
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

import fxlab.strategies.cross_sectional as CSM  # noqa: E402
from fxlab.backtest import SymbolContext  # noqa: E402
from fxlab.research import (ALL_OANDA, TrialLog, dsr_for, evaluate, per_symbol_R,  # noqa: E402
                            per_year)
from fxlab.strategies.cross_sectional import CrossSectional  # noqa: E402

FAMILY = "cross_sectional"
MIN_IS_TRADES = 150
# The 15 pairs of USD EUR JPY GBP AUD CAD (XAUUSD would never be traded by this family)
UNIVERSE = [s for s in ALL_OANDA if s != "XAUUSD"]

DEFAULTS = dict(signal="mom", lookback=63, skip=0, value_n=1260, value_mode="sma", vol_n=63,
                components=["carry", "mom", "value"], k=1, rebalance="M", exit_mode="rank",
                reenter=False, stop_atr=5.0, atr_n=20, trail_atr=0.0)
# a-priori stop width: ~1.5-2 standard deviations of the holding horizon
STOP_FOR_REB = {"D": 2.0, "W": 3.0, "M": 5.0}

KEYS = ["cagr", "max_dd", "sharpe", "mar", "trades", "avg_R", "t_stat_R", "profit_factor_R",
        "worst_year"]
REPORT_KEYS = ["cagr", "max_dd", "sharpe", "trades", "avg_R", "t_stat_R", "profit_factor_R",
               "worst_year"]


# --------------------------------------------------------------------------- utils
def full_params(p: dict) -> dict:
    q = dict(DEFAULTS)
    if "rebalance" in p and "stop_atr" not in p:
        q["stop_atr"] = STOP_FOR_REB[p["rebalance"]]
    q.update(p)
    q["components"] = list(q["components"])
    return q


def key_of(p: dict) -> str:
    return json.dumps(full_params(p), sort_keys=True)


def label(p: dict) -> str:
    q = full_params(p)
    s = q["signal"]
    if s in ("mom", "rev", "vmom"):
        sig = f"{s}{q['lookback']}" + (f"-{q['skip']}" if q["skip"] else "")
    elif s == "value":
        sig = f"value{q['value_n']}{q['value_mode']}"
    elif s == "carry":
        sig = "carry"
    else:
        parts = []
        for c in q["components"]:
            parts.append(f"{c}{q['lookback']}" if c in ("mom", "rev", "vmom") else c)
        sig = "combo(" + "+".join(parts) + ")"
    out = f"{sig}|{q['rebalance']}|k{q['k']}|stop{q['stop_atr']:g}"
    if q["exit_mode"] != "rank":
        out += f"|exit-{q['exit_mode']}"
    if q["reenter"]:
        out += "|reenter"
    if q["trail_atr"]:
        out += f"|trail{q['trail_atr']:g}"
    if q["atr_n"] != 20:
        out += f"|atr{q['atr_n']}"
    return out


class Search:
    def __init__(self, fresh: bool):
        self.log = TrialLog(FAMILY)
        if fresh and self.log.path.exists():
            self.log.path.unlink()
        self.done: dict[str, dict] = {}
        self.params: dict[str, dict] = {}
        if self.log.path.exists():
            for line in open(self.log.path):
                rec = json.loads(line)
                if rec.get("period") != "is":
                    continue
                prm = dict(rec["params"])
                prm.pop("stage", None)
                k = key_of(prm)
                self.done[k] = rec["metrics"]
                self.params[k] = prm

    @property
    def n_trials(self) -> int:
        return len(self.done)

    def trial(self, p: dict, stage: str = "") -> dict:
        k = key_of(p)
        if k not in self.done:
            m = evaluate(CrossSectional(**full_params(p)), UNIVERSE, periods=("is",))["is"]
            m.pop("_result")
            self.log.log({**full_params(p), "stage": stage}, m, "is")
            self.done[k] = {x: v for x, v in m.items() if not x.startswith("_")}
            self.params[k] = full_params(p)
            print(f"  [{self.n_trials:3d}] {label(p):55s} sharpe={m.get('sharpe', 0):6.2f} "
                  f"cagr={m.get('cagr', 0):6.1%} dd={m.get('max_dd', 0):5.1%} "
                  f"n={m.get('trades', 0):4d} avgR={m.get('avg_R', 0):6.3f}", flush=True)
        return self.done[k]


def score(m: dict) -> float:
    """IS ranking: Sharpe of daily equity, only with a meaningful sample."""
    if m.get("trades", 0) < MIN_IS_TRADES:
        return -9.0
    return float(m.get("sharpe", -9.0))


def md_table(df: pd.DataFrame, floatfmt: dict | None = None) -> str:
    floatfmt = floatfmt or {}
    cols = list(df.columns)
    lines = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    for _, r in df.iterrows():
        cells = []
        for c in cols:
            v = r[c]
            if isinstance(v, (float, np.floating)):
                f = floatfmt.get(c)
                if f == "pct":
                    cells.append(f"{v:.1%}")
                elif v != v:
                    cells.append("nan")
                else:
                    cells.append(f"{v:.3f}" if abs(v) < 100 else f"{v:,.0f}")
            else:
                cells.append(str(v).replace("|", "\\|"))
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


PCT = {"cagr": "pct", "max_dd": "pct", "worst_year": "pct"}


# ----------------------------------------------------------------- look-ahead check
def lookahead_check() -> int:
    """Signals computed on data truncated at T must equal the full-data signals <= T."""
    full = CSM.currency_panel("oanda")
    orig = CSM.currency_panel
    cfgs = [dict(signal="mom", lookback=63), dict(signal="vmom", lookback=252),
            dict(signal="rev", lookback=5, rebalance="W"), dict(signal="value"),
            dict(signal="carry"), dict(signal="combo", components=("carry", "mom", "value"),
                                       k=2)]
    bad = 0
    for T in ["2007-03-14", "2011-08-05", "2014-06-30"]:
        for c in cfgs:
            a = CrossSectional(**c)
            fa, ta = a.scores("oanda"), a.targets("oanda")
            da = a.decisions(SymbolContext("GBPJPY")).loc[:T]
            try:
                CSM.currency_panel = lambda src, T=T: full.loc[:T]
                b = CrossSectional(**c)
                fb, tb = b.scores("oanda"), b.targets("oanda")
                db = b.decisions(SymbolContext("GBPJPY")).loc[:T]
            finally:
                CSM.currency_panel = orig
            ok = (np.allclose(fa.loc[:T].to_numpy(), fb.to_numpy(), equal_nan=True)
                  and ta.loc[:T].equals(tb) and da.equals(db))
            bad += not ok
    return bad


# --------------------------------------------------------------------------- stages
def stage_a(S: Search) -> list[dict]:
    # the module smoke test (mom63, monthly, k1, stop 3 ATR) counts as a trial too
    grid = [dict(signal="mom", lookback=63, rebalance="M", k=1, stop_atr=3.0)]
    for L in (21, 63, 126, 252):
        for reb in ("W", "M"):
            for k in (1, 2):
                grid.append(dict(signal="mom", lookback=L, rebalance=reb, k=k))
    for k in (1, 2):
        grid.append(dict(signal="mom", lookback=252, skip=21, rebalance="M", k=k))
    for L in (63, 252):
        for k in (1, 2):
            grid.append(dict(signal="vmom", lookback=L, rebalance="M", k=k))
    for L in (5, 21):
        for k in (1, 2):
            grid.append(dict(signal="rev", lookback=L, rebalance="W", k=k))
    for k in (1, 2):
        grid.append(dict(signal="rev", lookback=21, rebalance="M", k=k))
    for mode in ("sma", "ret"):
        for k in (1, 2):
            grid.append(dict(signal="value", value_mode=mode, rebalance="M", k=k))
    for k in (1, 2):
        grid.append(dict(signal="carry", rebalance="M", k=k))
    grid.append(dict(signal="carry", rebalance="W", k=2))
    for p in grid:
        S.trial(p, "A")
    return grid


def stage_b(S: Search) -> list[dict]:
    grid = []
    combos = [("carry", "mom"), ("carry", "value"), ("mom", "value"), ("carry", "mom", "value")]
    for comp in combos:
        Ls = (63, 252) if "mom" in comp else (63,)
        for L in Ls:
            for k in (1, 2):
                grid.append(dict(signal="combo", components=list(comp), lookback=L,
                                 rebalance="M", k=k))
    for p in grid:
        S.trial(p, "B")
    return grid


def top_configs(S: Search, n: int, pool: list[dict] | None = None) -> list[dict]:
    items = pool if pool is not None else [S.params[k] for k in S.done]
    ranked = sorted(items, key=lambda p: score(S.done[key_of(p)]), reverse=True)
    out, seen = [], set()
    for p in ranked:
        k = key_of(p)
        if k in seen or score(S.done[k]) <= -9:
            continue
        seen.add(k)
        out.append(full_params(p))
        if len(out) >= n:
            break
    return out


def stage_c(S: Search, cands: list[dict]) -> list[dict]:
    """Exit / stop / breadth refinements of the stage A+B leaders."""
    grid = []
    for c in cands:
        st = c["stop_atr"]
        for p in ({"stop_atr": round(st * 0.6, 1)}, {"stop_atr": round(st * 1.6, 1)},
                  {"exit_mode": "sign"}, {"reenter": True}, {"k": 3 if c["k"] < 3 else 2},
                  {"trail_atr": st}):
            q = dict(c)
            q.update(p)
            grid.append(q)
    for p in grid:
        S.trial(p, "C")
    return grid


def neighbours(c: dict) -> list[dict]:
    """One-at-a-time perturbations (+-20..50 %) used for the plateau test."""
    out = []

    def add(**kw):
        q = dict(c)
        q.update(kw)
        if key_of(q) != key_of(c):
            out.append(q)

    sig_uses_L = c["signal"] in ("mom", "rev", "vmom") or (
        c["signal"] == "combo" and any(x in c["components"] for x in ("mom", "rev", "vmom")))
    if sig_uses_L:
        L = c["lookback"]
        add(lookback=int(round(L * 0.67)))
        add(lookback=int(round(L * 1.5)))
    sig_uses_V = c["signal"] == "value" or (c["signal"] == "combo" and "value" in c["components"])
    if sig_uses_V:
        add(value_n=int(round(c["value_n"] * 0.7)))
        add(value_n=int(round(c["value_n"] * 1.4)))
    add(stop_atr=round(c["stop_atr"] * 0.7, 1))
    add(stop_atr=round(c["stop_atr"] * 1.4, 1))
    add(atr_n=14 if c["atr_n"] != 14 else 20)
    add(atr_n=40 if c["atr_n"] != 40 else 20)
    add(k=c["k"] + 1 if c["k"] < 3 else c["k"] - 1)
    if c["k"] > 1:
        add(k=c["k"] - 1)
    add(rebalance="W" if c["rebalance"] == "M" else "M")
    return out


def stage_d(S: Search, cands: list[dict]) -> pd.DataFrame:
    rows = []
    for c in cands:
        m0 = S.trial(c, "D")
        nb = [S.trial(q, "D") for q in neighbours(c)]
        sh = [x.get("sharpe", 0.0) for x in nb]
        rows.append({"config": label(c), "is_sharpe": m0.get("sharpe"),
                     "is_trades": m0.get("trades"),
                     "nb_median_sharpe": float(np.median(sh)), "nb_min_sharpe": float(np.min(sh)),
                     "n_nb": len(sh),
                     "robust_score": 0.5 * (m0.get("sharpe", 0.0) + float(np.median(sh))),
                     "_p": c})
    return pd.DataFrame(rows).sort_values("robust_score", ascending=False)


# ---------------------------------------------------------------------- final eval
def final_eval(best: dict, n_trials: int, out_dir: Path) -> dict:
    strat = CrossSectional(**best)
    ev = evaluate(strat, UNIVERSE, periods=("is", "oos", "fred_pre", "fred_oos", "full"))
    ev2 = evaluate(CrossSectional(**best), UNIVERSE, periods=("is", "oos"), cost_mult=2.0)
    metrics = {p: {k: ev[p].get(k) for k in REPORT_KEYS} for p in
               ("is", "oos", "fred_pre", "fred_oos")}
    metrics["is_cost2x"] = {k: ev2["is"].get(k) for k in REPORT_KEYS}
    metrics["oos_cost2x"] = {k: ev2["oos"].get(k) for k in REPORT_KEYS}
    full_res = ev["full"]["_result"]
    (out_dir / "equity").mkdir(parents=True, exist_ok=True)
    (out_dir / "trades").mkdir(parents=True, exist_ok=True)
    full_res.equity.to_frame("equity").to_parquet(out_dir / "equity" / f"{FAMILY}.parquet")
    tk = full_res.taken.copy()
    tk.to_parquet(out_dir / "trades" / f"{FAMILY}.parquet")
    dsr = dsr_for(ev["is"], ev["is"]["_result"], n_trials)
    return {"ev": ev, "ev2": ev2, "metrics": metrics, "dsr": dsr, "full": full_res}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--is-only", action="store_true", help="stop before any OOS/FRED evaluation")
    args = ap.parse_args()
    pd.set_option("display.width", 200)
    pd.set_option("display.max_columns", 30)

    bad = lookahead_check()
    print(f"look-ahead truncation check: {bad} mismatches (must be 0)")
    assert bad == 0

    S = Search(args.fresh)
    print("Stage A: single-factor rankings")
    ga = stage_a(S)
    print("Stage B: composite rankings")
    gb = stage_b(S)
    lead = top_configs(S, 3, ga + gb)
    print("Stage C: refinements of", [label(x) for x in lead])
    gc = stage_c(S, lead)
    cands = top_configs(S, 3, ga + gb + gc)
    print("Stage D: plateau test of", [label(x) for x in cands])
    plateau = stage_d(S, cands)
    n_trials = S.n_trials
    best = plateau.iloc[0]["_p"]
    print(f"\nTrials logged: {n_trials}")
    print(f"Selected: {label(best)}")
    print(json.dumps(best))

    # --------- IS tables
    allrows = []
    for k, m in S.done.items():
        allrows.append({"config": label(S.params[k]), **{x: m.get(x) for x in KEYS}})
    allis = pd.DataFrame(allrows).sort_values("sharpe", ascending=False)
    stageA = pd.DataFrame([{"config": label(p), **{x: S.done[key_of(p)].get(x) for x in KEYS}}
                           for p in ga + gb])
    print("\nIS results, stage A+B (all single-factor and composite rankings):")
    print(stageA.to_string(index=False, float_format=lambda v: f"{v:.3f}"))
    print("\nIS top 15 of all trials:")
    print(allis.head(15).to_string(index=False, float_format=lambda v: f"{v:.3f}"))
    print("\nPlateau test (IS):")
    print(plateau.drop(columns="_p").to_string(index=False, float_format=lambda v: f"{v:.3f}"))
    sh = allis.sharpe.astype(float)
    print(f"IS Sharpe over all trials: median {sh.median():.3f} sd {sh.std():.3f} "
          f"share>0 {(sh > 0).mean():.2f}")

    if args.is_only:
        return S, plateau, allis, stageA, None, None

    # --------- final evaluation (OOS etc only for the selected config)
    out = final_eval(best, n_trials, ROOT / "reports")
    met = out["metrics"]
    tbl = pd.DataFrame([{"period": p, **met[p]} for p in
                        ("is", "oos", "fred_pre", "fred_oos", "is_cost2x", "oos_cost2x")])
    print("\nFINAL (1% risk per trade):")
    print(tbl.to_string(index=False, float_format=lambda v: f"{v:.3f}"))
    print(f"DSR (IS, n_trials={n_trials}): {out['dsr']:.3f}")

    ev = out["ev"]
    for p in ("is", "oos"):
        print(f"\nper symbol R ({p}):")
        print(per_symbol_R(ev[p]["_result"]).round(3).to_string())
    print("\nper year (full OANDA 2005-2020/05):")
    print(per_year(out["full"]).round(4).to_string())
    for p in ("fred_pre", "fred_oos"):
        print(f"\nper year ({p}):")
        print(per_year(ev[p]["_result"]).round(4).to_string())

    # --------- neighbours on OOS (reporting only, never used for selection)
    rows = []
    for q in [best] + neighbours(best):
        e = evaluate(CrossSectional(**q), UNIVERSE, periods=("is", "oos"))
        rows.append({"config": label(q), "is_sharpe": e["is"].get("sharpe"),
                     "is_avg_R": e["is"].get("avg_R"), "oos_sharpe": e["oos"].get("sharpe"),
                     "oos_cagr": e["oos"].get("cagr"), "oos_avg_R": e["oos"].get("avg_R"),
                     "oos_trades": e["oos"].get("trades")})
    nbt = pd.DataFrame(rows)
    print("\nNeighbours IS vs OOS (reporting only):")
    print(nbt.to_string(index=False, float_format=lambda v: f"{v:.3f}"))

    return S, plateau, allis, stageA, out, nbt


if __name__ == "__main__":
    main()
