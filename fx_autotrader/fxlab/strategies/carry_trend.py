"""carry_trend - carry with trend protection (research family ``carry_trend``).

Idea: hold the high-yield side of a currency pair (earn the swap) only while the
daily trend agrees and volatility is not extreme; step aside when the trend breaks
or volatility spikes (carry trades crash in risk-off episodes such as 2008).
Optionally trade the unwind itself (against the carry) while a risk-off move is
under way.

Carry direction (per pair, fixed for a calendar year)
    diff(t) = policy_rate(base, Y-1) - policy_rate(quote, Y-1)   (%), Y = year of bar t
    i.e. the PREVIOUS calendar year's annual-average policy rates - never the current
    year's.  2005+ values come from fxlab.instruments.policy_rate; lagged years before
    2005 come from RATES_PRE below (approximate, only needed for 2005 decisions on
    OANDA and for the FRED 1976-2004 pre-sample check).
    carry_dir = +1 if diff >= min_diff, -1 if diff <= -min_diff, else 0 (no trade).
    top_k > 0: additionally only the top_k pairs of `rank_universe` by |diff| (ties
    broken by list order) are eligible in that year.

Trend state (completed D1 closes only)
    "ema":   +1 if close > EMA(trend_n), -1 if close < EMA(trend_n)
    "cross": +1 if EMA(trend_n // 4) > EMA(trend_n), -1 if below
    "mom":   +1 if close > close[trend_n bars ago], -1 if below
    "none":  pure-carry baseline (always in the carry direction; exits only on the
             stop, a vol spike or a change of carry_dir)
    exit_buf > 0 ("ema" only): a carry position is closed only when the close is
    exit_buf * ATR(atr_n) beyond the EMA on the wrong side (entry still needs the
    close on the right side of the EMA).
    On the OANDA source the closes before 2005-01-03 are FRED daily closes (warm-up
    only; see closes()).

Volatility regime
    vol_ratio = stdev of daily log returns over vol_fast bars / same over vol_slow bars
    (close-to-close realized vol; identical definition on OANDA and FRED closes).
    riskoff_sym (e.g. "AUDJPY"): use max(own ratio, ratio of that symbol) - a common
    risk-off gauge for all pairs (that symbol's D1 bar with the same open time, i.e.
    closed at the same moment; forward-filled over missing days).

Rules (decided at the D1 close, executed by the engine at the next bar's open,
rollover-hour fills moved to 01:00 server time)
    carry entry   carry_dir != 0 and trend == carry_dir and vol_ratio < vol_entry
                  -> open in carry_dir.
    carry exit    trend != carry_dir (or the exit_buf rule) or vol_ratio >= vol_exit
                  or carry_dir changes (first bar of a new year with a new sign/zero).
    unwind (optional, unwind=True)
                  carry_dir != 0 and trend == -carry_dir and vol_ratio >= unwind_vol
                  -> open AGAINST the carry (pays the negative swap), time stop
                  unwind_hold D1 bars; closed when trend != -carry_dir.
    carry_filter=False (ablation only): the same trend/vol rules on both sides of every
                  pair, carry ignored - measures what the carry condition adds.
    every trade   initial stop = stop_atr * ATR(atr_n) set at entry; optional
                  chandelier trail = trail_atr * ATR(atr_n).  One position per
                  symbol, no averaging, no grid.  After any exit the position is
                  re-opened on a later bar only if all entry conditions hold again.

FRED source: bars are close-only with a synthetic range whose ATR(20) is ~1.47x the
true ATR (median OANDA/FRED ATR ratio 0.68 over the 15 pairs, IS overlap), so stop
and trail distances on FRED use ATR * FRED_ATR_SCALE (data calibration, not tuned on
performance).  Trend and vol_ratio use closes only and need no correction.
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np
import pandas as pd

from .. import data as D
from .. import indicators as I
from ..backtest import _bars
from ..instruments import INSTRUMENTS, _RATE_YEARS, policy_rate
from .base import Strategy, empty_decisions

FRED_ATR_SCALE = 0.68

# Approximate annual-average short-term policy / money-market rates (%) 1975-2004, used
# ONLY as the lagged carry input for decisions dated 1976-2005 (the shared rate table
# starts in 2005).  Rounded from published central-bank histories: USD effective fed
# funds, JPY call rate, GBP Bank Rate/MLR, EUR = ECB refi from 1999 (DEM call money
# before, only relevant for 1999 decisions), AUD cash rate (bank-bill rates before
# 1990), CAD Bank Rate, NZD OCR (90-day bill before 1999), CHF 3m Libor/call.  Accuracy
# about +-1 percentage point (+-2 for AUD/NZD/CHF before 1985).  Never used for
# parameter selection (the FRED pre-sample is a robustness check only), and the
# engine's swap before 2005 still uses its own (2005) table.
RATES_PRE = {
    #      1975  76    77    78    79    80    81    82    83    84    85    86    87    88    89
    "USD": [5.8, 5.0, 5.5, 7.9, 11.2, 13.4, 16.4, 12.3, 9.1, 10.2, 8.1, 6.8, 6.7, 7.6, 9.2,
            #  1990 91   92   93   94   95   96   97   98   99   2000 01   02   03   04
            8.1, 5.7, 3.5, 3.0, 4.2, 5.8, 5.3, 5.5, 5.4, 5.0, 6.2, 3.9, 1.7, 1.1, 1.35],
    "JPY": [10.7, 7.0, 5.7, 4.4, 5.9, 10.9, 7.4, 7.0, 6.4, 6.1, 6.5, 4.8, 3.5, 3.6, 4.9,
            7.2, 7.5, 4.6, 3.1, 2.2, 1.2, 0.5, 0.5, 0.4, 0.1, 0.1, 0.1, 0.0, 0.0, 0.0],
    "GBP": [10.6, 11.5, 8.5, 9.0, 13.7, 16.3, 13.3, 11.9, 9.8, 9.7, 12.3, 10.9, 9.7, 10.1,
            13.8, 14.8, 11.7, 9.6, 6.0, 5.5, 6.7, 6.0, 6.6, 7.2, 5.3, 6.0, 5.1, 4.0, 3.7, 4.4],
    "EUR": [5.0, 4.2, 4.4, 3.7, 6.7, 9.1, 11.3, 8.7, 5.4, 5.6, 5.2, 4.6, 3.7, 4.0, 6.6,
            7.9, 8.8, 9.4, 7.5, 5.3, 4.5, 3.3, 3.2, 3.4, 2.7, 4.0, 4.4, 3.3, 2.3, 2.0],
    "AUD": [9.0, 8.5, 9.0, 9.0, 9.5, 11.0, 12.5, 14.0, 11.0, 11.0, 15.0, 16.0, 13.5, 12.5,
            17.5, 15.0, 10.5, 6.5, 5.1, 5.3, 7.5, 7.2, 5.5, 5.0, 4.8, 5.9, 5.0, 4.6, 4.8, 5.25],
    "CAD": [8.5, 9.3, 7.7, 8.9, 12.1, 13.0, 17.9, 14.0, 9.5, 11.3, 9.7, 9.2, 8.4, 9.7, 12.3,
            13.0, 9.0, 6.8, 5.1, 5.8, 7.3, 4.5, 3.5, 5.1, 4.9, 5.8, 4.3, 2.7, 3.0, 2.25],
    "NZD": [9.0, 9.0, 10.0, 10.0, 11.0, 12.0, 13.0, 13.0, 12.0, 14.0, 19.0, 19.0, 20.0,
            14.0, 13.0, 13.5, 9.5, 6.5, 6.0, 6.5, 8.8, 9.2, 7.5, 7.0, 4.8, 6.3, 5.8, 5.6, 5.3,
            5.8],
    "CHF": [3.0, 1.0, 2.0, 0.5, 1.5, 5.0, 9.0, 5.0, 4.0, 4.0, 4.5, 4.0, 3.5, 3.0, 7.0, 8.5,
            8.0, 7.5, 4.8, 4.0, 2.9, 2.0, 1.6, 1.4, 1.3, 3.0, 2.7, 1.0, 0.3, 0.4],
    "XAU": [0.0] * 30,
}
_PRE_Y0 = 1975


def lagged_rate(ccy: str, years: np.ndarray) -> np.ndarray:
    """Policy rate (%) of year-1 for each entry of `years` (NaN if unknown)."""
    out = np.full(len(years), np.nan)
    for y in np.unique(years):
        ly = int(y) - 1
        m = years == y
        if _RATE_YEARS[0] <= ly <= _RATE_YEARS[-1]:
            out[m] = policy_rate(ccy, ly)
        elif _PRE_Y0 <= ly < _RATE_YEARS[0] and ccy in RATES_PRE:
            out[m] = RATES_PRE[ccy][ly - _PRE_Y0]
    return out


def lagged_diff(symbol: str, index: pd.DatetimeIndex) -> np.ndarray:
    inst = INSTRUMENTS[symbol]
    years = index.year.to_numpy()
    return lagged_rate(inst.base, years) - lagged_rate(inst.quote, years)


@lru_cache(maxsize=None)
def _fred_closes() -> pd.DataFrame:
    return D.load_fred_daily()


@lru_cache(maxsize=None)
def closes(source: str, symbol: str) -> pd.Series:
    """D1 closes for the indicators.  On the OANDA source the history BEFORE the first
    OANDA bar is spliced from FRED daily closes (only dates < first OANDA bar), so
    long look-backs are defined from the first in-sample bar; an EA simply uses the
    broker's own longer history."""
    c = _bars(source, symbol, "D1")["close"]
    if source != "oanda":
        return c
    f = _fred_closes()[symbol].dropna()
    f = f[f.index < c.index[0]]
    return pd.concat([f, c]).sort_index()


