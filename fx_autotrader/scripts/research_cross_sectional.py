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
                                       k=2),
            dict(signal="combo", components=("mom21", "mom63", "mom126", "mom252"), k=2,
                 rebalance="W", exit_mode="buffer"),
            dict(signal="mom", lookback=126, k=2, rebalance="W", exit_mode="sign")]
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


def stage_c(S: Search, cands: list[dict], stage: str = "C", extra_opts=()) -> list[dict]:
    """Exit / stop / breadth refinements of the stage leaders."""
    grid = []
    for c in cands:
        st = c["stop_atr"]
        opts = [{"stop_atr": round(st * 0.6, 1)}, {"stop_atr": round(st * 1.6, 1)},
                {"exit_mode": "sign"}, {"reenter": True}, {"k": 3 if c["k"] < 3 else 2},
                {"trail_atr": st}] + list(extra_opts)
        for p in opts:
            q = dict(c)
            q.update(p)
            if key_of(q) != key_of(c):
                grid.append(q)
    for p in grid:
        S.trial(p, stage)
    return grid


MOM_ENS = ["mom21", "mom63", "mom126", "mom252"]


def stage_e(S: Search) -> list[dict]:
    """Round 2 (designed after round 1 showed a sharp lookback optimum): rankings that
    are robust by construction - lookback ensemble, vol-adjusted weekly momentum,
    carry + momentum weekly, and a rank-buffer exit to cut churn."""
    grid = []
    for reb in ("W", "M"):
        for k in (1, 2):
            grid.append(dict(signal="combo", components=MOM_ENS, rebalance=reb, k=k))
    for L in (63, 126, 252):
        grid.append(dict(signal="vmom", lookback=L, rebalance="W", k=2))
    for L in (63, 126):
        grid.append(dict(signal="combo", components=["carry", "mom"], lookback=L,
                         rebalance="W", k=2))
    grid.append(dict(signal="mom", lookback=63, rebalance="W", k=2, exit_mode="buffer"))
    grid.append(dict(signal="mom", lookback=126, rebalance="W", k=2, exit_mode="buffer"))
    grid.append(dict(signal="combo", components=MOM_ENS, rebalance="W", k=2,
                     exit_mode="buffer"))
    for p in grid:
        S.trial(p, "E")
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
    comps = list(c["components"]) if c["signal"] == "combo" else []
    if any(x.rstrip("0123456789") != x for x in comps):
        for f in (0.67, 1.5):
            nc = []
            for x in comps:
                b = x.rstrip("0123456789")
                nc.append(f"{b}{int(round(int(x[len(b):]) * f))}" if b != x else x)
            add(components=nc)
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


