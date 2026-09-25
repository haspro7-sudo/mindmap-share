"""Volatility contraction -> expansion breakout (D1 / H4).

Idea (Crabel / Toby Crabel "NR7", inside bars, Bollinger squeeze): after a period
of unusually small ranges, volatility tends to expand; enter in the direction of the
expansion with stop-entry orders on both sides of the compression range (OCO).

Everything is decided on the CLOSE of signal bar t using bars <= t only; the engine
places the orders at the open of the next execution bar (D1: 01:00 server time of
the next day; H4: the next H4 open, 01:00 when that is the rollover hour).

Setups (``setup``) on the closed bar t:
    nr         NR-n: range(t) = high - low is the smallest of the last ``nr_n`` bars
               (bar t included).  Compression range = bar t's high / low.
    inside     inside bar: high(t) <= high(t-1) and low(t) >= low(t-1).
               Compression range = bar t (``inside_range="self"``) or the mother
               bar t-1 (``inside_range="mother"``).
    nr_inside  both of the above ("ID/NR4" when nr_n=4); range = bar t.
    squeeze    Bollinger bandwidth  (upper-lower)/middle of BB(bb_n, 2.0) on closes
               is below ``sq_thr`` x its SMA over ``sq_long`` bars.
               Compression range = highest high / lowest low of the last ``box_n``
               bars (bar t included).
    atr_ratio  ATR(atr_s) / ATR(atr_l) < ``ar_thr`` (MT5 iATR = SMA of true range);
               range = last ``box_n`` bars as for squeeze.

Orders (OCO pair, both sides unless a trend filter is on):
    buy-stop  at range_high + buffer_atr * ATR(atr_n)
    sell-stop at range_low  - buffer_atr * ATR(atr_n)
    valid for ``valid_bars`` signal bars after the setup bar (re-issued at every
    decision with the SAME levels while neither level has been traded through since
    the setup bar; a newer setup replaces the older one).  Once one side fills the
    other is cancelled (engine OCO); a level that has been touched is never re-armed.

Initial stop (always set at entry; distance measured from the fill price):
    stop_mode="range": opposite side of the range (+ buffer), i.e. width + 2*buffer,
                       floored at min_stop_atr * ATR(atr_n)
    stop_mode="atr":   stop_atr * ATR(atr_n)
Exits: optional take-profit tp_r * stop, optional chandelier trail
trail_atr * ATR(atr_n) (highest high since entry - trail, only tightens, updated at
each signal-bar close), optional time stop ``max_hold`` signal bars.
Optional filters: ``trend_n`` > 0 -> only buy-stops when close(t) > EMA(trend_n)
and only sell-stops when close(t) < EMA(trend_n); ``max_width_atr`` > 0 -> skip
setups whose range is wider than max_width_atr * ATR(atr_n).

All indicators match MT5 built-ins (iATR = SMA of TR, iBands, iMA EMA).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .. import indicators as I
from .base import Strategy, empty_decisions


class VolatilityBreakout(Strategy):
    name = "volatility_breakout"

    def __init__(self, tf="D1", setup="nr", nr_n=7, inside_range="self", bb_n=20,
                 sq_long=120, sq_thr=0.6, atr_s=5, atr_l=60, ar_thr=0.6, box_n=5,
                 atr_n=20, buffer_atr=0.0, valid_bars=1, stop_mode="range", stop_atr=1.0,
                 min_stop_atr=0.0, max_width_atr=0.0, tp_r=0.0, trail_atr=0.0,
                 max_hold=0, trend_n=0):
        if tf not in ("D1", "H4", "H1"):
            raise ValueError(tf)
        if setup not in ("nr", "inside", "nr_inside", "squeeze", "atr_ratio"):
            raise ValueError(setup)
        if stop_mode not in ("range", "atr"):
            raise ValueError(stop_mode)
        self.tf, self.setup, self.nr_n, self.inside_range = tf, setup, int(nr_n), inside_range
        self.bb_n, self.sq_long, self.sq_thr = int(bb_n), int(sq_long), float(sq_thr)
        self.atr_s, self.atr_l, self.ar_thr = int(atr_s), int(atr_l), float(ar_thr)
        self.box_n, self.atr_n, self.buffer_atr = int(box_n), int(atr_n), float(buffer_atr)
        self.valid_bars, self.stop_mode, self.stop_atr = int(valid_bars), stop_mode, float(stop_atr)
        self.min_stop_atr, self.max_width_atr = float(min_stop_atr), float(max_width_atr)
        self.tp_r, self.trail_atr, self.max_hold = float(tp_r), float(trail_atr), int(max_hold)
        self.trend_n = int(trend_n)

    # ------------------------------------------------------------------ setups
    def setup_frame(self, b: pd.DataFrame) -> pd.DataFrame:
        """Setup flag and compression range (hi/lo) per bar, from bars <= t only."""
        h, l, c = b["high"], b["low"], b["close"]
        rng = h - l
        s = self.setup
        if s in ("nr", "inside", "nr_inside"):
            nr = rng <= rng.rolling(self.nr_n, min_periods=self.nr_n).min()
            inside = (h <= h.shift(1)) & (l >= l.shift(1))
            if s == "nr":
                flag = nr
            elif s == "inside":
                flag = inside
            else:
                flag = nr & inside
            if s == "inside" and self.inside_range == "mother":
                hi, lo = h.shift(1), l.shift(1)
            else:
                hi, lo = h, l
            flag = flag & (rng > 0)
        else:
            if s == "squeeze":
                lower, mid, upper = I.bollinger(c, self.bb_n, 2.0)
                bw = (upper - lower) / mid
                ratio = bw / I.sma(bw, self.sq_long)
                flag = ratio < self.sq_thr
            else:  # atr_ratio
                ratio = I.atr(b, self.atr_s) / I.atr(b, self.atr_l)
                flag = ratio < self.ar_thr
            hi = h.rolling(self.box_n, min_periods=self.box_n).max()
            lo = l.rolling(self.box_n, min_periods=self.box_n).min()
        flag = flag.fillna(False).astype(bool) & hi.notna() & lo.notna()
        return pd.DataFrame({"setup": flag, "hi": hi, "lo": lo}, index=b.index)

    # --------------------------------------------------------------- decisions
    def decisions(self, ctx) -> pd.DataFrame:
        b = ctx.bars(self.tf)
        idx = b.index
        n = len(idx)
        h = b["high"].to_numpy(float)
        l = b["low"].to_numpy(float)
        c = b["close"]
        atr = I.atr(b, self.atr_n)
        a = atr.to_numpy(float)
        sf = self.setup_frame(b)
        setup = sf["setup"].to_numpy(bool) & np.isfinite(a) & (a > 0)
        width = (sf["hi"] - sf["lo"]).to_numpy(float)
        if self.max_width_atr > 0:
            setup &= width <= self.max_width_atr * a

        # levels frozen at the setup bar; carried while the setup is "active"
        buf_setup = self.buffer_atr * a
        up_s = np.where(setup, sf["hi"].to_numpy(float) + buf_setup, np.nan)
        dn_s = np.where(setup, sf["lo"].to_numpy(float) - buf_setup, np.nan)
        if self.stop_mode == "range":
            stop_s = (up_s - dn_s)
            if self.min_stop_atr > 0:
                stop_s = np.maximum(stop_s, self.min_stop_atr * a)
        else:
            stop_s = np.where(setup, self.stop_atr * a, np.nan)

        # trend filter state at the setup bar
        if self.trend_n > 0:
            e = I.ema(c, self.trend_n).to_numpy(float)
            cc = c.to_numpy(float)
            tl_s = np.where(setup, cc > e, False)
            ts_s = np.where(setup, cc < e, False)
        else:
            tl_s = setup.copy()
            ts_s = setup.copy()

        # sequential pass: active setup, whether its levels were traded through
        L = np.zeros(n, bool)
        S = np.zeros(n, bool)
        up = np.full(n, np.nan)
        dn = np.full(n, np.nan)
        st = np.full(n, np.nan)
        cur = -1
        done = True
        for t in range(n):
            if cur >= 0 and not done:
                # bar t traded while the order from the previous decision was live?
                if h[t] >= up_s[cur] or l[t] <= dn_s[cur]:
                    done = True
            if setup[t]:
                cur = t
                done = False
            if cur < 0 or done or t - cur >= self.valid_bars:
                continue
            go_l = bool(tl_s[cur])
            go_s = bool(ts_s[cur])
            if not (go_l or go_s) or not np.isfinite(stop_s[cur]) or stop_s[cur] <= 0:
                continue
            L[t], S[t] = go_l, go_s
            up[t] = up_s[cur] if go_l else np.nan
            dn[t] = dn_s[cur] if go_s else np.nan
            st[t] = stop_s[cur]

        d = empty_decisions(idx)
        d["long_entry"] = L
        d["short_entry"] = S
        d["long_stop_px"] = up
        d["short_stop_px"] = dn
        d["stop_dist"] = st
        if self.tp_r > 0:
            d["tp_dist"] = self.tp_r * st
        if self.trail_atr > 0:
            d["trail_dist"] = self.trail_atr * atr
        d["max_hold"] = int(self.max_hold)
        return d
