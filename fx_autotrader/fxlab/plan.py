"""Staged growth plan and Monte Carlo projection (50万円 -> 1億円).

The strategy's daily returns at a reference risk level (1% per trade) are block-
bootstrapped and rescaled to the risk multiple each stage allows.  Japanese income
tax on offshore FX profits (雑所得・総合課税, no loss carry-forward) is paid out of the
account every March for the previous calendar year, which is what actually happens
to a compounding account.  Optional monthly deposits model 積立.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numba as nb
import numpy as np
import pandas as pd

# 所得税の速算表 (課税所得の上限, 税率, 控除額) ; 復興特別所得税 2.1% ; 住民税 10%
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


def _tax_table(other_income: float, separate: bool, max_profit: float = 5e9, n: int = 4001):
    """Tabulated tax(profit) for the numba kernel (piecewise linear in profit)."""
    xs = np.concatenate([[0.0], np.geomspace(1e4, max_profit, n - 1)])
    ys = np.array([tax_on_fx_profit(x, other_income, separate=separate) for x in xs])
    return xs, ys


@dataclass
class Stage:
    name: str
    start_jpy: float        # stage applies while balance >= start_jpy
    risk_mult: float        # multiple of the reference risk (1.0 = 1% per trade)


@dataclass
class PlanConfig:
    initial: float = 500_000
    target: float = 100_000_000
    stages: list[Stage] = field(default_factory=lambda: [Stage("S", 0, 1.0)])
    # risk multiple by elapsed year, e.g. [(0, 0.5), (2, 1.0), (4, 1.25)]; overrides `stages`
    risk_by_year: list[tuple[float, float]] = field(default_factory=list)
    # drawdown rules in multiples of the CURRENT per-trade risk (EA: 8x -> halve, 12x -> halt)
    throttle_x: float = 0.0          # 0 = off
    throttle_mult: float = 0.5
    halt_x: float = 0.0              # 0 = off; a halt stops trading for the rest of the path
    ref_risk: float = 0.01           # per-trade risk of the return series (1% per trade)
    dd_throttle: list[tuple[float, float]] = field(default_factory=list)   # absolute DD levels
    ruin_level: float = 0.3          # falling below 30% of the starting capital = ruin
    years: int = 30
    tax: bool = True
    other_income: float = 0.0
    separate_tax: bool = False
    monthly_deposit: float = 0.0
    block: int = 20                  # bootstrap block length (trading days)
    days_per_year: int = 260


@nb.njit(cache=True)
def _mc_kernel(r, starts, block, T, dpy, initial, target, ruin, st_start, st_mult,
               yr_start, yr_mult, dd_lvl, dd_mult, thr_x, thr_mult, halt_x, ref_risk,
               tax_on, tax_x, tax_y, deposit):
    n_paths = starts.shape[0]
    hit = np.full(n_paths, -1)
    ruined = np.zeros(n_paths, np.bool_)
    halted = np.zeros(n_paths, np.bool_)
    final = np.zeros(n_paths)
    max_dd = np.zeros(n_paths)
    taxes = np.zeros(n_paths)
    years = T // dpy
    ybal = np.zeros((n_paths, years + 1))
    for p in range(n_paths):
        bal = initial
        peak = bal
        ystart = bal
        dep_y = 0.0
        pending = 0.0
        mdd = 0.0
        stopped = False
        ybal[p, 0] = bal
        for t in range(T):
            ret = r[starts[p, t // block] + (t % block)]
            if yr_start.shape[0] > 0:
                mult = yr_mult[0]
                for k in range(yr_start.shape[0]):
                    if t >= yr_start[k] * dpy:
                        mult = yr_mult[k]
            else:
                mult = st_mult[0]
                for k in range(st_start.shape[0]):
                    if bal >= st_start[k]:
                        mult = st_mult[k]
            dd = 1.0 - bal / peak
            thr = 1.0
            for k in range(dd_lvl.shape[0]):
                if dd >= dd_lvl[k]:
                    thr = dd_mult[k]
            unit = mult * ref_risk                       # current per-trade risk (fraction)
            if thr_x > 0.0 and dd >= thr_x * unit:
                thr = min(thr, thr_mult)
            if halt_x > 0.0 and dd >= halt_x * unit:
                stopped = True
            if not stopped:
                bal *= 1.0 + mult * thr * ret
            if deposit > 0.0 and t % 21 == 20:
                bal += deposit
                dep_y += deposit
                peak += deposit                          # deposits are not trading gains
            if bal > peak:
                peak = bal
            dd = 1.0 - bal / peak
            if dd > mdd:
                mdd = dd
            if t % dpy == dpy - 1:
                y = t // dpy
                profit = bal - ystart - dep_y
                pending = 0.0
                if tax_on and profit > 0.0:
                    pending = np.interp(profit, tax_x, tax_y)
                ystart = bal
                dep_y = 0.0
                ybal[p, y + 1] = bal
            if pending > 0.0 and t % dpy == 50:          # pay last year's tax in March
                pay = min(pending, bal)
                if bal > 0:
                    peak = peak * (bal - pay) / bal      # tax is not a trading drawdown
                bal -= pay
                taxes[p] += pay
                ystart -= pay
                pending = 0.0
            if bal >= target and hit[p] < 0:
                hit[p] = t
            if bal <= initial * ruin and deposit == 0.0:
                ruined[p] = True
                for yy in range(t // dpy + 1, years + 1):
                    ybal[p, yy] = bal
                break
        final[p] = bal
        max_dd[p] = mdd
        halted[p] = stopped
    return hit, ruined, halted, final, max_dd, taxes, ybal


def simulate(daily_ret, cfg: PlanConfig, n_paths: int = 4000, seed: int = 7) -> dict:
    """Block-bootstrap Monte Carlo.  daily_ret: returns of the strategy at reference risk."""
    rng = np.random.default_rng(seed)
    r = np.asarray(daily_ret, float)
    r = r[np.isfinite(r)]
    T = cfg.years * cfg.days_per_year
    nblk = int(np.ceil(T / cfg.block))
    starts = rng.integers(0, len(r) - cfg.block, size=(n_paths, nblk))
    st = sorted(cfg.stages, key=lambda s: s.start_jpy)
    ry = sorted(cfg.risk_by_year)
    dd = sorted(cfg.dd_throttle)
    tx, ty = _tax_table(cfg.other_income, cfg.separate_tax)
    hit, ruined, halted, final, mdd, taxes, ybal = _mc_kernel(
        r, starts, cfg.block, T, cfg.days_per_year, float(cfg.initial), float(cfg.target),
        float(cfg.ruin_level), np.array([s.start_jpy for s in st], float),
        np.array([s.risk_mult for s in st], float), np.array([y for y, _ in ry], float),
        np.array([m for _, m in ry], float), np.array([d for d, _ in dd], float),
        np.array([m for _, m in dd], float), float(cfg.throttle_x), float(cfg.throttle_mult),
        float(cfg.halt_x), float(cfg.ref_risk), bool(cfg.tax), tx, ty,
        float(cfg.monthly_deposit))
    ytt = np.where(hit >= 0, (hit + 1) / cfg.days_per_year, np.nan)
    reached = hit >= 0

    def pct(q):
        return float(np.nanpercentile(ytt, q)) if reached.any() else float("nan")

    return {
        "p_reach_target": float(reached.mean()),
        "p_reach_10y": float((ytt <= 10).mean()),
        "p_reach_20y": float((ytt <= 20).mean()),
        "years_to_target_median": pct(50) if reached.mean() >= 0.5 else float("nan"),
        "years_to_target_p25": pct(25) if reached.mean() >= 0.25 else float("nan"),
        "p_ruin": float(ruined.mean()),
        "p_halt": float(halted.mean()),
        "final_median": float(np.median(final)),
        "max_dd_median": float(np.median(mdd)),
        "max_dd_p90": float(np.percentile(mdd, 90)),
        "p_dd_over_30": float((mdd > 0.30).mean()),
        "taxes_median": float(np.median(taxes)),
        "yearly_balance_pctiles": pd.DataFrame(
            np.percentile(ybal, [10, 25, 50, 75, 90], axis=0).T,
            columns=["p10", "p25", "p50", "p75", "p90"]),
        "years_to_target": ytt,
    }
