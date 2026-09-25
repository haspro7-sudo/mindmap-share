"""index_trend_hold - long-biased holding of stock-index CFDs and gold with a regime
filter (research family ``index_trend_hold``).

Idea: collect the equity / gold risk premium by holding long, and step aside (flat)
when a slow trend / regime filter says the market is in a bear phase.  The position
size comes from the engine's 1%-risk sizing, so the initial stop is deliberately WIDE
(``stop_atr`` x ATR): it is a disaster stop that turns the 1% risk budget into a
sensible exposure (about 1% / (stop_atr * ATR%) of equity per instrument), not a
trading exit.  The trading exit is the regime filter flipping.

One class, ``IndexTrendHold``:

  regime filter (state computed on the CLOSE of bar t, bars <= t only)
    none       always long (buy-and-hold with a disaster stop)
    sma        close >  SMA(n)          (hysteresis: enter above SMA + band*ATR,
                                          exit below SMA - band*ATR)
    ema        close >  EMA(n)          (same hysteresis)
    mom        close >  close[mom_n bars ago]   (time-series momentum, 6-12 months)
    sma_mom    sma AND mom must both be bullish to enter; either one failing exits

  optional extra state conditions (entries require them, failing them exits)
    vol_max    ATR(20) / ATR(100) <  vol_max   (step aside in volatility spikes)
    dd_atr     close >  highest close(252) - dd_atr * ATR(100)
               (step aside after a deep drawdown from the 1-year high)

  rebalance    "daily":   the filter is evaluated at every daily close
               "monthly": the filter is evaluated only on the close of the FIRST
                          trading day of each calendar month and held for the month
                          (fewer whipsaws; uses no information beyond bar t)

  side         "long"        long or flat
               "long_short"  short when the filter is bearish (CFD carry makes shorts
                             expensive: they pay dividends + 2.5% markup)

  risk
    stop_atr   initial (disaster) stop distance = stop_atr * ATR(atr_n)  (always set)
    trail_atr  optional chandelier trail distance (0 = no trail)
    max_hold   close and immediately re-open every ``max_hold`` daily bars while the
               filter stays bullish ("re-size"): the new position is sized on the
               current balance and current ATR and pays the current year's carry.
               0 = hold until the filter flips or the stop is hit.
    warmup     no entries during the first ``warmup`` bars of a series, so every
               variant (incl. buy-and-hold) starts on the same date

No look-ahead: every quantity at bar t uses bars <= t; rolling highs exclude nothing
because they are compared with the same bar's close (a close cannot exceed the highest
close that includes it; the drawdown test uses the high INCLUDING bar t, which is
known at the close of bar t).  The engine executes decisions at the next execution
bar's open (01:00 server time for US indices after the rollover rule).

Source handling: signals use closes only, so they are identical on OANDA OHLC and the
close-only "pst" futures series.  pst bars carry a synthetic range that makes the
ATR about 1.5x the true ATR (median pst/OANDA ATR20 ratio 1.47-1.56 over US500,
NAS100, UK100, FRA40, JPN225, XAUUSD on the IS overlap 2005-2014), so on source ==
"pst" (and "fred") the ATR is divided by SYNTH_ATR_SCALE = 1.5 to keep stop
distances - and therefore exposure - comparable.  Data calibration on IS only.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .. import indicators as I
from .base import Strategy, empty_decisions

SYNTH_ATR_SCALE = 1.5
FILTERS = ("none", "sma", "ema", "mom", "sma_mom")


class IndexTrendHold(Strategy):
    name = "index_trend_hold"
    tf = "D1"

    def __init__(self, filter="sma", n=200, mom_n=252, band_atr=0.0, vol_max=0.0,
                 dd_atr=0.0, rebalance="daily", side="long", stop_atr=5.0, atr_n=20,
                 trail_atr=0.0, max_hold=0, warmup=260):
        if filter not in FILTERS:
            raise ValueError(filter)
        if rebalance not in ("daily", "monthly"):
            raise ValueError(rebalance)
        if side not in ("long", "long_short"):
            raise ValueError(side)
        self.filter = filter
        self.n = int(n)
        self.mom_n = int(mom_n)
        self.band_atr = float(band_atr)
        self.vol_max = float(vol_max)
        self.dd_atr = float(dd_atr)
        self.rebalance = rebalance
        self.side = side
        self.stop_atr = float(stop_atr)
        self.atr_n = int(atr_n)
        self.trail_atr = float(trail_atr)
        self.max_hold = int(max_hold)
        self.warmup = int(warmup)

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def _atr(b: pd.DataFrame, n: int, source: str) -> pd.Series:
        a = I.atr(b, n)
        return a / SYNTH_ATR_SCALE if source in ("pst", "fred") else a

    def _states(self, b: pd.DataFrame, src: str):
        """(bull_enter, bull_stay, bear_enter, bear_stay) boolean series.

        *_enter: condition to open a position; *_stay: condition to keep it.
        """
        c = b["close"]
        idx = b.index
        T = pd.Series(True, index=idx)
        be, bs, se, ss = T, T, T, T
        a_band = self._atr(b, 100, src)
        if self.filter in ("sma", "ema", "sma_mom"):
            ma = I.ema(c, self.n) if self.filter == "ema" else I.sma(c, self.n)
            band = self.band_atr * a_band
            be = be & (c > ma + band)
            bs = bs & (c > ma - band)
            se = se & (c < ma - band)
            ss = ss & (c < ma + band)
        if self.filter in ("mom", "sma_mom"):
            m = c / c.shift(self.mom_n) - 1.0
            be = be & (m > 0)
            bs = bs & (m > 0)
            se = se & (m < 0)
            ss = ss & (m < 0)
        if self.vol_max > 0:
            vr = I.atr(b, 20) / I.atr(b, 100)
            calm = vr < self.vol_max
            be, bs, se, ss = be & calm, bs & calm, se & calm, ss & calm
        if self.dd_atr > 0:
            hh = c.rolling(252, min_periods=252).max()
            ok = c > hh - self.dd_atr * a_band
            be, bs = be & ok, bs & ok
        if self.filter == "none":
            se = ss = pd.Series(False, index=idx)
        # NaN comparisons are False -> no position during indicator warm-up
        return be, bs, se, ss

    def _sample_monthly(self, s: pd.Series) -> pd.Series:
        """Hold the value observed on the first trading day of each month."""
        idx = s.index
        per = idx.to_period("M")
        first = np.r_[True, per[1:] != per[:-1]]
        out = s.astype(float).where(first)
        return out.ffill().fillna(0.0).astype(bool)

    # ---------------------------------------------------------------- decisions
    def decisions(self, ctx) -> pd.DataFrame:
        src = getattr(ctx, "source", "oanda")
        b = ctx.bars(self.tf)
        be, bs, se, ss = self._states(b, src)
        if self.rebalance == "monthly":
            be, bs, se, ss = (self._sample_monthly(x) for x in (be, bs, se, ss))
        live = pd.Series(np.arange(len(b)) >= self.warmup, index=b.index)
        a = self._atr(b, self.atr_n, src)
        d = empty_decisions(b.index)
        d["long_entry"] = (be & live).astype(bool)
        d["exit_long"] = (~bs).astype(bool)
        if self.side == "long_short":
            d["short_entry"] = (se & live).astype(bool)
            d["exit_short"] = (~ss).astype(bool)
        d["stop_dist"] = self.stop_atr * a
        if self.trail_atr > 0:
            d["trail_dist"] = self.trail_atr * a
        d["max_hold"] = self.max_hold
        return d
