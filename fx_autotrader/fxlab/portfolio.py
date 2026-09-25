"""Run several strategies side by side on one JPY account.

    books = [Book("mr", MeanReversion(...), ["USDJPY", ...], risk_mult=1.0), ...]
    res, summary = run_books(books, start, end, cfg)

Each (strategy, symbol) pair is its own book ("tag|SYMBOL"), so two strategies can
hold the same symbol at once (Titan FX MT5 accounts are hedging accounts; the EA
uses one magic number per strategy).  Risk per trade = the account risk schedule
x the book's risk_mult.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace

import pandas as pd

from . import backtest as B
from .engine import PortfolioConfig, run_portfolio
from .metrics import summarize


@dataclass
class Book:
    tag: str
    strategy: object
    symbols: list
    risk_mult: float = 1.0


def book_trades(books, source="oanda", cache: dict | None = None) -> dict:
    trades = {}
    for bk in books:
        for s in bk.symbols:
            key = f"{bk.tag}|{s}"
            if cache is not None and key in cache:
                trades[key] = cache[key]
                continue
            trades[key] = B.symbol_trades(bk.strategy, s, source)
            if cache is not None:
                cache[key] = trades[key]
    return trades


def run_books(books, start=None, end=None, cfg: PortfolioConfig | None = None,
              source="oanda", cache: dict | None = None):
    cfg = cfg or PortfolioConfig()
    cfg = replace(cfg, book_risk={**cfg.book_risk, **{b.tag: b.risk_mult for b in books}})
    if source == "pst" and cfg.costs.carry_mode != "futures":
        cfg = replace(cfg, costs=replace(cfg.costs, carry_mode="futures"))
    trades = book_trades(books, source, cache)
    syms = sorted({s for b in books for s in b.symbols})
    daily = {s: B._bars(source, s, "D1")["close"] for s in syms}
    res = run_portfolio(trades, B.conversion_table(source), daily, cfg, start, end)
    return res, summarize(res)
