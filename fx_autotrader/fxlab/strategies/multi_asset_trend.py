"""multi_asset_trend - diversified daily trend following across FX, gold and stock-index
CFDs, long and short (research family ``multi_asset_trend``, managed-futures style).

One class, ``MultiAssetTrend``.  Everything is decided on the CLOSE of daily bar t
using bars <= t only; the engine executes at the next execution bar's open (01:00
server time after the rollover rule).

  signal (directional score in [-1, +1] computed from closes)
    ema        score = sign(EMA(fast) - EMA(n)),  fast = n // 4 unless given
    tsmom      score = sign(close / close[n bars ago] - 1)      (time-series momentum)
    ens_ema    score = mean over L in lookbacks of sign(EMA(L // 4) - EMA(L))
    ens_tsmom  score = mean over L in lookbacks of sign(close / close[L] - 1)
    donchian   event system: long when close > highest close of the previous n bars,
               short when close < lowest close of the previous n bars (channels
               exclude bar t via .shift(1)); exit on the opposite exit_n channel.

  state systems (all but donchian)
    enter long   score >= entry_thr         enter short  score <= -entry_thr
    exit long    score <= exit_thr          exit short   score >= -exit_thr
    With a single rule (ema / tsmom) score is +-1, so entry_thr = 1, exit_thr = 0 is
    the classic always-in stop-and-reverse system.  An ensemble with entry_thr < 1
    and exit_thr = 0 has a neutral zone (flat when the lookbacks disagree).
    entry_mode "state": (re-)enter whenever the entry condition holds and the
    symbol is flat (also after a stop-out, and at the start of an evaluation
    window); "cross": only on the bar where the condition becomes true.

  risk (always a stop at entry)
    stop_atr     initial stop = stop_atr * ATR(atr_n)   (wide: it sets the size via the
                 engine's 1%-risk sizing, notional ~ 1% / (stop_atr * ATR%))
    trail_atr    chandelier trail = trail_atr * ATR(atr_n) from the best price since
                 entry (0 = none)

  filters (entries only; exits are never filtered)
    short_risk   False -> stock indices and gold may only be long (or flat); FX is
                 always long/short
    carry_min    skip an entry whose expected annual CFD carry (policy-rate / dividend
                 differential of the PREVIOUS calendar year minus the 2.5% broker
                 markup, in % of notional) is below carry_min (None = off).  When the
                 previous year is outside the rate table (before 2005) the filter
                 passes, so no future rate is ever used.
    warmup       no entries during the first ``warmup`` bars of a series (all
                 lookbacks valid, every variant starts on the same date)

Source handling: all signals use closes only, so they are identical on OANDA OHLC and
on the close-only FRED / pst series.  Those series carry a synthetic range that makes
ATR(20) about 1.5x the true ATR (median ratio 1.39-1.54 over the 15 FRED pairs and
1.46-1.55 over the pst symbols on the IS overlap 2005-2014), so on source "fred" /
"pst" the ATR is divided by SYNTH_ATR_SCALE = 1.5 to keep stop distances - and
therefore exposure - comparable.  Calibration on IS data only.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .. import indicators as I
from ..instruments import INSTRUMENTS, CostModel, policy_rate
from .base import Strategy, empty_decisions

SYNTH_ATR_SCALE = 1.5
STATE_SIGNALS = ("ema", "tsmom", "ens_ema", "ens_tsmom")
SIGNALS = STATE_SIGNALS + ("donchian",)
RISK_ASSETS = {"XAUUSD", "US500", "NAS100", "US2000", "JPN225", "UK100", "FRA40", "AUS200"}
_RATE_FIRST_YEAR = 2005


def lagged_carry_pct(symbol: str, direction: int, years: np.ndarray,
                     markup: float = CostModel().swap_markup_pct) -> np.ndarray:
    """Expected annual carry (% of notional) of a spot CFD position opened in `years`,
    using the PREVIOUS year's rates.  NaN when the previous year is not in the table."""
    ins = INSTRUMENTS[symbol]
    out = np.full(len(years), np.nan)
    for y in np.unique(years):
        py = int(y) - 1
        if py < _RATE_FIRST_YEAR:
            continue
        diff = policy_rate(ins.base, py) - policy_rate(ins.quote, py)
        out[years == y] = direction * diff - markup
    return out


