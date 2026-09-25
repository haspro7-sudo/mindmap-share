"""Staged growth plan and Monte Carlo projection (50万円 -> 1億円).

The strategy's daily returns at a reference risk level are block-bootstrapped and
rescaled to the risk level each stage allows.  Yearly Japanese income tax on
offshore FX profits (雑所得・総合課税, no loss carry-forward) is withdrawn from the
account every March, which is what actually happens to a compounding account.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

# 所得税の速算表 (課税所得, 税率, 控除額)  + 復興特別所得税 2.1%  + 住民税 10%
_BRACKETS = [(1_950_000, 0.05, 0), (3_300_000, 0.10, 97_500), (6_950_000, 0.20, 427_500),
             (9_000_000, 0.23, 636_000), (18_000_000, 0.33, 1_536_000),
             (40_000_000, 0.40, 2_796_000), (float("inf"), 0.45, 4_796_000)]


def income_tax(taxable: float) -> float:
    if taxable <= 0:
        return 0.0
    for top, rate, ded in _BRACKETS:
        if taxable <= top:
            return (taxable * rate - ded) * 1.021
    return 0.0


def tax_on_fx_profit(profit: float, other_income: float = 0.0, deduction: float = 620_000,
                     separate: bool = False) -> float:
    """Incremental tax caused by `profit` of FX income in one year.

    separate=True  -> 申告分離課税 20.315% (Japanese registered broker)
    separate=False -> 総合課税 (offshore broker such as Titan FX): marginal income tax on
                      top of other income, plus 10% resident tax.
    """
    if profit <= 0:
        return 0.0
    if separate:
        return profit * 0.20315
    base = max(other_income - deduction, 0.0)
    with_fx = max(other_income + profit - deduction, 0.0)
    return income_tax(with_fx) - income_tax(base) + 0.10 * (with_fx - base)


@dataclass
class Stage:
    name: str
    start_jpy: float        # stage applies while balance >= start_jpy
    risk_mult: float        # multiple of the reference risk (e.g. 1% per trade = 1.0)


@dataclass
class PlanConfig:
    initial: float = 500_000
    target: float = 100_000_000
    stages: list[Stage] = field(default_factory=list)
    dd_throttle: list[tuple[float, float]] = field(default_factory=lambda: [(0.15, 0.5), (0.25, 0.25)])
    ruin_level: float = 0.3          # treat falling below 30% of the starting capital as ruin
    years: int = 30
    tax: bool = True
    other_income: float = 0.0
    separate_tax: bool = False
    monthly_deposit: float = 0.0
    block: int = 20                  # bootstrap block length (trading days)
    days_per_year: int = 260


def _stage_mult(stages, bal):
    m = stages[0].risk_mult if stages else 1.0
    for s in stages:
        if bal >= s.start_jpy:
            m = s.risk_mult
    return m


def simulate(daily_ret: np.ndarray, cfg: PlanConfig, n_paths: int = 2000, seed: int = 7):
    """Block-bootstrap Monte Carlo.  daily_ret: returns of the strategy at reference risk."""
    rng = np.random.default_rng(seed)
    r = np.asarray(daily_ret, float)
    r = r[np.isfinite(r)]
    T = cfg.years * cfg.days_per_year
    nblk = int(np.ceil(T / cfg.block))
    hit_day = np.full(n_paths, -1)
    ruined = np.zeros(n_paths, bool)
    final = np.zeros(n_paths)
    max_dd = np.zeros(n_paths)
    taxes = np.zeros(n_paths)
    yearly_bal = np.zeros((n_paths, cfg.years + 1))
    for p in range(n_paths):
        starts = rng.integers(0, len(r) - cfg.block, nblk)
        path = np.concatenate([r[s:s + cfg.block] for s in starts])[:T]
        bal = cfg.initial
        peak = bal
        year_start_bal = bal
        deposits_year = 0.0
        pending_tax = 0.0
        mdd = 0.0
        yearly_bal[p, 0] = bal
        for t in range(T):
            mult = _stage_mult(cfg.stages, bal)
            dd = 1 - bal / peak
            throttle = 1.0
            for d, m in sorted(cfg.dd_throttle):
                if dd >= d:
                    throttle = m
            mult *= throttle
            bal *= 1 + mult * path[t]
            if cfg.monthly_deposit and t % 21 == 20:
                bal += cfg.monthly_deposit
                deposits_year += cfg.monthly_deposit
            peak = max(peak, bal)
            mdd = max(mdd, 1 - bal / peak)
            if t % cfg.days_per_year == cfg.days_per_year - 1:
                y = t // cfg.days_per_year
                profit = bal - year_start_bal - deposits_year
                pending_tax = tax_on_fx_profit(profit, cfg.other_income,
                                               separate=cfg.separate_tax) if cfg.tax else 0.0
                year_start_bal = bal
                deposits_year = 0.0
                yearly_bal[p, y + 1] = bal
            # pay last year's tax in March (~50 trading days into the new year)
            if pending_tax and t % cfg.days_per_year == 50:
                pay = min(pending_tax, bal)
                bal -= pay
                taxes[p] += pay
                year_start_bal -= pay
                peak = max(bal, peak * (bal / (bal + pay)))  # tax is not a trading drawdown
                pending_tax = 0.0
            if bal >= cfg.target and hit_day[p] < 0:
                hit_day[p] = t
            if bal <= cfg.initial * cfg.ruin_level:
                ruined[p] = True
                bal = max(bal, 0.0)
                yearly_bal[p, t // cfg.days_per_year + 1:] = bal
                break
        final[p] = bal
        max_dd[p] = mdd
    years_to_target = np.where(hit_day >= 0, (hit_day + 1) / cfg.days_per_year, np.nan)
    return {
        "p_reach_target": float((hit_day >= 0).mean()),
        "years_to_target_median": float(np.nanmedian(years_to_target)) if (hit_day >= 0).any() else float("nan"),
        "years_to_target_p25": float(np.nanpercentile(years_to_target, 25)) if (hit_day >= 0).any() else float("nan"),
        "years_to_target_p75": float(np.nanpercentile(years_to_target, 75)) if (hit_day >= 0).any() else float("nan"),
        "p_ruin": float(ruined.mean()),
        "final_median": float(np.median(final)),
        "max_dd_median": float(np.median(max_dd)),
        "max_dd_p90": float(np.percentile(max_dd, 90)),
        "taxes_median": float(np.median(taxes)),
        "yearly_balance_pctiles": pd.DataFrame(
            np.percentile(yearly_bal, [10, 25, 50, 75, 90], axis=0).T,
            columns=["p10", "p25", "p50", "p75", "p90"]),
        "years_to_target": years_to_target,
    }