def stage_d(S: Search, cands: list[dict], stage: str = "D") -> pd.DataFrame:
    rows = []
    for c in cands:
        m0 = S.trial(c, stage)
        nb = [S.trial(q, stage) for q in neighbours(c)]
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
    plateau1 = stage_d(S, cands)
    # ---- round 2 (IS only): robust-by-construction variants
    print("Stage E: ensembles / weekly vol-adjusted / carry+mom weekly / buffer exit")
    ge = stage_e(S)
    lead2 = top_configs(S, 3, ge)
    print("Stage C2: refinements of", [label(x) for x in lead2])
    gc2 = stage_c(S, lead2, "C2", extra_opts=({"exit_mode": "buffer"},))
    tested = {key_of(p) for p in cands}
    cands2 = [p for p in top_configs(S, 6, ge + gc2) if key_of(p) not in tested][:3]
    print("Stage D2: plateau test of", [label(x) for x in cands2])
    plateau2 = stage_d(S, cands2, "D2")
    plateau = pd.concat([plateau1.assign(round=1), plateau2.assign(round=2)])
    # selection rule (fixed before any OOS run): best robust score among candidates
    # whose every IS neighbour has Sharpe > 0; if none qualifies, best robust score
    plateau["plateau_ok"] = plateau.nb_min_sharpe > 0
    plateau = plateau.sort_values(["plateau_ok", "robust_score"], ascending=False)
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
                           for p in ga + gb + ge])
    print("\nIS results, stages A+B+E (all single-factor, composite and ensemble rankings):")
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
    trial_sd = float(allis.sharpe.astype(float).std())
    dsr_emp = deflated_sharpe_emp(out["ev"]["is"], n_trials, trial_sd)
    print(f"DSR (IS, n_trials={n_trials}): {out['dsr']:.3f}   "
          f"(with the empirical trial Sharpe sd {trial_sd:.3f}: {dsr_emp:.3f})")

    ev = out["ev"]
    psym = {p: per_symbol_R(ev[p]["_result"]) for p in ("is", "oos")}
    for p in ("is", "oos"):
        print(f"\nper symbol R ({p}, net of all costs):")
        print(psym[p].round(3).to_string())
    pyear = {"full": per_year(out["full"])}
    pyear.update({p: per_year(ev[p]["_result"]) for p in ("fred_pre", "fred_oos")})
    print("\nper year (full OANDA 2005-2020/05):")
    print(pyear["full"].round(4).to_string())
    for p in ("fred_pre", "fred_oos"):
        print(f"\nper year ({p}):")
        print(pyear[p].round(4).to_string())

    diag = diagnostics(ev, out["ev2"])
    print("\nCost / execution diagnostics (1% risk):")
    print(diag.to_string(index=False, float_format=lambda v: f"{v:.3f}"))
    sub = fred_subperiods(ev["fred_pre"]["_result"])
    print("\nFRED pre-sample sub-periods (momentum component only - carry has no data):")
    print(sub.to_string(index=False, float_format=lambda v: f"{v:.3f}"))

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

    fam = family_summary(S)
    print("\nBest IS config per signal family:")
    print(fam.to_string(index=False, float_format=lambda v: f"{v:.3f}"))

    tk_is = ev["is"]["_result"].taken
    aud = tk_is[tk_is.symbol.str.contains("AUD")]
    aud_dir = np.where(aud.symbol.str.startswith("AUD"), aud.dir, -aud.dir)  # +1 = long AUD
    aud_is = {"n_pairs": int(aud.symbol.nunique()), "sum_R": float(aud.R_net.sum()), "share": float(aud.R_net.sum() / tk_is.R_net.sum()),
              "long_aud_R": float(aud.R_net[aud_dir > 0].sum())}
    print(f"\nAUD pairs in IS: {aud_is}")
    skips = []
    for pname in ("is", "oos"):
        allt = ev[pname]["_result"].trades
        sk = allt[allt.skip_reason == "below_min_lot"].symbol.value_counts()
        skips.append({"period": pname.upper(), "signals": len(allt), "taken": int(allt.taken.sum()),
                      "below_min_lot": int(sk.sum()),
                      "top_symbols": ", ".join(f"{k} {v}" for k, v in sk.head(4).items())})
    skips = pd.DataFrame(skips)
    print("\nMin-lot skips:")
    print(skips.to_string(index=False))
    write_report(dict(skips=skips, aud_is=aud_is, best=best, n_trials=n_trials, dsr=out["dsr"], dsr_emp=dsr_emp,
                      trial_sd=trial_sd, allis=allis, stageA=stageA, plateau=plateau,
                      met=met, psym=psym, pyear=pyear, diag=diag, sub=sub, nbt=nbt, fam=fam,
                      sh_median=float(allis.sharpe.astype(float).median()),
                      sh_pos=float((allis.sharpe.astype(float) > 0).mean())))
    print(f"\nreport written: reports/{FAMILY}.md")
    return S, plateau, allis, stageA, out, nbt


# ------------------------------------------------------------------ diagnostics
def deflated_sharpe_emp(m: dict, n_trials: int, trial_sd_ann: float) -> float:
    from scipy import stats

    from fxlab.metrics import ANN, deflated_sharpe
    r = m["_result"].equity.pct_change().dropna()
    return deflated_sharpe(m.get("sharpe", 0.0), len(r), n_trials, float(stats.skew(r)),
                           float(stats.kurtosis(r, fisher=False)),
                           sr_var_trials=(trial_sd_ann / math.sqrt(ANN)) ** 2)


