"""Intraday session breakout / false-breakout fade on H1 bars.

All times are broker SERVER time (New York + 7h, bars labelled by OPEN time):
    Tokyo session           ~02:00-09:00   (09:00-16:00 JST in winter)
    Frankfurt / London open  09:00 / 10:00
    New York open            15:00          (08:00 NY)
    London close             18:00
    rollover                 00:00          (never held: every trade closes the same day)

Each server day the strategy measures a RANGE = highest high / lowest low of the H1
bars whose open hour is in [range_start, range_end).  The range is complete when
the bar starting at range_end-1 closes, i.e. at range_end:00, and only then are
orders placed (decisions use bars <= t; the engine acts at the next bar's open).

mode="breakout"
    From range_end:00 until entry_end:00 a buy-stop is kept at  range_high + buffer
    and a sell-stop at  range_low - buffer  (re-issued every H1 bar, so in MT5 terms
    one pending order per side with expiry entry_end:00).  Each side can fire at
    most once per day; with ``oco`` the first fill cancels the other side for the
    rest of the day.  Stop at entry is always set:
        stop_mode="range":  stop_frac * range_width + buffer from the entry price
                             (stop_frac=1 -> opposite side of the range)
        stop_mode="atr":    stop_atr * ATR(atr_n) of CLOSED D1 bars
    Optional take profit tp_r * stop, optional time stop max_hold (H1 bars), and a
    hard exit at the open of the exit_hour bar (same server day).

mode="fade"   (false breakout)
    After price has traded beyond range_high + buffer during the entry window, the
    first H1 bar that CLOSES back inside the range (close < range_high) triggers a
    SHORT at the next bar's open (mirror for the low side).  Stop above the highest
    high since range_end (+ fade_stop_buf * D1 ATR), take profit at the opposite
    side of the range (tp_mode="range"), tp_r * stop, or none; same daily exit.
    At most one fade per side per day (with oco: one fade per day).

Optional filters (all from closed data):
    min_width_atr / max_width_atr   range width relative to D1 ATR(atr_n)
    trend_n > 0                     trade only in the direction of the closed D1
                                    close vs EMA(trend_n)
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
    lower-timeframe bar (both indexed by bar open time)."""
    htf_close = (htf.index + TF_DURATION[htf_tf]).values
    ltf_close = (ltf_index + TF_DURATION[ltf_tf]).values
    pos = np.searchsorted(htf_close, ltf_close, side="right") - 1
    vals = htf.to_numpy(dtype=float)
    out = np.full(len(ltf_index), np.nan)
    ok = pos >= 0
    out[ok] = vals[pos[ok]]
    return out


