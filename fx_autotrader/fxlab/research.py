"""Research harness: standard evaluation, trial logging, robustness checks.

Protocol (docs/RESEARCH_PROTOCOL.md):
  * choose parameters on IN-SAMPLE only (OANDA 2005-01 .. 2014-12)
  * every parameter set evaluated is logged as a "trial" (for deflated Sharpe)
  * report OUT-OF-SAMPLE 1 (OANDA 2015-01 .. 2020-05) untouched by selection
  * daily strategies additionally run on FRED close-only data:
      pre-sample 1976 .. 2004 and out-of-sample 2 2020-05 .. 2026-09
  * cost stress: 2x spread/slippage/commission must stay profitable
"""
from __future__ import annotations

import json
import math
import time
from pathlib import Path

import numpy as np
import pandas as pd

from . import backtest as B
from .engine import PortfolioConfig, RiskSchedule
from .instruments import CostModel
from .metrics import deflated_sharpe, equity_stats, trade_stats

TRIALS_DIR = Path(__file__).resolve().parents[1] / "reports" / "trials"

FX_MAJORS = ["USDJPY", "EURUSD", "GBPUSD", "AUDUSD", "USDCAD"]
FX_CROSSES = ["EURJPY", "GBPJPY", "AUDJPY", "CADJPY", "EURGBP", "EURAUD", "GBPAUD",
              "EURCAD", "AUDCAD", "GBPCAD"]
ALL_OANDA = FX_MAJORS + FX_CROSSES + ["XAUUSD"]
INDICES = ["US500", "NAS100", "US2000", "JPN225", "UK100", "FRA40", "AUS200"]
ALL_OANDA_PLUS = ALL_OANDA + INDICES
# symbols with pysystemtrade futures history (daily; pre-sample and 2020-05..2024-03 checks)
PST_SYMBOLS = ["US500", "NAS100", "UK100", "FRA40", "JPN225", "XAUUSD", "US2000"]
# pairs available in FRED for daily checks (XAUUSD not available)
FRED_PAIRS = ["USDJPY", "EURUSD", "GBPUSD", "AUDUSD", "USDCAD", "EURJPY", "GBPJPY", "AUDJPY",
              "CADJPY", "EURGBP", "EURAUD", "GBPAUD", "EURCAD", "AUDCAD", "GBPCAD", "NZDUSD",
              "USDCHF"]


def research_config(risk=0.01, cost_mult=1.0, **kw) -> PortfolioConfig:
    return PortfolioConfig(initial_jpy=500_000, risk=RiskSchedule(base_risk=risk),
                           costs=CostModel(multiplier=cost_mult), **kw)


def _short(s: dict) -> dict:
    keys = ["cagr", "max_dd", "sharpe", "mar", "trades", "trades_per_year", "win_rate",
            "avg_R", "profit_factor_R", "t_stat_R", "worst_year", "pct_years_positive",
            "final", "ret_skew", "longest_underwater_days"]
    return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in s.items() if k in keys}


def evaluate(strategy, symbols, periods=("is",), cost_mult=1.0, risk=0.01, cfg=None,
             fred_symbols=None) -> dict:
    """Evaluate a strategy on the named periods.  periods subset of
    {"is", "oos", "full", "fred_pre", "fred_oos", "pst_pre", "pst_oos"}.
    fred_* use FX pairs from FRED (1976-2004 / 2020-05..2026-09); pst_* use
    back-adjusted futures for indices and gold (start..2004 / 2020-05..2024-03)."""
    cfg = cfg or research_config(risk=risk, cost_mult=cost_mult)
    cache: dict = {}
    out = {}
    spans = {"is": (B.IS_START, B.IS_END), "oos": (B.OOS_START, B.OOS_END),
             "full": (B.IS_START, B.OOS_END)}
    for p in periods:
        if p in spans:
            a, b = spans[p]
            res, s = B.backtest(strategy, symbols, a, b, cfg, trades_cache=cache)
        elif p.startswith("pst"):
            ps = [x for x in symbols if x in PST_SYMBOLS]
            if not ps:
                continue
            a, b = ((None, B.PST_PRE_END) if p == "pst_pre"
                    else (B.PST_OOS_START, B.PST_OOS_END))
            res, s = B.backtest(strategy, ps, a, b, cfg, source="pst")
        else:
            fs = fred_symbols or [x for x in symbols if x in FRED_PAIRS]
            if not fs:
                continue
            a, b = ((B.FRED_PRE_START, B.FRED_PRE_END) if p == "fred_pre"
                    else (B.FRED_OOS_START, B.FRED_OOS_END))
            res, s = B.backtest(strategy, fs, a, b, cfg, source="fred")
        out[p] = _short(s)
        out[p]["_result"] = res
    return out


def per_symbol_R(res) -> pd.DataFrame:
    t = res.taken
    if len(t) == 0:
        return pd.DataFrame()
    g = t.groupby("symbol").R
    return pd.DataFrame({"n": g.size(), "avg_R": g.mean(), "sum_R": g.sum(),
                         "win": g.apply(lambda r: (r > 0).mean())}).sort_values("sum_R")


def per_year(res) -> pd.Series:
    eq = res.equity
    y = eq.resample("YE").last()
    first = eq.iloc[0]
    return (y / y.shift(1).fillna(first) - 1).rename(lambda d: d.year)


class TrialLog:
    """Append-only log of every parameter set evaluated (for multiple-testing control)."""

    def __init__(self, family: str):
        TRIALS_DIR.mkdir(parents=True, exist_ok=True)
        self.path = TRIALS_DIR / f"{family}.jsonl"
        self.family = family

    def log(self, params: dict, metrics: dict, period: str = "is"):
        rec = {"family": self.family, "period": period, "params": params,
               "metrics": {k: v for k, v in metrics.items() if not k.startswith("_")},
               "ts": time.strftime("%Y-%m-%dT%H:%M:%S")}
        with open(self.path, "a") as f:
            f.write(json.dumps(rec, default=float) + "\n")

    def count(self) -> int:
        if not self.path.exists():
            return 0
        return sum(1 for _ in open(self.path))

    def load(self) -> pd.DataFrame:
        if not self.path.exists():
            return pd.DataFrame()
        rows = [json.loads(x) for x in open(self.path)]
        return pd.json_normalize(rows)


def dsr_for(result_metrics: dict, res, n_trials: int) -> float:
    eq = res.equity
    r = eq.pct_change().dropna()
    if len(r) < 30:
        return float("nan")
    from scipy import stats
    return deflated_sharpe(result_metrics.get("sharpe", 0.0), len(r), max(n_trials, 1),
                           float(stats.skew(r)), float(stats.kurtosis(r, fisher=False)))


def robustness_report(strategy_factory, base_params: dict, symbols, neighbours: dict,
                      period="is") -> pd.DataFrame:
    """Evaluate one-at-a-time parameter perturbations around base_params."""
    rows = []
    for k, vals in neighbours.items():
        for v in vals:
            p = dict(base_params)
            p[k] = v
            m = evaluate(strategy_factory(**p), symbols, periods=(period,))[period]
            rows.append({"param": k, "value": v, **{x: m.get(x) for x in
                                                    ("cagr", "max_dd", "sharpe", "avg_R", "trades")}})
    return pd.DataFrame(rows)