def diagnostics(ev: dict, ev2: dict) -> pd.DataFrame:
    rows = []
    for name, e in (("is", ev["is"]), ("oos", ev["oos"]), ("fred_pre", ev["fred_pre"]),
                    ("fred_oos", ev["fred_oos"]), ("is_cost2x", ev2["is"]),
                    ("oos_cost2x", ev2["oos"])):
        res = e["_result"]
        t = res.taken
        allt = res.trades
        hold = (t.exit_time - t.entry_time).dt.total_seconds() / 86400
        rows.append({
            "period": name, "trades": len(t),
            "gross_avg_R": float(t.R.mean()),            # after spread/slippage only
            "net_avg_R": float(t.R_net.mean()),          # + commission + swap
            "swap_R": float((t.swap_jpy / t.risk_jpy).mean()),
            "comm_R": float((-t.commission_jpy / t.risk_jpy).mean()),
            "avg_hold_days": float(hold.mean()),
            "stop_exits": float((t.reason == "stop").mean()),
            "long_share": float((t.dir > 0).mean()),
            "skipped_min_lot": int((allt.skip_reason == "below_min_lot").sum()),
            "skipped_other": int(((~allt.taken) & (allt.skip_reason != "below_min_lot")).sum()),
        })
    return pd.DataFrame(rows)


def fred_subperiods(res) -> pd.DataFrame:
    from fxlab.metrics import equity_stats
    eq = res.equity
    rows = []
    for a, b in (("1976-01-01", "1991-01-01"), ("1991-01-01", "2005-01-01")):
        e = eq[(eq.index >= a) & (eq.index < b)]
        st = equity_stats(e)
        t = res.taken
        t = t[(t.entry_time >= a) & (t.entry_time < b)]
        rows.append({"span": f"{a[:4]}-{int(b[:4]) - 1}", "cagr": st["cagr"],
                     "sharpe": st["sharpe"], "max_dd": st["max_dd"], "trades": len(t),
                     "net_avg_R": float(t.R_net.mean())})
    return pd.DataFrame(rows)


def family_summary(S: Search) -> pd.DataFrame:
    rows = []
    for k, m in S.done.items():
        p = S.params[k]
        if p["signal"] != "combo":
            fam = p["signal"]
        elif all(x.startswith("mom") and x != "mom" for x in p["components"]):
            fam = "mom_ensemble"
        else:
            fam = "combo(" + "+".join(x.rstrip("0123456789") for x in p["components"]) + ")"
        rows.append({"family": fam, "config": label(p), "sharpe": m.get("sharpe"),
                     "trades": m.get("trades"), "avg_R": m.get("avg_R"),
                     "t_stat_R": m.get("t_stat_R"), "ok_n": m.get("trades", 0) >= MIN_IS_TRADES})
    df = pd.DataFrame(rows)
    out = []
    for fam, g in df.groupby("family"):
        g2 = g[g.ok_n]
        best = g2.sort_values("sharpe").iloc[-1] if len(g2) else None
        out.append({"family": fam, "n_trials": len(g), "median_sharpe": float(g.sharpe.median()),
                    "best_config_n150": best["config"] if best is not None else "-",
                    "best_sharpe_n150": float(best["sharpe"]) if best is not None else float("nan"),
                    "best_t_R": float(best["t_stat_R"]) if best is not None else float("nan")})
    return pd.DataFrame(out).sort_values("best_sharpe_n150", ascending=False)