class SessionBreakout(Strategy):
    name = "session_breakout"
    tf = "H1"

    def __init__(self, mode="breakout", range_start=2, range_end=9, entry_end=14,
                 exit_hour=22, stop_mode="range", stop_frac=1.0, stop_atr=0.5, atr_n=14,
                 tp_r=0.0, tp_mode="none", buffer_atr=0.0, min_width_atr=0.0,
                 max_width_atr=0.0, oco=True, trend_n=0, max_hold=0, fade_stop_buf=0.05,
                 min_range_bars=0, tf="H1"):
        self.mode, self.range_start, self.range_end = mode, int(range_start), int(range_end)
        self.entry_end, self.exit_hour = int(entry_end), int(exit_hour)
        self.stop_mode, self.stop_frac, self.stop_atr, self.atr_n = (
            stop_mode, float(stop_frac), float(stop_atr), int(atr_n))
        self.tp_r, self.tp_mode, self.buffer_atr = float(tp_r), tp_mode, float(buffer_atr)
        self.min_width_atr, self.max_width_atr = float(min_width_atr), float(max_width_atr)
        self.oco, self.trend_n, self.max_hold = bool(oco), int(trend_n), int(max_hold)
        self.fade_stop_buf, self.min_range_bars, self.tf = (float(fade_stop_buf),
                                                           int(min_range_bars), tf)
        if not (0 <= self.range_start < self.range_end <= self.entry_end < self.exit_hour <= 23):
            raise ValueError("need range_start < range_end <= entry_end < exit_hour <= 23")

    # ------------------------------------------------------------------ helpers
    def session_levels(self, b: pd.DataFrame) -> pd.DataFrame:
        """Causal per-day range levels on the H1 index (NaN before the range is complete)."""
        idx = b.index
        date = idx.normalize()
        hour = idx.hour
        in_rng = (hour >= self.range_start) & (hour < self.range_end)
        # running max/min over range bars of the same day (bars <= t only), carried forward
        hi = b["high"].where(in_rng).groupby(date).cummax().groupby(date).ffill()
        lo = b["low"].where(in_rng).groupby(date).cummin().groupby(date).ffill()
        cnt = pd.Series(in_rng.astype(int), index=idx).groupby(date).cumsum()
        need = self.min_range_bars or max(self.range_end - self.range_start - 1, 1)
        complete = (hour >= self.range_end - 1) & (cnt >= need)
        hi = hi.where(complete)
        lo = lo.where(complete)
        return pd.DataFrame({"hi": hi, "lo": lo, "date": date, "hour": hour}, index=idx)

    def decisions(self, ctx) -> pd.DataFrame:
        b = ctx.bars("H1")
        d1 = ctx.bars("D1")
        idx = b.index
        lv = self.session_levels(b)
        date, hour = lv["date"], lv["hour"].to_numpy()
        hi, lo = lv["hi"], lv["lo"]
        width = hi - lo
        atr = pd.Series(align_closed(I.atr(d1, self.atr_n), "D1", idx, "H1"), index=idx)
        buf = self.buffer_atr * atr

        ok = (width > 0) & atr.notna() & (atr > 0)
        if self.min_width_atr > 0:
            ok &= width >= self.min_width_atr * atr
        if self.max_width_atr > 0:
            ok &= width <= self.max_width_atr * atr
        allow_long = ok.copy()
        allow_short = ok.copy()
        if self.trend_n > 0:
            c = d1["close"]
            e = I.ema(c, self.trend_n)
            state = np.sign(c - e).where(e.notna())          # +1 / -1 on closed D1 bars
            tr = pd.Series(align_closed(state, "D1", idx, "H1"), index=idx)
            allow_long &= tr > 0
            allow_short &= tr < 0

        # decision bars t whose NEXT bar lies in the entry window [range_end, entry_end)
        dec_win = (hour >= self.range_end - 1) & (hour < self.entry_end - 1)
        # bars inside the entry window (where orders were live / signals may occur)
        in_win = (hour >= self.range_end) & (hour < self.entry_end)
        hold_win = (hour >= self.range_end - 1) & (hour < self.exit_hour - 1)

        d = empty_decisions(idx)
        up_lvl = hi + buf
        dn_lvl = lo - buf

        if self.mode == "breakout":
            # has each side already traded through its level today (bars <= t)?
            t_up = pd.Series(in_win & (b["high"] >= up_lvl).to_numpy(), index=idx)
            t_dn = pd.Series(in_win & (b["low"] <= dn_lvl).to_numpy(), index=idx)
            done_up = t_up.groupby(date).cummax().to_numpy()
            done_dn = t_dn.groupby(date).cummax().to_numpy()
            if self.oco:
                done_up = done_dn = done_up | done_dn
            L = dec_win & allow_long.to_numpy() & ~done_up
            S = dec_win & allow_short.to_numpy() & ~done_dn
            if self.stop_mode == "range":
                stop = self.stop_frac * width + buf
            elif self.stop_mode == "atr":
                stop = self.stop_atr * atr
            else:
                raise ValueError(self.stop_mode)
            # each side carries its own stop-entry price; the stop distance is shared
            d["long_stop_px"] = np.where(L, up_lvl, np.nan)
            d["short_stop_px"] = np.where(S, dn_lvl, np.nan)
            d["long_entry"] = L
            d["short_entry"] = S
            d["stop_dist"] = stop.where(L | S)
            if self.tp_r > 0:
                d["tp_dist"] = self.tp_r * stop.where(L | S)

        elif self.mode == "fade":
            close = b["close"]
            h_win = b["high"].where(in_win)
            l_win = b["low"].where(in_win)
            hh = h_win.groupby(date).cummax().groupby(date).ffill()   # high since range end
            ll = l_win.groupby(date).cummin().groupby(date).ffill()
            broke_up = pd.Series(in_win & (b["high"] >= up_lvl).to_numpy(), index=idx) \
                .groupby(date).cummax()
            broke_dn = pd.Series(in_win & (b["low"] <= dn_lvl).to_numpy(), index=idx) \
                .groupby(date).cummax()
            # signal on the bar that closes back inside (only bars inside the window
            # whose next bar is still inside the window may signal)
            sig_win = in_win & (hour < self.entry_end - 1)
            sig_s = pd.Series(sig_win & (broke_up & (close < hi)).to_numpy()
                              & allow_short.to_numpy(), index=idx)
            sig_l = pd.Series(sig_win & (broke_dn & (close > lo)).to_numpy()
                              & allow_long.to_numpy(), index=idx)
            # first occurrence per day (per side, or per day with oco)
            n_s = sig_s.astype(int).groupby(date).cumsum()
            n_l = sig_l.astype(int).groupby(date).cumsum()
            first_s = sig_s & (n_s == 1)
            first_l = sig_l & (n_l == 1)
            if self.oco:
                any_sig = (sig_s | sig_l).astype(int).groupby(date).cumsum()
                first_s = first_s & (any_sig == 1)
                first_l = first_l & (any_sig == 1) & ~first_s
            sb = self.fade_stop_buf * atr
            if self.stop_mode == "range":   # beyond the failed-breakout extreme
                st_s = (hh + sb - close)
                st_l = (close - (ll - sb))
            elif self.stop_mode == "atr":
                st_s = st_l = self.stop_atr * atr
            else:
                raise ValueError(self.stop_mode)
            S = first_s.to_numpy()
            L = first_l.to_numpy() & ~S
            stop = pd.Series(np.where(S, st_s, np.where(L, st_l, np.nan)), index=idx)
            stop = stop.where(stop > 0.1 * atr)          # degenerate stops -> no trade
            d["long_entry"] = L & stop.notna().to_numpy()
            d["short_entry"] = S & stop.notna().to_numpy()
            d["stop_dist"] = stop
            if self.tp_mode == "range":                  # target: opposite range side
                tp = pd.Series(np.where(S, close - lo, np.where(L, hi - close, np.nan)),
                               index=idx)
                d["tp_dist"] = tp.where(tp > 0)
            elif self.tp_r > 0:
                d["tp_dist"] = self.tp_r * stop
        else:
            raise ValueError(self.mode)

        # flat outside the holding window: exit at the open of the exit_hour bar (and
        # at the first bar of any later session if data were missing)
        d["exit_long"] = ~hold_win
        d["exit_short"] = ~hold_win
        d["max_hold"] = int(self.max_hold)
        return d
