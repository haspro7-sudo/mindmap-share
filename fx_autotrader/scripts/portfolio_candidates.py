"""Standalone and combined behaviour of the surviving candidate strategies.

All candidates were selected by their family research on IS (2005-2014) only.  This
script re-runs them on the final (audited) engine, reports each one standalone at
1% risk, their daily-return correlations, and simple combinations.

NOTE: choosing WHICH families to combine happens after their OOS results were seen,
so any combined OOS number here is not a clean out-of-sample estimate.  The final
system is therefore validated forward on a demo account (docs/STAGED_PLAN.md).

    python scripts/portfolio_candidates.py
"""
from __future__ import annotations

import json
import sys
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from fxlab import backtest as B  # noqa: E402
from fxlab import data as D  # noqa: E402
from fxlab.backtest import SymbolContext  # noqa: E402
from fxlab.engine import PortfolioConfig, RiskSchedule, run_portfolio, simulate_symbol  # noqa: E402
from fxlab.instruments import CostModel  # noqa: E402
from fxlab.metrics import summarize  # noqa: E402
from fxlab.strategies.carry_trend import CarryTrend  # noqa: E402
from fxlab.strategies.index_dip_buy import IndexDipBuy  # noqa: E402
from fxlab.strategies.index_trend_hold import IndexTrendHold  # noqa: E402
from fxlab.strategies.mean_reversion import MeanReversion  # noqa: E402
from fxlab.strategies.seasonality import SeasonalWindow  # noqa: E402

FX15 = ["USDJPY", "EURUSD", "GBPUSD", "AUDUSD", "USDCAD", "EURJPY", "GBPJPY", "AUDJPY",
        "CADJPY", "EURGBP", "EURAUD", "GBPAUD", "EURCAD", "AUDCAD", "GBPCAD"]
MAJORS5 = ["USDJPY", "EURUSD", "GBPUSD", "AUDUSD", "USDCAD"]
IDX7 = ["US500", "NAS100", "US2000", "JPN225", "UK100", "FRA40", "AUS200"]


def candidates():
    return {
        "gotobi": (SeasonalWindow(tz="JST", entry_hour=10, exit_hour=15, ccy="JPY", ccy_dir=1,
                                  days="gotobi", stop_atr=0.5, atr_n=14, entry_early_min=5,
                                  min_server_hour=1), ["USDJPY"], "M1"),
        "meanrev": (MeanReversion(tf="D1", entry="bb", bb_n=20, bb_k=1.5, exit="sma", exit_n=20,
                                  atr_n=14, stop_atr=2.5, max_hold=10, adx_n=14, adx_max=25,
                                  vol_n=100, vol_max=1.0, d1_trend="flat", d1_n=200, d1_k=3.0),
                    MAJORS5, "H1"),
        "carry": (CarryTrend(min_diff=4, trend="ema", trend_n=50, vol_fast=20, vol_slow=250,
                             vol_entry=1.0, vol_exit=1.5, atr_n=20, stop_atr=2.0, trail_atr=3.0),
                  FX15, "H1"),
        "dipbuy": (IndexDipBuy(tf="D1", entry="nlow", nlow_n=10, trend_n=200, exit="sma",
                               exit_n=10, max_hold=20, atr_n=20, stop_atr=4.0), IDX7, "H1"),
        "idxhold": (IndexTrendHold(filter="mom", mom_n=252, stop_atr=5.0, atr_n=20, side="long"),
                    IDX7 + ["XAUUSD"], "H1"),
    }


@lru_cache(maxsize=2)
def m1_exec_bars(sym: str) -> pd.DataFrame:
    m = pd.read_parquet(D.m1_path(sym), columns=["open", "high", "low", "close"])
    m.index = D.to_server_time(m.index)
    m = m[~m.index.duplicated(keep="first")]
    return m[m.index.dayofweek < 5]


def trades_for(tag, strat, syms, exec_):
    out = {}
    for s in syms:
        if exec_ == "M1":
            out[f"{tag}|{s}"] = simulate_symbol(strat.decisions(SymbolContext(s)), strat.tf,
                                                m1_exec_bars(s))
        else:
            out[f"{tag}|{s}"] = B.symbol_trades(strat, s)
    return out


def run(trades, start, end, initial=500_000, risk=0.01, book_risk=None, cost_mult=1.0,
        max_open_risk=0.08, max_open=10):
    syms = sorted({k.split("|")[1] for k in trades})
    daily = {s: B._bars("oanda", s, "D1")["close"] for s in syms}
    cfg = PortfolioConfig(initial_jpy=initial, risk=RiskSchedule(base_risk=risk),
                          costs=CostModel(multiplier=cost_mult), book_risk=book_risk or {},
                          max_open_risk=max_open_risk, max_open_trades=max_open)
    res = run_portfolio(trades, B.conversion_table("oanda"), daily, cfg, start, end)
    return res, summarize(res)


KEYS = ["cagr", "max_dd", "sharpe", "trades", "avg_R", "t_stat_R", "worst_year"]


def row(name, s):
    return {"name": name, **{k: round(s.get(k, np.nan), 4) if isinstance(s.get(k), float)
                             else s.get(k) for k in KEYS}}


def main():
    cands = candidates()
    all_trades = {}
    rows = []
    daily_rets = {}
    for tag, (strat, syms, ex) in cands.items():
        tr = trades_for(tag, strat, syms, ex)
        all_trades.update(tr)
        for per, (a, b) in {"IS": (B.IS_START, B.IS_END), "OOS": (B.OOS_START, B.OOS_END)}.items():
            # capacity-free diagnostic (50M JPY) avoids min-lot skips on index CFDs
            for init in (500_000, 50_000_000):
                res, s = run(tr, a, b, initial=init)
                rows.append(row(f"{tag:8s} {per:3s} {init/1e6:>4.1f}M", s))
        res, s = run(tr, B.IS_START, B.OOS_END, initial=50_000_000)
        daily_rets[tag] = res.equity.pct_change().fillna(0.0)
    with pd.option_context("display.width", 200, "display.max_columns", 20):
        print(pd.DataFrame(rows).to_string(index=False))
    R = pd.DataFrame(daily_rets).fillna(0.0)
    print("\ndaily return correlation 2005-2020/05 (50M JPY, 1% risk each):")
    print(R.corr().round(2).to_string())

    print("\ncombinations (each book 1% risk; account caps 8% open risk / 10 positions):")
    combos = {
        "all5": list(cands),
        "gotobi+meanrev+carry": ["gotobi", "meanrev", "carry"],
        "gotobi+meanrev+carry+dipbuy": ["gotobi", "meanrev", "carry", "dipbuy"],
    }
    crow = []
    for name, tags in combos.items():
        tr = {k: v for k, v in all_trades.items() if k.split("|")[0] in tags}
        for per, (a, b) in {"IS": (B.IS_START, B.IS_END), "OOS": (B.OOS_START, B.OOS_END),
                            "FULL": (B.IS_START, B.OOS_END)}.items():
            for init in (500_000, 50_000_000):
                res, s = run(tr, a, b, initial=init)
                crow.append(row(f"{name:28s} {per:4s} {init/1e6:>4.1f}M", s))
    with pd.option_context("display.width", 200, "display.max_columns", 20):
        print(pd.DataFrame(crow).to_string(index=False))
    out = ROOT / "reports" / "equity"
    out.mkdir(parents=True, exist_ok=True)
    R.to_parquet(out / "candidates_daily_returns.parquet")


if __name__ == "__main__":
    main()
