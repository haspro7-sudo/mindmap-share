"""Instrument specifications and the Titan FX cost model.

All costs are expressed so they can be applied to *mid* prices (the research data
are OANDA mid quotes):

  * spread_pips      typical raw spread on a Titan FX Zero Blade account
  * commission       Blade commission per 1.00 lot, round turn, JPY account:
                     720 JPY for FX, 72 JPY for metals/CFDs (docs/TITANFX_CONDITIONS.md)
  * slip_pips        adverse slippage per fill on market orders
  * stop_slip_pips   additional slippage when a stop order (stop-loss or stop-entry) fills

Numbers are deliberately on the conservative side of Titan FX's published
averages (see docs/TITANFX_CONDITIONS.md) and can be overridden per backtest with
``CostModel(multiplier=2.0)`` for stress tests.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class Instrument:
    symbol: str
    base: str
    quote: str
    pip: float            # price increment of one pip
    contract: float       # units per 1.00 lot
    spread_pips: float    # typical raw spread (Blade)
    slip_pips: float      # adverse slippage per fill
    lot_step: float = 0.01
    min_lot: float = 0.01
    max_lot: float = 100.0
    commission_jpy_rt: float | None = None  # None -> CostModel default (FX)
    stop_slip_pips: float = 0.3
    # Crypto CFDs: spread/slip/stop-slip are in basis points of price instead of pips,
    # commission in bps of notional per round trip, and a financing charge per server
    # day held (both directions).  Only fxlab.scalp understands these instruments.
    cost_in_bps: bool = False
    hour_spread_mult: bool = True          # apply the FX rollover/Asia spread multipliers
    commission_bps_rt: float = 0.0
    carry_bps_per_day: float = 0.0


_I = Instrument
INSTRUMENTS: dict[str, Instrument] = {i.symbol: i for i in [
    _I("USDJPY", "USD", "JPY", 0.01, 100_000, 0.4, 0.2),
    _I("EURUSD", "EUR", "USD", 0.0001, 100_000, 0.3, 0.2),
    _I("GBPUSD", "GBP", "USD", 0.0001, 100_000, 0.6, 0.3),
    _I("AUDUSD", "AUD", "USD", 0.0001, 100_000, 0.6, 0.3),
    _I("USDCAD", "USD", "CAD", 0.0001, 100_000, 0.7, 0.3),
    _I("EURJPY", "EUR", "JPY", 0.01, 100_000, 0.8, 0.3),
    _I("GBPJPY", "GBP", "JPY", 0.01, 100_000, 1.4, 0.4),
    _I("AUDJPY", "AUD", "JPY", 0.01, 100_000, 0.9, 0.3),
    _I("CADJPY", "CAD", "JPY", 0.01, 100_000, 1.2, 0.4),
    _I("EURGBP", "EUR", "GBP", 0.0001, 100_000, 0.7, 0.3),
    _I("EURAUD", "EUR", "AUD", 0.0001, 100_000, 1.2, 0.4),
    _I("GBPAUD", "GBP", "AUD", 0.0001, 100_000, 1.6, 0.5),
    _I("EURCAD", "EUR", "CAD", 0.0001, 100_000, 1.3, 0.4),
    _I("AUDCAD", "AUD", "CAD", 0.0001, 100_000, 1.2, 0.4),
    _I("GBPCAD", "GBP", "CAD", 0.0001, 100_000, 2.0, 0.5),
    # Gold: 1 lot = 100 oz, "pip" = 0.01 USD, spread ~ 12-20 cents on Blade
    _I("XAUUSD", "XAU", "USD", 0.01, 100, 18.0, 5.0, max_lot=50.0, commission_jpy_rt=72.0,
       stop_slip_pips=7.5),
    # Stock-index CFDs (Titan FX names).  pip = 1 index point, contract = 1 unit per lot
    # (check the real contract size / min lot in the MT5 specification before trading).
    # base = pseudo-currency whose "rate" is the index dividend yield (see _RATES).
    _I("US500", "SPX", "USD", 1.0, 1, 0.6, 0.3, lot_step=0.1, min_lot=0.1,
       commission_jpy_rt=72.0, stop_slip_pips=0.5),
    _I("NAS100", "NDX", "USD", 1.0, 1, 1.5, 0.5, lot_step=0.1, min_lot=0.1,
       commission_jpy_rt=72.0, stop_slip_pips=1.5),
    _I("US2000", "RTY", "USD", 1.0, 1, 0.5, 0.3, lot_step=0.1, min_lot=0.1,
       commission_jpy_rt=72.0, stop_slip_pips=0.5),
    _I("JPN225", "NKY", "JPY", 1.0, 1, 10.0, 3.0, lot_step=0.1, min_lot=0.1,
       commission_jpy_rt=72.0, stop_slip_pips=10.0),
    _I("UK100", "UKX", "GBP", 1.0, 1, 1.5, 0.5, lot_step=0.1, min_lot=0.1,
       commission_jpy_rt=72.0, stop_slip_pips=1.5),
    _I("FRA40", "CAC", "EUR", 1.0, 1, 1.5, 0.5, lot_step=0.1, min_lot=0.1,
       commission_jpy_rt=72.0, stop_slip_pips=1.5),
    _I("AUS200", "ASX", "AUD", 1.0, 1, 2.0, 1.0, lot_step=0.1, min_lot=0.1,
       commission_jpy_rt=72.0, stop_slip_pips=2.0),
    # Bitcoin CFD (Bitstamp BTC/USD M1 data; fxlab.scalp only).  pip = 1 USD, 1 lot = 1 BTC.
    # Costs in bps of price: spread 4, slip 1 per fill, extra 2 on stops, no commission,
    # financing 5 bps per day held (~18%/yr).  Check the live Titan FX quote/swap table.
    _I("BTCUSD", "BTC", "USD", 1.0, 1, 4.0, 1.0, min_lot=0.01, max_lot=10.0,
       commission_jpy_rt=0.0, stop_slip_pips=2.0, cost_in_bps=True, hour_spread_mult=False,
       carry_bps_per_day=5.0),
    # FRED-only pairs (daily out-of-sample checks)
    _I("NZDUSD", "NZD", "USD", 0.0001, 100_000, 0.8, 0.3),
    _I("USDCHF", "USD", "CHF", 0.0001, 100_000, 0.6, 0.3),
]}

# Approximate annual-average short-term policy rates (%), used to model swap.
# Sources: Fed/ECB/BoJ/BoE/RBA/BoC policy-rate histories; 2025-26 are estimates.
_RATES = {
    #       2005 06   07   08   09   10   11   12   13   14   15    16    17    18    19    20    21    22   23   24   25   26
    "USD": [3.2, 5.0, 5.0, 1.9, 0.2, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.4, 1.0, 1.8, 2.2, 0.4, 0.1, 1.7, 5.0, 5.1, 4.2, 3.6],
    "EUR": [2.1, 2.8, 3.8, 3.9, 0.7, 0.4, 0.9, 0.2, 0.1, 0.1, -0.1, -0.3, -0.4, -0.4, -0.4, -0.5, -0.6, 0.0, 3.2, 3.6, 2.2, 2.0],
    "JPY": [0.0, 0.2, 0.5, 0.4, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, -0.1, -0.1, -0.1, -0.1, -0.1, -0.1, -0.1, -0.1, 0.1, 0.5, 0.8],
    "GBP": [4.7, 4.6, 5.5, 4.7, 0.6, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.4, 0.3, 0.6, 0.8, 0.2, 0.1, 1.5, 4.7, 5.1, 4.3, 3.8],
    "AUD": [5.5, 5.8, 6.4, 6.7, 3.3, 4.4, 4.7, 3.7, 2.8, 2.5, 2.1, 1.6, 1.5, 1.5, 1.1, 0.3, 0.1, 1.3, 3.9, 4.4, 3.9, 3.6],
    "CAD": [2.7, 4.0, 4.3, 3.0, 0.4, 0.6, 1.0, 1.0, 1.0, 1.0, 0.6, 0.5, 0.7, 1.4, 1.8, 0.4, 0.3, 2.0, 4.7, 4.4, 2.8, 2.4],
    "NZD": [6.9, 7.2, 7.9, 7.5, 2.8, 2.7, 2.5, 2.5, 2.5, 3.2, 3.0, 2.1, 1.8, 1.8, 1.3, 0.3, 0.4, 2.9, 5.4, 5.3, 3.6, 2.8],
    "CHF": [0.8, 1.4, 2.4, 2.1, 0.3, 0.3, 0.1, 0.0, 0.0, 0.0, -0.7, -0.7, -0.7, -0.7, -0.7, -0.7, -0.7, 0.2, 1.6, 1.3, 0.2, 0.0],
    "XAU": [0.0] * 22,
    # index dividend yields (%), used as the "base rate" of index CFDs
    "SPX": [1.8, 1.8, 1.9, 2.4, 2.2, 1.9, 2.0, 2.1, 2.0, 1.9, 2.1, 2.1, 1.9, 2.0, 1.9, 1.7, 1.3, 1.6, 1.5, 1.3, 1.2, 1.2],
    "NDX": [0.5, 0.6, 0.7, 1.0, 1.0, 0.9, 1.0, 1.1, 1.1, 1.1, 1.2, 1.2, 1.0, 1.0, 0.9, 0.7, 0.6, 0.8, 0.8, 0.7, 0.7, 0.7],
    "RTY": [1.2, 1.2, 1.3, 1.7, 1.5, 1.2, 1.4, 1.5, 1.3, 1.3, 1.5, 1.5, 1.3, 1.4, 1.4, 1.2, 1.0, 1.4, 1.4, 1.3, 1.3, 1.3],
    "NKY": [1.0, 1.1, 1.3, 2.0, 1.6, 1.8, 2.0, 2.0, 1.6, 1.6, 1.6, 1.8, 1.7, 2.0, 2.0, 1.8, 1.7, 2.0, 1.9, 1.7, 1.7, 1.7],
    "UKX": [3.2, 3.1, 3.3, 4.5, 3.9, 3.3, 3.6, 3.7, 3.4, 3.5, 3.9, 3.8, 3.7, 4.2, 4.4, 3.6, 3.5, 3.7, 3.8, 3.8, 3.6, 3.5],
    "CAC": [2.8, 2.9, 3.2, 4.5, 3.8, 3.4, 4.0, 3.8, 3.2, 3.2, 3.2, 3.4, 3.1, 3.4, 3.2, 2.2, 2.3, 2.9, 3.0, 3.1, 3.1, 3.1],
    "ASX": [4.0, 4.0, 4.0, 5.3, 4.4, 4.2, 4.8, 4.9, 4.3, 4.4, 4.6, 4.4, 4.2, 4.4, 4.2, 3.4, 3.3, 4.1, 4.0, 3.7, 3.6, 3.6],
}
_RATE_YEARS = list(range(2005, 2027))


def policy_rate(ccy: str, year: int) -> float:
    """Annual policy rate in percent (clamped to the table's year range)."""
    y = min(max(year, _RATE_YEARS[0]), _RATE_YEARS[-1])
    return _RATES[ccy][y - _RATE_YEARS[0]]


@dataclass(frozen=True)
class CostModel:
    """Titan FX Zero Blade style costs.  multiplier scales spread, slippage, commission
    and the broker's swap markup (not the interest-rate differential itself)."""
    commission_jpy_per_lot_rt: float = 720.0     # FX, JPY account (USD 3.5/side on USD accounts)
    swap_markup_pct: float = 2.5                 # broker markup on each side of the carry
    multiplier: float = 1.0                      # (calibrated on a July 2026 USDJPY swap quote)
    stop_slip_scale: float = 1.0                 # scales Instrument.stop_slip_pips
    use_swap: bool = True
    carry_mode: str = "spot"                     # "futures": prices already contain carry

    def stressed(self, m: float) -> "CostModel":
        return replace(self, multiplier=m)

    def half_spread_plus_slip(self, inst: Instrument) -> float:
        """Adverse price move per fill (price units)."""
        return (inst.spread_pips / 2.0 + inst.slip_pips) * inst.pip * self.multiplier

    def stop_slip(self, inst: Instrument) -> float:
        """Extra adverse move when a stop order fills (price units)."""
        return inst.stop_slip_pips * inst.pip * self.stop_slip_scale * self.multiplier

    def commission_for(self, inst: Instrument) -> float:
        """JPY per 1.00 lot round turn."""
        c = inst.commission_jpy_rt if inst.commission_jpy_rt is not None \
            else self.commission_jpy_per_lot_rt
        return c * self.multiplier

    def swap_rate_annual(self, inst: Instrument, direction: int, year: int) -> float:
        """Annual carry (fraction) earned (+) or paid (-) for a position of `direction`."""
        if self.carry_mode == "futures":
            return -self.swap_markup_pct * self.multiplier / 100.0
        diff = (policy_rate(inst.base, year) - policy_rate(inst.quote, year)) / 100.0
        return direction * diff - self.swap_markup_pct * self.multiplier / 100.0


def quote_to_jpy_symbol(quote: str) -> str | None:
    """Symbol whose price converts one unit of `quote` into JPY (None if quote is JPY)."""
    if quote == "JPY":
        return None
    return {"USD": "USDJPY", "GBP": "GBPJPY", "AUD": "AUDJPY", "CAD": "CADJPY",
            "EUR": "EURJPY", "NZD": "NZDJPY", "CHF": "CHFJPY"}[quote]
