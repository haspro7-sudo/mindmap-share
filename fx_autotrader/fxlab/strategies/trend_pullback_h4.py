"""Trend-pullback on H4 with a closed-D1 trend filter.

Idea: trade only in the direction of the daily trend and enter after a short-term
counter-move (pullback) on the 4-hour chart, betting that the higher-timeframe
trend resumes.  Everything is decided on CLOSED bars:

  * D1 trend state (+1 up / -1 down / 0 none) is computed on completed daily bars
    and mapped onto an H4 bar only if that daily bar had closed by the time the
    H4 bar closes (``align_closed``).  In MT5 terms: iClose/iMA on PERIOD_D1 with
    shift 1, evaluated at the open of the next H4 bar.
  * H4 indicators (RSI, EMA, ATR) use bars <= t; the engine executes at the next
    bar's open (or as a stop-entry order valid for the next H4 bar).

Trend filters (``trend``):
    price_ema   D1 close above / below EMA(trend_n)
    ema_slope   as price_ema and EMA(trend_n) higher / lower than slope_n days ago
    dual        EMA(trend_fast) above EMA(trend_n) and close above EMA(trend_fast)
                (mirror for shorts)

Pullback entries (``entry``), long side shown (shorts are the mirror image with
RSI thresholds 100 - rsi_lo):
    rsi_dip     H4 RSI(rsi_n) closes below rsi_lo            -> buy next open
    rsi_cross   H4 RSI crosses back up through rsi_lo         -> buy next open
    rsi_brk     RSI was below rsi_lo within the last setup_n bars -> buy-stop at the
                highest high of the last brk_n H4 bars (order valid for one H4 bar)
    ema_touch   H4 low touches EMA(pb_ema) and the bar closes above it -> buy next open

Exits: initial stop = stop_atr * ATR(atr_n) on H4 (always set), optional take
profit tp_r * stop, optional chandelier trail trail_atr * ATR, optional time stop
max_hold H4 bars, optional exit when the D1 trend is no longer in the trade's
direction (exit_flip), optional exit when RSI > exit_rsi (long) / < 100-exit_rsi.

Optional entry filters:
    adx_min      D1 ADX(adx_n) (Wilder, closed D1 bars) must be >= adx_min
    carry_align  only trade in the direction that EARNS the policy-rate differential,
                 using the PREVIOUS calendar year's rates (no trades while the lagged
                 year is outside the rate table, i.e. during 2005).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .. import indicators as I
from ..engine import TF_DURATION
from ..instruments import _RATE_YEARS, policy_rate
from .base import Strategy, empty_decisions


def align_closed(htf: pd.Series, htf_tf: str, ltf_index: pd.DatetimeIndex,
                 ltf_tf: str) -> np.ndarray:
    """Value of the last higher-timeframe bar that has CLOSED by the close of each
    lower-timeframe bar (both indexed by bar open time)."""
    htf_close = (htf.index + TF_DURATION[htf_tf]).values
    ltf_close = (ltf_index + TF_DURATION[ltf_tf]).values
    pos = np.searchsorted(htf_close, ltf_close, side="right") - 1
    vals = htf.to_numpy(dtype=float)
    out = np.full(len(ltf_index), np.nan)
    ok = pos >= 0
    out[ok] = vals[pos[ok]]
    return out


def d1_trend_state(d1: pd.DataFrame, trend: str, trend_n: int, trend_fast: int = 50,
                   slope_n: int = 5) -> pd.Series:
    """+1 / -1 / 0 trend state computed on completed D1 bars (NaN during warm-up)."""
    c = d1["close"]
    e = I.ema(c, trend_n)
    if trend == "price_ema":
        up, dn = c > e, c < e
        valid = e.notna()
    elif trend == "ema_slope":
        e0 = e.shift(slope_n)
        up = (c > e) & (e > e0)
        dn = (c < e) & (e < e0)
        valid = e0.notna()
    elif trend == "dual":
        f = I.ema(c, trend_fast)
        up = (f > e) & (c > f)
        dn = (f < e) & (c < f)
        valid = e.notna() & f.notna()
    else:
        raise ValueError(trend)
    st = up.astype(float) - dn.astype(float)
    return st.where(valid)


def lagged_rate_diff(inst, index: pd.DatetimeIndex) -> np.ndarray:
    """base - quote policy rate (%) of the PREVIOUS calendar year; NaN when that year
    is not in the rate table (so no carry information is ever taken from the future)."""
    years = index.year.to_numpy() - 1
    out = np.full(len(index), np.nan)
    for y in np.unique(years):
        if _RATE_YEARS[0] <= y <= _RATE_YEARS[-1]:
            out[years == y] = policy_rate(inst.base, int(y)) - policy_rate(inst.quote, int(y))
    return out


class TrendPullbackH4(Strategy):
    name = "trend_pullback_h4"

    def __init__(self, trend="ema_slope", trend_n=100, trend_fast=50, slope_n=5,
                 entry="rsi_cross", rsi_n=14, rsi_lo=40.0, setup_n=6, brk_n=3, pb_ema=20,
                 atr_n=14, stop_atr=2.0, tp_r=2.0, trail_atr=0.0, max_hold=0,
                 exit_flip=True, exit_rsi=0.0, adx_n=14, adx_min=0.0, carry_align=False,
                 tf="H4"):
        self.trend, self.trend_n, self.trend_fast, self.slope_n = trend, trend_n, trend_fast, slope_n
        self.entry, self.rsi_n, self.rsi_lo = entry, rsi_n, rsi_lo
        self.setup_n, self.brk_n, self.pb_ema = setup_n, brk_n, pb_ema
        self.atr_n, self.stop_atr, self.tp_r, self.trail_atr = atr_n, stop_atr, tp_r, trail_atr
        self.max_hold, self.exit_flip, self.exit_rsi, self.tf = max_hold, exit_flip, exit_rsi, tf
        self.adx_n, self.adx_min, self.carry_align = adx_n, adx_min, carry_align

    # ------------------------------------------------------------------ helpers
    def trend_on_signal_tf(self, ctx, b: pd.DataFrame) -> pd.Series:
        d1 = ctx.bars("D1")
        st = d1_trend_state(d1, self.trend, self.trend_n, self.trend_fast, self.slope_n)
        return pd.Series(align_closed(st, "D1", b.index, self.tf), index=b.index)

    def decisions(self, ctx) -> pd.DataFrame:
        b = ctx.bars(self.tf)
        tr = self.trend_on_signal_tf(ctx, b)
        up = (tr > 0).to_numpy()
        dn = (tr < 0).to_numpy()
        a = I.atr(b, self.atr_n)
        r = I.rsi(b["close"], self.rsi_n)
        lo, hi = float(self.rsi_lo), 100.0 - float(self.rsi_lo)
        d = empty_decisions(b.index)

        if self.entry == "rsi_dip":
            L = up & (r < lo).to_numpy()
            S = dn & (r > hi).to_numpy()
        elif self.entry == "rsi_cross":
            L = up & ((r.shift(1) < lo) & (r >= lo)).to_numpy()
            S = dn & ((r.shift(1) > hi) & (r <= hi)).to_numpy()
        elif self.entry == "rsi_brk":
            rmin = r.rolling(self.setup_n, min_periods=1).min()
            rmax = r.rolling(self.setup_n, min_periods=1).max()
            L = up & (rmin < lo).to_numpy()
            S = dn & (rmax > hi).to_numpy()
            # breakout of the pullback's high / low (bars <= t), order valid one bar
            d["long_stop_px"] = np.where(L, b["high"].rolling(self.brk_n).max(), np.nan)
            d["short_stop_px"] = np.where(S, b["low"].rolling(self.brk_n).min(), np.nan)
        elif self.entry == "ema_touch":
            e = I.ema(b["close"], self.pb_ema)
            L = up & ((b["low"] <= e) & (b["close"] > e)).to_numpy()
            S = dn & ((b["high"] >= e) & (b["close"] < e)).to_numpy()
        else:
            raise ValueError(self.entry)

        if self.adx_min and self.adx_min > 0:
            ad = pd.Series(align_closed(I.adx(ctx.bars("D1"), self.adx_n), "D1", b.index,
                                        self.tf), index=b.index)
            strong = (ad >= self.adx_min).to_numpy()
            L = L & strong
            S = S & strong
        if self.carry_align:
            diff = lagged_rate_diff(ctx.inst, b.index)
            L = L & (diff > 0)
            S = S & (diff < 0)

        d["long_entry"] = L
        d["short_entry"] = S
        if self.entry == "rsi_brk":
            d.loc[~L, "long_stop_px"] = np.nan
            d.loc[~S, "short_stop_px"] = np.nan
        stop = self.stop_atr * a
        d["stop_dist"] = stop
        if self.tp_r and self.tp_r > 0:
            d["tp_dist"] = self.tp_r * stop
        if self.trail_atr and self.trail_atr > 0:
            d["trail_dist"] = self.trail_atr * a
        d["max_hold"] = int(self.max_hold or 0)

        xl = np.zeros(len(b), bool)
        xs = np.zeros(len(b), bool)
        if self.exit_flip:
            xl |= ~up
            xs |= ~dn
        if self.exit_rsi and self.exit_rsi > 0:
            xl |= (r > self.exit_rsi).to_numpy()
            xs |= (r < 100.0 - self.exit_rsi).to_numpy()
        d["exit_long"] = xl
        d["exit_short"] = xs
        return d