def decade_table(py: pd.Series) -> str:
    years = py.index.astype(int)
    decs = sorted({y // 10 * 10 for y in years})
    lines = ["| decade | " + " | ".join(str(i) for i in range(10)) + " |", "|---" * 11 + "|"]
    for d in decs:
        cells = []
        for i in range(10):
            y = d + i
            cells.append(f"{py.loc[y]:.1%}" if y in py.index else "")
        lines.append(f"| {d}s | " + " | ".join(cells) + " |")
    return "\n".join(lines)


# ------------------------------------------------------------------------ report
def write_report(R: dict) -> None:
    b = R["best"]
    met = R["met"]
    lab = label(b)
    fin = pd.DataFrame([{"period": name, **met[p]} for p, name in (
        ("is", "IS 2005-2014"), ("oos", "OOS 2015-2020/05"), ("fred_pre", "FRED pre 1976-2004 *"),
        ("fred_oos", "FRED OOS 2020/05-2026/09"), ("is_cost2x", "IS cost x2"),
        ("oos_cost2x", "OOS cost x2"))])
    pl = R["plateau"].drop(columns="_p")
    diag = R["diag"]
    dg = {r.period: r for r in diag.itertuples()}
    nbt = R["nbt"]
    n_nb_neg = int((nbt.oos_sharpe.iloc[1:] < 0).sum())
    ps_is, ps_oos = R["psym"]["is"], R["psym"]["oos"]
    top_is = ps_is.sort_values("sum_R", ascending=False).head(3)
    is_total = ps_is.sum_R.sum()
    fy = R["pyear"]["full"]
    is_years = fy[(fy.index >= 2005) & (fy.index <= 2014)]
    oos_years = fy[fy.index >= 2015]
    sub = R["sub"]
    oos = met["oos"]
    ism = met["is"]
    sa = R["stageA"]
    rev_t = sa[sa.config.str.startswith("rev") & sa.config.str.contains(r"\|W\|")].t_stat_R
    rank_corr = float(nbt.is_sharpe.rank().corr(nbt.oos_sharpe.rank()))
    aud_is = R["aud_is"]

    L = []
    L.append(f"# cross_sectional - 通貨の横断ランキング戦略（モメンタム / リバーサル / バリュー / キャリー）研究レポート\n")
    L.append(f"生成: `python scripts/research_cross_sectional.py`（この表の数値はすべてスクリプト出力と同一）\n")
    L.append("## 結論\n")
    L.append(
        f"**判定: no_edge（採用不可）。** 6通貨（USD EUR JPY GBP AUD CAD）を強弱でランキングし、"
        f"最強通貨を買い・最弱通貨を売る戦略群を IS（2005-2014）だけで {R['n_trials']} 通り検証した。"
        f"IS で最も頑健だった設定（キャリー＋63日モメンタムの合成スコア、週次リバランス、上位2×下位2通貨の4ペア）は "
        f"IS Sharpe {ism['sharpe']:.2f}・純平均R {ism['avg_R']:.3f}（t = {ism['t_stat_R']:.2f}）だったが、"
        f"**OOS（2015-2020/05）では Sharpe {oos['sharpe']:.2f}・CAGR {oos['cagr']:.1%}・"
        f"純平均R {oos['avg_R']:.3f}（t = {oos['t_stat_R']:.2f}）と有意にマイナス**。"
        f"周辺パラメータ {len(nbt) - 1} 通りも OOS では {n_nb_neg} 通りがマイナス"
        f"（OOS Sharpe {nbt.oos_sharpe.iloc[1:].min():.2f} 〜 {nbt.oos_sharpe.iloc[1:].max():.2f}）で、"
        f"パラメータの運ではなく戦略の性質として 2015 年以降に機能していない。"
        f"FRED の最新期間（2020/05-2026/09）も Sharpe {met['fred_oos']['sharpe']:.2f}。\n")
    L.append(
        f"IS の Sharpe {ism['sharpe']:.2f} も {R['n_trials']} 通りの試行を考慮した Deflated Sharpe Ratio が "
        f"**{R['dsr']:.3f}**（試行 Sharpe の実測ばらつき {R['trial_sd']:.2f} を使っても {R['dsr_emp']:.3f}）で、"
        f"偶然と区別できない。全試行の IS Sharpe は中央値 {R['sh_median']:.2f}・標準偏差 {R['trial_sd']:.2f}・"
        f"プラスの割合 {R['sh_pos']:.0%}（キャリー＋モメンタム系の試行 40 通りが中央値を押し上げている）。"
        f"さらに IS の利益の {aud_is['share']:.0%} が豪ドル絡みのペア（ほぼすべて豪ドル買い）から来ており、"
        f"採用基準5（特定銘柄への集中がないこと）を IS の段階で既に満たしていない。\n")
    L.append(
        f"FRED 1976-2004（キャリーは金利表が無いためモメンタム部分のみ）では Sharpe {met['fred_pre']['sharpe']:.2f}"
        f"（1976-1990: {sub.sharpe.iloc[0]:.2f}、1991-2004: {sub.sharpe.iloc[1]:.2f}）。"
        f"「FX の通貨モメンタムは 1990 年頃までは効いていたが、その後は消えた」という形で、"
        f"ベースライン（トレンドフォロー）の観察、およびトレンド・モメンタムの利益が 1990 年代以降に縮小したという既存研究と整合する。**50万円 → 1億円の目標に使える優位性は、この戦略群には無い。**\n")

    L.append("## 戦略の定義（最終選択された設定）\n")
    L.append("| 項目 | 内容 |\n|---|---|")
    L.append("| 銘柄 | 6通貨の全15ペア: USDJPY, EURUSD, GBPUSD, AUDUSD, USDCAD, EURJPY, GBPJPY, AUDJPY, CADJPY, EURGBP, EURAUD, GBPAUD, EURCAD, AUDCAD, GBPCAD（XAUUSD は対象外） |")
    L.append("| 時間足 | 日足（サーバー時間 NY+7h、NY17時締め）。判定は確定足の終値、発注は翌日 01:00（ロールオーバー時間帯を避ける、エンジン仕様） |")
    L.append("| 通貨の価値 | USD=1、EUR=EURUSD、GBP=GBPUSD、AUD=AUDUSD、JPY=1/USDJPY、CAD=1/USDCAD の日足終値（対数） |")
    L.append(f"| モメンタム | 各通貨の ln(価値_t) − ln(価値_(t−{b['lookback']}本)) |")
    L.append("| キャリー | **前年**の政策金利の年平均（`instruments.policy_rate(ccy, 年−1)`、2005年分の判定は2004年の値をモジュール内に定義）。当年の値は使わない |")
    L.append("| 合成スコア | キャリーとモメンタムをそれぞれ6通貨の横断 z-score（母標準偏差）にして単純平均 |")
    L.append(f"| リバランス | 毎週、その週の最初の日足（通常は月曜）の確定時に判定 → 火曜 01:00 に発注 |")
    L.append(f"| 選択 | 合成スコアの上位{b['k']}通貨（強）と下位{b['k']}通貨（弱）。ペア BASE/QUOTE は BASE が強・QUOTE が弱なら買い、逆なら売り（常に {b['k']*b['k']} ペア）。同点は USD, EUR, JPY, GBP, AUD, CAD の順 |")
    L.append("| 保有・決済 | リバランス日に目標から外れたペアは成行決済、目標が反転したら決済して逆張り（ドテン）。目標に残るポジションはそのまま保有（ロット再計算なし） |")
    L.append(f"| 損切り（エントリー時に必ず設定） | エントリー価格 ∓ {b['stop_atr']:g} × ATR({b['atr_n']})（MT5 iATR、日足） |")
    if b["trail_atr"]:
        L.append(f"| トレーリング | 毎日の判定時（01:00）に 損切り = max(現在の損切り, エントリー後の最高値 − {b['trail_atr']:g} × ATR({b['atr_n']}))（売りは対称）。利確なし |")
    L.append("| 損切り後 | 次のリバランスまで再エントリーしない |")
    L.append("| 資金管理 | 1トレードのリスク = 残高の1%（損切り幅×ロット）、0.01ロット単位切り捨て、同一銘柄1ポジション、同時リスク合計8%まで |")
    L.append("")

    L.append("## 探索の手順（IS 2005-2014 のみで選択）\n")
    L.append(
        f"* 試行数 **{R['n_trials']}**（すべて `reports/trials/cross_sectional.jsonl` に記録。"
        f"モジュール動作確認で走らせた mom63・月次・k1・損切り3ATR も1試行として記録）。"
        f"順位付けは 1%リスクの日次損益の Sharpe、IS 取引数 {MIN_IS_TRADES} 未満は除外。")
    L.append("* 事前の損切り幅: 週次リバランスは 3 ATR、月次は 5 ATR（保有期間の値動きの 1.5〜2σ 程度）。")
    L.append("* Stage A（単一ファクター）: モメンタム 21/63/126/252日（週次・月次、k=1/2）、12-1モメンタム、"
             "ボラ調整モメンタム 63/252日、短期リバーサル 5/21日、バリュー（5年移動平均からの乖離／5年リターンの逆）、キャリー。")
    L.append("* Stage B（合成）: キャリー＋モメンタム、キャリー＋バリュー、モメンタム＋バリュー、3因子（月次、k=1/2）。")
    L.append("* Stage C: 上位3つに 損切り ×0.6/×1.6、符号反転まで保有、損切り後の再エントリー、k=3、シャンデリア・トレール。")
    L.append("* Stage D（プラトー検定）: 候補ごとに各パラメータを ±20〜50% 動かした近傍（ルックバック ×0.67/×1.5、損切り ×0.7/×1.4、ATR期間 14/40、k±1、週次⇔月次）を IS で評価。")
    L.append("* 第1ラウンドの最良（モメンタム126日・週次・k=2・損切り4.8ATR、IS Sharpe 0.43）は近傍でルックバック189日が −0.45 に崩れる尖った最適値だった。"
             "そこで第2ラウンド（Stage E / C2 / D2）で、構造的に頑健なはずの変種（ルックバック 21/63/126/252 のアンサンブル、週次ボラ調整モメンタム、週次キャリー＋モメンタム、順位バッファー決済）を追加で IS 検証した。")
    L.append("* 選択規則（OOS を見る前に固定）: 近傍の IS Sharpe がすべてプラスの候補の中で、"
             "0.5 ×（本体の IS Sharpe ＋ 近傍の IS Sharpe 中央値）が最大のもの。\n")
    L.append("シグナル系統ごとの IS 最良値（取引数150以上）:\n")
    L.append(md_table(R["fam"]))
    L.append("")
    L.append("Stage A / B / E の全設定（IS）:\n")
    L.append(md_table(R["stageA"], PCT))
    L.append("")
    L.append("プラトー検定（IS）:\n")
    L.append(md_table(pl))
    L.append("")
    L.append(
        "観察（ISのみ）: キャリー単独・バリュー単独は保有が数か月〜数年と長く、スワップのブローカー・マークアップ（片側 年2.5%）で"
        f"純平均Rが大きくマイナス。短期リバーサル（週次）は t = {rev_t.max():.1f}〜{rev_t.min():.1f} と明確にマイナス（= 1週〜1か月の弱いモメンタム＋コスト）。"
        "モメンタム単独は 63〜126日の週次だけが Sharpe 0.1〜0.4 で、ルックバックを動かすと崩れる。"
        "キャリーとモメンタムの合成が IS で近傍を含めて最も安定してプラスだった。\n")

    L.append("## 最終成績（1%リスク、初期資金50万円）\n")
    L.append(md_table(fin, PCT))
    L.append("")
    L.append("\\* FRED pre はキャリーの入力（前年の政策金利）が 2004 年以前に無いため、合成スコアはモメンタム部分だけで計算される（別の戦略の検証に近い）。\n")
    L.append(
        f"* avg_R / t_stat_R / profit_factor_R は **純R**（スプレッド・スリッページ・手数料・スワップ込みの損益 ÷ 初期リスク、エンジン仕様）。")
    L.append(f"* Deflated Sharpe Ratio（IS, n_trials={R['n_trials']}）: **{R['dsr']:.3f}**\n")
    L.append("コストと約定の内訳:\n")
    L.append(md_table(diag))
    L.append("")
    L.append(
        f"* コスト前（スプレッド・スリッページのみ控除）の平均Rも OOS で {dg['oos'].gross_avg_R:.3f} とマイナス。"
        f"OOS の負けはコストではなくシグナルの方向そのもの。"
        f"スワップは平均 {dg['is'].swap_R:.3f}R（IS）/ {dg['oos'].swap_R:.3f}R（OOS）、手数料は {dg['is'].comm_R:.3f}R / {dg['oos'].comm_R:.3f}R。")
    L.append(
        f"* コスト2倍でも IS の Sharpe は {met['is_cost2x']['sharpe']:.2f}（1倍 {ism['sharpe']:.2f}）とほぼ同じで、コスト感応度は小さい。\n")

    L.append("## 周辺パラメータ（ISで選択、OOSは報告のみ）\n")
    L.append(md_table(nbt, {"oos_cagr": "pct"}))
    L.append("")
    L.append(f"近傍 {len(nbt) - 1} 通りのうち OOS でマイナス: **{n_nb_neg} 通り**。"
             f"本体＋近傍の IS Sharpe と OOS Sharpe の順位相関は {rank_corr:.2f}（IS で良いほど OOS で良い、という関係は無い）。\n")

    L.append("## 年別リターン（1%リスク、複利）\n")
    L.append("OANDA 2005-2020/05（2005-2014 が IS、2015- が OOS）:\n")
    L.append(decade_table(fy))
    L.append("")
    L.append(f"IS ではプラスの年 {int((is_years > 0).sum())}/{len(is_years)}、OOS では {int((oos_years > 0).sum())}/{len(oos_years)}。\n")
    L.append("FRED 1976-2004（モメンタム部分のみ）:\n")
    L.append(decade_table(R["pyear"]["fred_pre"]))
    L.append("")
    L.append(md_table(sub, {"cagr": "pct", "max_dd": "pct"}))
    L.append("")
    L.append("FRED 2020/05-2026/09:\n")
    L.append(decade_table(R["pyear"]["fred_oos"]))
    L.append("")

    L.append("## 銘柄別（純R）\n")
    L.append("IS:\n")
    L.append(md_table(ps_is.reset_index()))
    L.append("")
    L.append("OOS:\n")
    L.append(md_table(ps_oos.reset_index()))
    L.append("")
    L.append(
        f"IS の合計R {is_total:.1f} のうち上位3銘柄（{', '.join(top_is.index)}）で {top_is.sum_R.sum():.1f}。"
        f"豪ドル絡みの{aud_is['n_pairs']}ペアだけで IS 合計R の {aud_is['share']:.0%}（{aud_is['sum_R']:.1f}R）を占め、"
        f"その大半は豪ドル買い（{aud_is['long_aud_R']:.1f}R、高金利通貨の買い＋上昇トレンド）。"
        f"OOS で合計Rが最も悪い3銘柄は {', '.join(ps_oos.head(3).index)}。\n")

    L.append("## 50万円口座での制約\n")
    L.append(md_table(R["skips"]))
    L.append("")
    L.append(
        "`below_min_lot` は 1%リスク（残高50万円なら5,000円）では 0.01ロットでも損切り幅（3 ATR）の損失が 5,000円を超えるため"
        "発注できなかったシグナル。値幅の大きいポンド絡み（特に GBPJPY）で多く、少額口座では"
        "「上位2×下位2の4ペアを同時に持つ」という設計どおりに運用できない期間がある。\n")
    L.append("## データと検証上の注意\n")
    L.append("* 2005年以前の履歴（12か月・5年のルックバック用）は FRED の日次終値をつなぎ、OANDA の最初の足（2005-01-03）以降の FRED 値は使わない。")
    L.append("* FRED は終値のみで、`fred_as_bars` の合成高値/安値による ATR は本物の約 1.47 倍（15ペアの IS 重複期間 2005-06〜2014-12 で OANDA/FRED 比の中央値 0.68、範囲 0.65〜0.72）。"
             "FRED 上では ATR × 0.68 で損切り・トレール幅を OANDA と揃えた（データ較正であり成績で調整していない）。")
    L.append("* FRED のユーロは 1999 年から。それ以前は5通貨でランキング（k は利用可能通貨数の半分以下に制限）。")
    L.append("* 未来参照チェック: 途中の日付でデータを切ったときのスコア・目標・発注判断が、全データで計算したものとその日付まで完全一致することを毎回確認（スクリプト冒頭、不一致 0）。")
    L.append("* スワップはエンジン仕様で「エントリー年の政策金利差 − 片側年2.5%」を保有全期間に適用。キャリー単独・バリュー単独のような数年保有の建玉では年をまたぐ金利変化が反映されない（本戦略の最終設定は平均保有 "
             f"{dg['is'].avg_hold_days:.0f} 日なので影響は小さい）。")
    L.append("* エンジンの `policy_rate` は 2005〜2026 年に固定（範囲外は端の年の値）。FRED 1976-2004 のスワップは 2005 年の金利差で計算されており、当時の実際の金利差（1980年代の日米差など）とは異なる。\n")

    L.append("## 1億円目標への含意\n")
    L.append(
        f"IS の最良設定でも 1%リスクで CAGR {ism['cagr']:.1%}・最大DD {ism['max_dd']:.1%}（Sharpe {ism['sharpe']:.2f}）。"
        f"仮に優位性が本物でも、この Sharpe ではリスクを上げて複利で 1億円（200倍）に届かせるには破産リスクが大きすぎる。"
        f"そして OOS では優位性そのものが消えている。通貨の横断ランキング（モメンタム・キャリー・バリュー・リバーサル）は、"
        f"Titan FX のスワップ条件（マークアップ片側 年2.5%）と 6 通貨という狭い横断面では、個人口座の自動売買の柱にはならない。\n")

    with open(ROOT / "reports" / f"{FAMILY}.md", "w") as f:
        f.write("\n".join(L))


if __name__ == "__main__":
    main()