class MultiAssetTrend(Strategy):
    name = "multi_asset_trend"
    tf = "D1"

    def __init__(self, signal="ens_ema", n=128, fast=0, lookbacks=(32, 64, 128, 256),
                 entry_thr=1.0, exit_thr=0.0, exit_n=0, entry_mode="state",
                 stop_atr=5.0, atr_n=20, trail_atr=0.0, short_risk=True, carry_min=None,
                 warmup=260):
        if signal not in SIGNALS:
            raise ValueError(signal)
        if entry_mode not in ("state", "cross"):
            raise ValueError(entry_mode)
        self.signal = signal
        self.n = int(n)
        self.fast = int(fast)
        self.lookbacks = tuple(int(x) for x in lookbacks)
        self.entry_thr = float(entry_thr)
        self.exit_thr = float(exit_thr)
        self.exit_n = int(exit_n)
        self.entry_mode = entry_mode
        self.stop_atr = float(stop_atr)
        self.atr_n = int(atr_n)
        self.trail_atr = float(trail_atr)
        self.short_risk = bool(short_risk)
        self.carry_min = None if carry_min is None else float(carry_min)
        self.warmup = int(warmup)

    def params(self) -> dict:
        p = super().params()
        p["lookbacks"] = list(self.lookbacks)
        return p

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def _atr(b: pd.DataFrame, n: int, source: str) -> pd.Series:
        a = I.atr(b, n)
        return a / SYNTH_ATR_SCALE if source in ("pst", "fred") else a

    def score(self, c: pd.Series) -> pd.Series:
        """Directional score in [-1, 1] (NaN while any lookback is warming up)."""
        if self.signal == "ema":
            f = self.fast or max(2, self.n // 4)
            return np.sign(I.ema(c, f) - I.ema(c, self.n))
        if self.signal == "tsmom":
            return np.sign(c / c.shift(self.n) - 1.0)
        if self.signal == "ens_ema":
            votes = [np.sign(I.ema(c, max(2, L // 4)) - I.ema(c, L)) for L in self.lookbacks]
        else:  # ens_tsmom
            votes = [np.sign(c / c.shift(L) - 1.0) for L in self.lookbacks]
        return pd.concat(votes, axis=1).mean(axis=1, skipna=False)

    def _entries_exits(self, c: pd.Series):
        if self.signal == "donchian":
            xn = self.exit_n or max(2, self.n // 2)
            hi = c.rolling(self.n, min_periods=self.n).max().shift(1)
            lo = c.rolling(self.n, min_periods=self.n).min().shift(1)
            xhi = c.rolling(xn, min_periods=xn).max().shift(1)
            xlo = c.rolling(xn, min_periods=xn).min().shift(1)
            return c > hi, c < lo, c < xlo, c > xhi
        s = self.score(c)
        eps = 1e-9
        long_in = s >= self.entry_thr - eps
        short_in = s <= -self.entry_thr + eps
        exit_long = s <= self.exit_thr + eps
        exit_short = s >= -self.exit_thr - eps
        if self.entry_mode == "cross":
            long_in = long_in & ~long_in.shift(1, fill_value=False)
            short_in = short_in & ~short_in.shift(1, fill_value=False)
        return long_in, short_in, exit_long, exit_short

    # ---------------------------------------------------------------- decisions
    def decisions(self, ctx) -> pd.DataFrame:
        src = getattr(ctx, "source", "oanda")
        sym = ctx.symbol
        b = ctx.bars(self.tf)
        c = b["close"]
        a = self._atr(b, self.atr_n, src)
        long_in, short_in, exit_long, exit_short = self._entries_exits(c)

        live = pd.Series(np.arange(len(b)) >= self.warmup, index=b.index)
        ok_l = live.copy()
        ok_s = live.copy()
        if sym in RISK_ASSETS and not self.short_risk:
            ok_s[:] = False
        if self.carry_min is not None:
            yrs = b.index.year.to_numpy()
            cl = lagged_carry_pct(sym, 1, yrs)
            cs = lagged_carry_pct(sym, -1, yrs)
            ok_l &= pd.Series(np.isnan(cl) | (cl >= self.carry_min), index=b.index)
            ok_s &= pd.Series(np.isnan(cs) | (cs >= self.carry_min), index=b.index)

        d = empty_decisions(b.index)
        d["long_entry"] = (long_in.fillna(False).astype(bool) & ok_l).astype(bool)
        d["short_entry"] = (short_in.fillna(False).astype(bool) & ok_s).astype(bool)
        d["exit_long"] = exit_long.fillna(False).astype(bool)
        d["exit_short"] = exit_short.fillna(False).astype(bool)
        d["stop_dist"] = self.stop_atr * a
        if self.trail_atr > 0:
            d["trail_dist"] = self.trail_atr * a
        return d
