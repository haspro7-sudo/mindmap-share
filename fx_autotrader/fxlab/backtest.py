"""High-level backtest runner.

    from fxlab.backtest import backtest
    res, summary = backtest(MyStrategy(), ["USDJPY", "EURUSD"], "2005-01-01", "2015-01-01")

A strategy is any object with
    name: str
    tf:   str                          # signal timeframe: "H1" | "H4" | "D1"
    decisions(ctx) -> pd.DataFrame     # see engine.DECISION_COLUMNS, indexed like ctx.bars(tf)
where ctx.symbol / ctx.inst / ctx.bars(tf) give access to data.  Decisions for a
bar may use that bar's close; the engine executes them at the next bar's open.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import pandas as pd

from . import data as D
from .engine import (ConversionTable, PortfolioConfig, run_portfolio, simulate_symbol)
from .instruments import INSTRUMENTS
from .metrics import summarize

CONV_SYMBOLS = ["USDJPY", "GBPJPY", "AUDJPY", "CADJPY", "EURJPY"]
FRED_EXTRA_CONV = ["USDCHF", "NZDUSD"]

# Research periods (see docs/RESEARCH_PROTOCOL.md)
IS_START, IS_END = "2005-01-01", "2015-01-01"        # in-sample (OANDA)
OOS_START, OOS_END = "2015-01-01", "2020-05-15"      # out-of-sample 1 (OANDA)
FRED_OOS_START, FRED_OOS_END = "2020-05-15", "2026-12-31"  # out-of-sample 2 (FRED daily)
FRED_PRE_START, FRED_PRE_END = "1976-01-01", "2005-01-01"  # pre-sample (FRED daily)


@lru_cache(maxsize=None)
def _bars(source: str, symbol: str, tf: str) -> pd.DataFrame:
    if source == "oanda":
        return D.load_bars(symbol, tf)
    if source == "fred":
        if tf != "D1":
            raise ValueError("FRED data is daily only")
        return D.fred_as_bars(symbol)
    raise ValueError(source)


@dataclass
class SymbolContext:
    symbol: str
    source: str = "oanda"

    @property
    def inst(self):
        return INSTRUMENTS[self.symbol]

    def bars(self, tf: str) -> pd.DataFrame:
        return _bars(self.source, self.symbol, tf)


def conversion_table(source: str = "oanda") -> ConversionTable:
    tf = "H1" if source == "oanda" else "D1"
    syms = CONV_SYMBOLS + (FRED_EXTRA_CONV if source == "fred" else [])
    closes = {}
    for s in syms:
        b = _bars(source, s, tf)
        closes[s] = b["close"].set_axis(b.index + pd.Timedelta(hours=1) if tf == "H1"
                                        else b.index + pd.Timedelta(hours=23, minutes=59))
    return ConversionTable(closes)


def symbol_trades(strategy, symbol: str, source: str = "oanda", exec_tf: str | None = None):
    ctx = SymbolContext(symbol, source)
    dec = strategy.decisions(ctx)
    if exec_tf is None:
        exec_tf = "H1" if source == "oanda" else "D1"
    exec_bars = ctx.bars(exec_tf)
    return simulate_symbol(dec, strategy.tf, exec_bars)


def backtest(strategy, symbols, start=None, end=None, cfg: PortfolioConfig | None = None,
             source: str = "oanda", exec_tf: str | None = None, trades_cache: dict | None = None):
    cfg = cfg or PortfolioConfig()
    trades = {}
    for s in symbols:
        if trades_cache is not None and s in trades_cache:
            trades[s] = trades_cache[s]
        else:
            trades[s] = symbol_trades(strategy, s, source, exec_tf)
            if trades_cache is not None:
                trades_cache[s] = trades[s]
    daily = {s: _bars(source, s, "D1")["close"] for s in symbols}
    res = run_portfolio(trades, conversion_table(source), daily, cfg, start, end)
    return res, summarize(res)
