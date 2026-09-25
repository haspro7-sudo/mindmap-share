"""Performance statistics."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy import stats

ANN = 260.0  # trading days per year (bdate_range calendar)


def equity_stats(eq: pd.Series) -> dict:
    eq = eq.dropna()
    if len(eq) < 2 or eq.iloc[0] <= 0:
        return {}
    years = max((eq.index[-1] - eq.index[0]).days / 365.25, 1e-9)
    final = eq.iloc[-1]
    cagr = (final / eq.iloc[0]) ** (1 / years) - 1 if final > 0 else -1.0
    ret = eq.pct_change().dropna()
    ret = ret[np.isfinite(ret)]
    sd = ret.std()
    sharpe = ret.mean() / sd * math.sqrt(ANN) if sd > 0 else 0.0
    dn = math.sqrt(float((np.minimum(ret, 0.0) ** 2).mean()))
    sortino = ret.mean() / dn * math.sqrt(ANN) if dn > 0 else 0.0
    peak = eq.cummax()
    dd = eq / peak - 1
    maxdd = -dd.min()
    # longest time under water (calendar days)
    uw = dd < 0
    longest, cur, start = 0, 0, None
    for t, u in uw.items():
        if u:
            start = start or t
            longest = max(longest, (t - start).days)
        else:
            start = None
    yearly = eq.resample("YE").last().pct_change()
    first_year = eq.resample("YE").last().iloc[0] / eq.iloc[0] - 1
    yearly.iloc[0] = first_year
    monthly = eq.resample("ME").last().pct_change().dropna()
    ulcer = math.sqrt((dd ** 2).mean())
    return {
        "start": str(eq.index[0].date()), "end": str(eq.index[-1].date()),
        "years": round(years, 2), "final": float(final), "cagr": float(cagr),
        "sharpe": float(sharpe), "sortino": float(sortino), "max_dd": float(maxdd),
        "mar": float(cagr / maxdd) if maxdd > 0 else float("inf"),
        "longest_underwater_days": int(longest), "ulcer": float(ulcer),
        "worst_year": float(yearly.min()), "best_year": float(yearly.max()),
        "pct_years_positive": float((yearly > 0).mean()),
        "worst_month": float(monthly.min()) if len(monthly) else 0.0,
        "ret_skew": float(stats.skew(ret)) if len(ret) > 3 else 0.0,
    }


def trade_stats(tr: pd.DataFrame) -> dict:
    if tr is None or len(tr) == 0:
        return {"trades": 0}
    # net R (spread, slippage, commission, swap; per unit of budgeted risk) when the
    # portfolio replay produced it, otherwise the raw price R of simulate_symbol
    R = (tr["R_net"] if "R_net" in tr else tr["R"]).to_numpy(dtype=float)
    wins = R[R > 0]
    losses = R[R <= 0]
    years = max((tr.exit_time.max() - tr.entry_time.min()).days / 365.25, 1e-9)
    pf = wins.sum() / -losses.sum() if losses.sum() < 0 else float("inf")
    hold = (tr.exit_time - tr.entry_time).dt.total_seconds() / 86400
    out = {
        "trades": int(len(tr)), "trades_per_year": float(len(tr) / years),
        "win_rate": float((R > 0).mean()), "avg_R": float(R.mean()),
        "median_R": float(np.median(R)), "profit_factor_R": float(pf),
        "avg_win_R": float(wins.mean()) if len(wins) else 0.0,
        "avg_loss_R": float(losses.mean()) if len(losses) else 0.0,
        "t_stat_R": float(R.mean() / (R.std(ddof=1) / math.sqrt(len(R)))) if len(R) > 2 and R.std() > 0 else 0.0,
        "avg_hold_days": float(hold.mean()),
        "long_share": float((tr.dir > 0).mean()),
    }
    out["gross_avg_R"] = float(tr["R"].mean()) if "R" in tr else float("nan")
    if "pnl_jpy" in tr:
        out["net_pnl_jpy"] = float(tr.pnl_jpy.sum())
        out["swap_jpy"] = float(tr.swap_jpy.sum())
        out["commission_jpy"] = float(tr.commission_jpy.sum())
    return out


def deflated_sharpe(sr_ann: float, n_obs: int, n_trials: int, skew: float = 0.0,
                    kurt: float = 3.0, sr_var_trials: float | None = None) -> float:
    """Bailey & Lopez de Prado deflated Sharpe ratio (probability the true SR > 0
    after accounting for the number of strategy variants tried).  Inputs are
    annualised SR and daily observation count."""
    if n_obs < 10 or n_trials < 1:
        return float("nan")
    sr = sr_ann / math.sqrt(ANN)
    if sr_var_trials is None:
        sr_var_trials = (0.5 / math.sqrt(ANN)) ** 2  # assume trial SRs spread ~0.5 ann.
    emc = 0.5772156649
    if n_trials > 1:
        z1 = stats.norm.ppf(1 - 1.0 / n_trials)
        z2 = stats.norm.ppf(1 - 1.0 / (n_trials * math.e))
        sr0 = math.sqrt(sr_var_trials) * ((1 - emc) * z1 + emc * z2)
    else:
        sr0 = 0.0
    denom = math.sqrt(max(1e-12, 1 - skew * sr + (kurt - 1) / 4.0 * sr ** 2))
    z = (sr - sr0) * math.sqrt(n_obs - 1) / denom
    return float(stats.norm.cdf(z))


def summarize(result) -> dict:
    s = equity_stats(result.equity)
    s.update(trade_stats(result.taken))
    if len(result.trades):
        s["skipped"] = int((~result.trades.taken).sum())
    s["withdrawn"] = float(result.withdrawn)
    return s


def fmt(s: dict) -> str:
    keys = ["start", "end", "cagr", "max_dd", "sharpe", "mar", "trades", "trades_per_year",
            "win_rate", "avg_R", "profit_factor_R", "t_stat_R", "worst_year",
            "pct_years_positive", "final"]
    parts = []
    for k in keys:
        if k not in s:
            continue
        v = s[k]
        if k in ("cagr", "max_dd", "win_rate", "worst_year", "pct_years_positive"):
            parts.append(f"{k}={v:.1%}")
        elif k == "final":
            parts.append(f"final=¥{v:,.0f}")
        elif isinstance(v, float):
            parts.append(f"{k}={v:.2f}")
        else:
            parts.append(f"{k}={v}")
    return " ".join(parts)