def trend_state(c: pd.Series, kind: str, n: int) -> pd.Series:
    """+1 / -1 trend state from closes (NaN during warm-up)."""
    if kind == "ema":
        ref = I.ema(c, n)
        st = np.sign(c - ref)
    elif kind == "cross":
        ref = I.ema(c, n)
        st = np.sign(I.ema(c, max(2, n // 4)) - ref)
    elif kind == "mom":
        ref = c.shift(n)
        st = np.sign(c - ref)
    else:
        raise ValueError(kind)
    return st.where(ref.notna())


def vol_ratio(c: pd.Series, fast: int, slow: int) -> pd.Series:
    """Close-to-close realized vol ratio: stdev of daily log returns over `fast` bars
    divided by the same over `slow` bars."""
    return I.realized_vol(c, fast) / I.realized_vol(c, slow)


class CarryTrend(Strategy):
    name = "carry_trend"
    tf = "D1"

    def __init__(self, min_diff=2.0, trend="ema", trend_n=100, exit_buf=0.0,
                 vol_fast=20, vol_slow=250, vol_entry=99.0, vol_exit=99.0, riskoff_sym=None,
                 atr_n=20, stop_atr=4.0, trail_atr=0.0, unwind=False, unwind_vol=1.5,
                 unwind_hold=20, top_k=0, rank_universe=(), carry_filter=True):
        self.min_diff = float(min_diff)
        self.trend = trend
        self.trend_n = int(trend_n)
        self.exit_buf = float(exit_buf)
        self.vol_fast = int(vol_fast)
        self.vol_slow = int(vol_slow)
        self.vol_entry = float(vol_entry)
        self.vol_exit = float(vol_exit)
        self.riskoff_sym = riskoff_sym
        self.atr_n = int(atr_n)
        self.stop_atr = float(stop_atr)
        self.trail_atr = float(trail_atr)
        self.unwind = bool(unwind)
        self.unwind_vol = float(unwind_vol)
        self.unwind_hold = int(unwind_hold)
        self.top_k = int(top_k)
        self.rank_universe = list(rank_universe)
        self.carry_filter = bool(carry_filter)

    # ------------------------------------------------------------------ pieces
    def carry_dir(self, symbol: str, index: pd.DatetimeIndex) -> np.ndarray:
        diff = lagged_diff(symbol, index)
        cd = np.where(diff >= self.min_diff, 1.0, np.where(diff <= -self.min_diff, -1.0, 0.0))
        cd = np.where(np.isnan(diff), 0.0, cd)
        if self.top_k > 0 and self.rank_universe:
            years = index.year.to_numpy()
            ok = np.zeros(len(index), bool)
            for y in np.unique(years):
                probe = pd.DatetimeIndex([pd.Timestamp(int(y), 7, 1)])
                mags = [lagged_diff(s, probe)[0] for s in self.rank_universe]
                mags = np.array([-1.0 if np.isnan(m) else abs(m) for m in mags])
                order = np.argsort(-mags, kind="stable")
                if symbol in {self.rank_universe[i] for i in order[:self.top_k]}:
                    ok[years == y] = True
            cd = np.where(ok, cd, 0.0)
        return cd

    def regime_vol(self, source: str, symbol: str, index: pd.DatetimeIndex) -> pd.Series:
        """Vol ratio on each bar of `index` (bars closed at the same moment)."""
        vr = vol_ratio(closes(source, symbol), self.vol_fast, self.vol_slow)
        vr = vr.reindex(vr.index.union(index)).ffill().reindex(index)
        if self.riskoff_sym and self.riskoff_sym != symbol:
            ovr = vol_ratio(closes(source, self.riskoff_sym), self.vol_fast, self.vol_slow)
            ovr = ovr.reindex(ovr.index.union(index)).ffill().reindex(index)
            vr = pd.concat([vr, ovr], axis=1).max(axis=1, skipna=False)
        return vr

    def decisions(self, ctx) -> pd.DataFrame:
        b = ctx.bars("D1")
        idx = b.index
        d = empty_decisions(idx)
        a = I.atr(b, self.atr_n)
        if ctx.source == "fred":
            a = a * FRED_ATR_SCALE
        c = closes(ctx.source, ctx.symbol)
        cd = pd.Series(self.carry_dir(ctx.symbol, idx), index=idx)
        if self.trend == "none":        # pure-carry baseline: the "trend" always agrees
            st = cd.where(cd != 0, 0.0)
            ema_ref = None
        else:
            st = trend_state(c, self.trend, self.trend_n).reindex(idx)
            ema_ref = I.ema(c, self.trend_n).reindex(idx)
        vr = self.regime_vol(ctx.source, ctx.symbol, idx)
        valid = st.notna() & vr.notna() & a.notna()
        stv = st.fillna(0.0)

        calm = vr < self.vol_entry
        spike = vr >= self.vol_exit
        if self.carry_filter:
            allow_long, allow_short = cd > 0, cd < 0
        else:                            # ablation: same trend/vol rules, carry ignored
            allow_long = allow_short = pd.Series(True, index=idx)
        # carry side
        c_long = valid & allow_long & (stv > 0) & calm
        c_short = valid & allow_short & (stv < 0) & calm
        if self.trend == "ema" and self.exit_buf > 0:
            brk_long = b["close"] < ema_ref - self.exit_buf * a
            brk_short = b["close"] > ema_ref + self.exit_buf * a
        else:
            brk_long = stv <= 0
            brk_short = stv >= 0
        x_carry_long = allow_long & (brk_long | spike)
        x_carry_short = allow_short & (brk_short | spike)
        if self.carry_filter:
            cd_changed = cd != cd.shift(1).fillna(cd.iloc[0] if len(cd) else 0.0)
            flat = (cd == 0) | cd_changed
        else:
            flat = pd.Series(False, index=idx)

        # unwind side (against the carry, during a risk-off move)
        none = pd.Series(False, index=idx)
        if self.unwind and self.carry_filter:
            u_long = valid & (cd < 0) & (stv > 0) & (vr >= self.unwind_vol)
            u_short = valid & (cd > 0) & (stv < 0) & (vr >= self.unwind_vol)
            x_unw_long = (cd < 0) & (stv <= 0)
            x_unw_short = (cd > 0) & (stv >= 0)
        else:
            u_long = u_short = x_unw_long = x_unw_short = none

        d["long_entry"] = (c_long | u_long).to_numpy()
        d["short_entry"] = (c_short | u_short).to_numpy()
        # a long is either a carry long (cd>0) or an unwind long (cd<0); cd==0 -> flat
        d["exit_long"] = (x_carry_long | x_unw_long | flat).to_numpy()
        d["exit_short"] = (x_carry_short | x_unw_short | flat).to_numpy()
        d["stop_dist"] = (self.stop_atr * a).to_numpy()
        if self.trail_atr > 0:
            d["trail_dist"] = (self.trail_atr * a).to_numpy()
        if self.unwind and self.unwind_hold > 0:
            d["max_hold"] = np.where((u_long | u_short).to_numpy(), self.unwind_hold, 0)
        return d
