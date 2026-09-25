"""trend_d1 - daily trend following on FX + gold (research family ``trend_d1``).

One configurable class, ``TrendD1``, covers the classic variants:

  signal
    donchian     close breaks the highest / lowest CLOSE of the previous ``n`` bars
    keltner      close beyond EMA(n) +- kc_mult * ATR(atr_n)
    ema          state = sign(EMA(fast) - EMA(n))            (always-in style)
    tsmom        state = sign(close / close[n] - 1)          (time-series momentum)
    ens_tsmom    vote over sign(close / close[L] - 1) for L in ``lookbacks``
    ens_ema      vote over sign(EMA(L/4) - EMA(L))  for L in ``lookbacks``

  exit
    channel      donchian: close through the opposite ``exit_n`` close channel
                 keltner : close back through EMA(n) (the mid line)
    signal       state systems: state no longer agrees with the position
                 donchian/keltner: only the opposite entry (stop-and-reverse)
    chandelier   no signal exit; trailing stop = highest high (lowest low) since
                 entry -/+ trail_atr * ATR  (plus the opposite-entry reversal)
    signal+chandelier  both

  filters (entries only; exits are never filtered)
    adx_min      ADX(adx_n) >= adx_min
    trend_n      long only if close > SMA(trend_n), short only if close < SMA(trend_n)
    vol_filter   "expanding": ATR(20) > ATR(100);  "contracting": ATR(20) < ATR(100)

Every trade gets an initial stop of ``stop_atr * ATR(atr_n)`` (MT5 iATR = SMA of TR).

No look-ahead: every quantity for bar t uses bars <= t; channels use ``.shift(1)``
so the current bar is excluded.  The engine executes at the next execution bar.

Execution timing: on the OANDA source the decision frame is stamped
``exec_delay_h`` hours later, so a signal computed at the D1 close (17:00 New York
= 00:00 server) is executed at the 01:00 server-time H1 open instead of 00:00.
This only DELAYS execution (never uses newer data for the decision) and keeps the
EA away from the rollover spread spike.  Friday's signal executes Monday 01:00.

Source invariance: all signals use closes only, so they are identical on OANDA
OHLC and FRED close-only data.  FRED bars have no real high/low, which makes the
close-only ATR about half the true ATR (median ratio 2.06 over 15 pairs on the IS
overlap 2005-06..2014-12, range 1.95-2.17).  On source == "fred" the ATR is
therefore multiplied by FRED_ATR_SCALE = 2.0 so stop / trail distances are
comparable in price terms.  (Data calibration measured on IS only; not tuned.)
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .. import indicators as I
from .base import Strategy, empty_decisions

FRED_ATR_SCALE = 2.0
STATE_SIGNALS = ("ema", "tsmom", "ens_tsmom", "ens_ema")
BREAKOUT_SIGNALS = ("donchian", "keltner")


class TrendD1(Strategy):
    name = "trend_d1"
    tf = "D1"

    def __init__(self, signal="donchian", n=55, fast=0, kc_mult=2.0, lookbacks=(),
                 vote="majority", exit="channel", exit_n=20, trail_atr=0.0, stop_atr=3.0,
                 atr_n=20, adx_min=0.0, adx_n=14, trend_n=0, vol_filter="none",
                 exec_delay_h=1):
        self.signal = signal
        self.n = int(n)
        self.fast = int(fast)
        self.kc_mult = float(kc_mult)
        self.lookbacks = tuple(int(x) for x in lookbacks)
        self.vote = vote
        self.exit = exit
        self.exit_n = int(exit_n)
        self.trail_atr = float(trail_atr)
        self.stop_atr = float(stop_atr)
        self.atr_n = int(atr_n)
        self.adx_min = float(adx_min)
        self.adx_n = int(adx_n)
        self.trend_n = int(trend_n)
        self.vol_filter = vol_filter
        self.exec_delay_h = int(exec_delay_h)
        if signal not in STATE_SIGNALS + BREAKOUT_SIGNALS:
            raise ValueError(signal)
        if exit not in ("channel", "signal", "chandelier", "signal+chandelier"):
            raise ValueError(exit)

    def params(self) -> dict:
        p = super().params()
        p["lookbacks"] = list(self.lookbacks)
        return p

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def _atr(b: pd.DataFrame, n: int, source: str) -> pd.Series:
        a = I.atr(b, n)
        return a * FRED_ATR_SCALE if source == "fred" else a

    def _state(self, c: pd.Series) -> pd.Series:
        """Directional state in {-1, 0, +1} (or a vote score in [-1, 1])."""
        if self.signal == "ema":
            f = self.fast or max(2, self.n // 4)
            return np.sign(I.ema(c, f) - I.ema(c, self.n))
        if self.signal == "tsmom":
            return np.sign(c / c.shift(self.n) - 1.0)
        lbs = self.lookbacks or (63, 126, 252)
        if self.signal == "ens_tsmom":
            votes = [np.sign(c / c.shift(L) - 1.0) for L in lbs]
        else:  # ens_ema
            votes = [np.sign(I.ema(c, max(2, L // 4)) - I.ema(c, L)) for L in lbs]
        v = pd.concat(votes, axis=1)
        return v.mean(axis=1, skipna=False)

    # ---------------------------------------------------------------- decisions
    def decisions(self, ctx) -> pd.DataFrame:
        src = getattr(ctx, "source", "oanda")
        b = ctx.bars(self.tf)
        c = b["close"]
        a = self._atr(b, self.atr_n, src)
        d = empty_decisions(b.index)

        if self.signal in STATE_SIGNALS:
            s = self._state(c)
            if self.signal in ("ens_tsmom", "ens_ema") and self.vote == "unanimous":
                long_in, short_in = s >= 1.0 - 1e-9, s <= -1.0 + 1e-9
            else:
                long_in, short_in = s > 0, s < 0
            long_out, short_out = s < 0, s > 0
            if self.signal in ("ema", "tsmom"):
                long_out, short_out = s <= 0, s >= 0
            sig_exit_long, sig_exit_short = long_out, short_out
        elif self.signal == "donchian":
            hi = c.rolling(self.n, min_periods=self.n).max().shift(1)
            lo = c.rolling(self.n, min_periods=self.n).min().shift(1)
            long_in, short_in = c > hi, c < lo
            xhi = c.rolling(self.exit_n, min_periods=self.exit_n).max().shift(1)
            xlo = c.rolling(self.exit_n, min_periods=self.exit_n).min().shift(1)
            sig_exit_long, sig_exit_short = c < xlo, c > xhi
        else:  # keltner
            mid = I.ema(c, self.n)
            long_in = c > mid + self.kc_mult * a
            short_in = c < mid - self.kc_mult * a
            sig_exit_long, sig_exit_short = c < mid, c > mid

        # ---- entry filters
        ok = pd.Series(True, index=b.index)
        if self.adx_min > 0:
            ok &= I.adx(b, self.adx_n) >= self.adx_min
        if self.vol_filter != "none":
            af, asl = I.atr(b, 20), I.atr(b, 100)
            ok &= (af > asl) if self.vol_filter == "expanding" else (af < asl)
        lf = sf = ok
        if self.trend_n > 0:
            ma = I.sma(c, self.trend_n)
            lf = ok & (c > ma)
            sf = ok & (c < ma)

        d["long_entry"] = (long_in.fillna(False) & lf).astype(bool)
        d["short_entry"] = (short_in.fillna(False) & sf).astype(bool)

        # ---- exits
        use_sig = self.exit in ("channel", "signal", "signal+chandelier")
        if self.signal in BREAKOUT_SIGNALS and self.exit == "signal":
            use_sig = False  # pure stop-and-reverse
        if use_sig:
            d["exit_long"] = sig_exit_long.fillna(False).astype(bool)
            d["exit_short"] = sig_exit_short.fillna(False).astype(bool)
        if self.exit in ("chandelier", "signal+chandelier"):
            d["trail_dist"] = self.trail_atr * a
        d["stop_dist"] = self.stop_atr * a

        if src == "oanda" and self.exec_delay_h:
            # Friday's bar closes into the weekend: push its execution to Monday 01:00
            # as well (Monday 00:00 is the weekly open with the widest spreads).
            shift = pd.to_timedelta(np.where(d.index.dayofweek == 4, 2, 0), unit="D")
            d.index = d.index + shift + pd.Timedelta(hours=self.exec_delay_h)
        return d
