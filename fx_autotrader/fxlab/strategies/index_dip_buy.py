"""Index dip buying: short-term mean reversion on stock-index CFDs in the direction
of the long-term trend (Connors-style RSI(2) / IBS / N-down-closes effects).

Idea: equity indices in a long-term uptrend tend to bounce after short, sharp
pullbacks (a well documented effect in the S&P 500 and other cash indices).  Buy
at the next open after an oversold CLOSE, only while the index trades above its
long moving average; exit on a close back above a short moving average (or an
oscillator recovery / first up close / time stop).  A protective stop (multiple of
ATR) is always placed at entry.  Optional mirror-image shorts: sell an overbought
close while the index is BELOW its long moving average.

Everything is decided on CLOSED signal bars and executed by the engine at the open
of the next execution bar (01:00 server time for D1 US indices, i.e. just after the
New York 17:00 close; the next European session open for UK100/FRA40):

Entry (long side; shorts are the mirror image when ``shorts=True``):
    rsi     RSI(rsi_n) < rsi_lo                                  (MT5 iRSI)
    down    at least down_n consecutive lower closes (close < previous close)
    ibs     internal bar strength (close - low) / (high - low) < ibs_lo
    bb      close < lower Bollinger band (bb_n, bb_k)             (MT5 iBands)
    nlow    close is the lowest close of the last nlow_n bars (incl. this bar)
  combined with (all computed on the same closed bar)
    trend filter  close > SMA(trend_n) of D1 closes (trend_n=0: off).  For H4/H1
                  signal bars the D1 value is taken from the last D1 bar that has
                  fully CLOSED by the close of the signal bar (MT5: iMA/iClose on
                  PERIOD_D1 with shift 1 during the day).

Exit (long side):
    sma     close > SMA(exit_n)
    rsi     RSI(rsi_n) > exit_rsi
    hi      close > previous bar's high
    up      close > previous close (first up close)
    none    stop / time stop only
  always:   initial stop = stop_atr * ATR(atr_n) (MT5 iATR, SMA of true range) on the
            signal timeframe (atr_tf="sig") or on the last closed D1 bar ("D1");
            time stop after max_hold signal bars (0 = none).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .. import indicators as I
from ..engine import TF_DURATION
from .base import Strategy, empty_decisions


def align_closed(htf: pd.Series, htf_tf: str, ltf_index: pd.DatetimeIndex,
                 ltf_tf: str) -> np.ndarray:
    """Value of the last higher-timeframe bar that has CLOSED by the close of each
    lower-timeframe bar (both indexed by bar open time).  No look-ahead: a D1 bar
    opening at 00:00 is only visible to lower-TF bars that close at/after 24:00."""
    htf_close = (htf.index + TF_DURATION[htf_tf]).values
    ltf_close = (ltf_index + TF_DURATION[ltf_tf]).values
    pos = np.searchsorted(htf_close, ltf_close, side="right") - 1
    vals = htf.to_numpy(dtype=float)
    out = np.full(len(ltf_index), np.nan)
    ok = pos >= 0
    out[ok] = vals[pos[ok]]
    return out


def down_run(close: pd.Series) -> pd.Series:
    """Number of consecutive closes below the previous close ending at each bar."""
    dn = (close < close.shift(1)).astype(int)
    grp = (dn == 0).cumsum()
    return dn.groupby(grp).cumsum()


def up_run(close: pd.Series) -> pd.Series:
    up = (close > close.shift(1)).astype(int)
    grp = (up == 0).cumsum()
    return up.groupby(grp).cumsum()


class IndexDipBuy(Strategy):
    name = "index_dip_buy"

    def __init__(self, tf="D1", entry="rsi", rsi_n=2, rsi_lo=10.0, down_n=3, ibs_lo=0.2,
                 bb_n=20, bb_k=2.0, nlow_n=7, trend_n=200, exit="sma", exit_n=5,
                 exit_rsi=70.0, max_hold=10, atr_n=20, atr_tf="sig", stop_atr=5.0,
                 shorts=False, longs=True):
        self.tf, self.entry = tf, entry
        self.rsi_n, self.rsi_lo, self.down_n, self.ibs_lo = rsi_n, rsi_lo, down_n, ibs_lo
        self.bb_n, self.bb_k, self.nlow_n = bb_n, bb_k, nlow_n
        self.trend_n = trend_n
        self.exit, self.exit_n, self.exit_rsi, self.max_hold = exit, exit_n, exit_rsi, max_hold
        self.atr_n, self.atr_tf, self.stop_atr = atr_n, atr_tf, stop_atr
        self.shorts, self.longs = shorts, longs

    # ------------------------------------------------------------------ signals
    def _oversold(self, b: pd.DataFrame, r: pd.Series | None) -> tuple[pd.Series, pd.Series]:
        """(long_signal, short_signal) of the chosen entry family on bar closes."""
        c = b["close"]
        e = self.entry
        if e == "rsi":
            return r < self.rsi_lo, r > 100.0 - self.rsi_lo
        if e == "down":
            return down_run(c) >= self.down_n, up_run(c) >= self.down_n
        if e == "ibs":
            rng = (b["high"] - b["low"])
            ibs = ((c - b["low"]) / rng.where(rng > 0)).fillna(0.5)
            return ibs < self.ibs_lo, ibs > 1.0 - self.ibs_lo
        if e == "bb":
            lo, _, hi = I.bollinger(c, self.bb_n, self.bb_k)
            return c < lo, c > hi
        if e == "nlow":
            return (c <= c.rolling(self.nlow_n, min_periods=self.nlow_n).min(),
                    c >= c.rolling(self.nlow_n, min_periods=self.nlow_n).max())
        raise ValueError(e)

    def _exits(self, b: pd.DataFrame, r: pd.Series | None) -> tuple[pd.Series, pd.Series]:
        c = b["close"]
        x = self.exit
        if x == "sma":
            m = I.sma(c, self.exit_n)
            return c > m, c < m
        if x == "rsi":
            return r > self.exit_rsi, r < 100.0 - self.exit_rsi
        if x == "hi":
            return c > b["high"].shift(1), c < b["low"].shift(1)
        if x == "up":
            return c > c.shift(1), c < c.shift(1)
        if x == "none":
            f = pd.Series(False, index=b.index)
            return f, f
        raise ValueError(x)

    def decisions(self, ctx) -> pd.DataFrame:
        b = ctx.bars(self.tf)
        c = b["close"]
        need_rsi = self.entry == "rsi" or self.exit == "rsi"
        r = I.rsi(c, self.rsi_n) if need_rsi else None
        lsig, ssig = self._oversold(b, r)
        xl, xs = self._exits(b, r)

        # long-term regime from D1 closes (closed D1 bars only)
        if self.trend_n and self.trend_n > 0:
            d1 = ctx.bars("D1")["close"] if self.tf != "D1" else c
            above = (d1 > I.sma(d1, self.trend_n)).astype(float).where(
                I.sma(d1, self.trend_n).notna())
            if self.tf == "D1":
                up_reg = above
            else:
                up_reg = pd.Series(align_closed(above, "D1", b.index, self.tf), index=b.index)
            up = up_reg == 1.0
            dn = up_reg == 0.0
        else:
            up = pd.Series(True, index=b.index)
            dn = pd.Series(True, index=b.index)

        if self.atr_tf == "D1" and self.tf != "D1":
            d1b = ctx.bars("D1")
            a = pd.Series(align_closed(I.atr(d1b, self.atr_n), "D1", b.index, self.tf),
                          index=b.index)
        else:
            a = I.atr(b, self.atr_n)

        d = empty_decisions(b.index)
        d["long_entry"] = (lsig & up).fillna(False) if self.longs else False
        d["short_entry"] = (ssig & dn).fillna(False) if self.shorts else False
        d["exit_long"] = xl.fillna(False)
        d["exit_short"] = xs.fillna(False)
        d["stop_dist"] = self.stop_atr * a
        d["max_hold"] = int(self.max_hold)
        return d
