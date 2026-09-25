"""Short-horizon mean reversion (oscillator extremes) with regime filters.

Idea: after a short, sharp move away from a short-term mean, FX prices tend to
drift back part of the way *when the market is not trending*.  Enter against the
move at the next bar's open, exit when price is back at the mean, with an ATR stop
always set at entry and a time stop.  Everything is decided on CLOSED bars:

  * signal-timeframe indicators (RSI, Bollinger, z-score, ATR, ADX) use bars <= t
    and the engine executes at the open of the next bar.
  * D1 regime values used by H1/H4 strategies are taken from the last D1 bar that
    has fully CLOSED by the close of the lower-timeframe bar (``align_closed``).
    In MT5 terms: iMA/iATR/iADX on PERIOD_D1 with shift 1.

Entries (``entry``), long side shown; shorts are the exact mirror image:
    rsi     RSI(rsi_n) closes below rsi_lo                     (short: above 100-rsi_lo)
    bb      Bollinger re-entry: previous close below the lower band(bb_n, bb_k) and
            this close back above the lower band
    z       z-score (close - SMA(z_n)) / stdev(z_n) closes below -z_in

Exits (``exit``), long side shown:
    sma     close above SMA(exit_n)                            -> close at next open
    rsi     RSI(rsi_n) closes above exit_rsi (short: below 100-exit_rsi)
    tp      fixed take-profit at the mean: tp distance = SMA(exit_n) - close of the
            signal bar (set once at entry; no signal exit)
    none    only stop / take-profit (tp_atr) / time stop
  always:   initial stop = stop_atr * ATR(atr_n) (signal TF, MT5 iATR = SMA of TR),
            optional fixed take-profit tp_atr * ATR, time stop max_hold signal bars.
            An opposite entry signal reverses the position (engine behaviour).

Regime filters (all optional, entry only):
    adx_max     ADX(adx_n) (Wilder, MT5 iADXWilder) below adx_max; computed on the
                signal TF (adx_tf="sig") or on closed D1 bars (adx_tf="D1")
    vol_max     ATR(atr_n) / ATR(vol_n) on the signal TF below vol_max
                (no entries while volatility is expanding)
    d1_trend    "none" | "flat": |D1 close - D1 EMA(d1_n)| < d1_k * D1 ATR(20)
                (price not far from its long-term mean = no strong daily trend)
                | "with": long only above D1 SMA(d1_n), short only below (Connors)
    hours       intraday only: set of allowed server hours for the ENTRY fill
    skip_rollover  intraday only: never open a position at the 00:00 server-time
                open (daily rollover: spreads are several times wider there)
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .. import indicators as I
from ..engine import TF_DURATION
from .base import Strategy, empty_decisions

SESSIONS = {
    "all": None,
    # entry fills at server 01:00..08:59 (Tokyo/Sydney; ~22:00-06:00 GMT in winter)
    "asia": set(range(1, 9)),
    # entry fills at server 09:00..20:59 (London + New York)
    "eu_us": set(range(9, 21)),
}


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


class MeanReversion(Strategy):
    name = "mean_reversion"

    def __init__(self, tf="D1", entry="rsi", rsi_n=2, rsi_lo=10.0, bb_n=20, bb_k=2.0,
                 z_n=20, z_in=2.0, exit="sma", exit_n=5, exit_rsi=50.0, tp_atr=0.0,
                 atr_n=14, stop_atr=2.5, max_hold=10, adx_n=14, adx_max=0.0, adx_tf="sig",
                 vol_n=100, vol_max=0.0, d1_trend="none", d1_n=200, d1_k=2.0,
                 hours="all", skip_rollover=True):
        self.tf, self.entry = tf, entry
        self.rsi_n, self.rsi_lo = rsi_n, rsi_lo
        self.bb_n, self.bb_k, self.z_n, self.z_in = bb_n, bb_k, z_n, z_in
        self.exit, self.exit_n, self.exit_rsi, self.tp_atr = exit, exit_n, exit_rsi, tp_atr
        self.atr_n, self.stop_atr, self.max_hold = atr_n, stop_atr, max_hold
        self.adx_n, self.adx_max, self.adx_tf = adx_n, adx_max, adx_tf
        self.vol_n, self.vol_max = vol_n, vol_max
        self.d1_trend, self.d1_n, self.d1_k = d1_trend, d1_n, d1_k
        self.hours, self.skip_rollover = hours, skip_rollover

    # ------------------------------------------------------------------ helpers
    def _d1_on_sig(self, ctx, b: pd.DataFrame, s: pd.Series) -> np.ndarray:
        """A D1 series mapped onto the signal bars (closed D1 bars only)."""
        if self.tf == "D1":
            return s.to_numpy(dtype=float)
        return align_closed(s, "D1", b.index, self.tf)

    def regime_ok(self, ctx, b: pd.DataFrame):
        """(long_ok, short_ok) boolean arrays from the regime filters."""
        n = len(b)
        ok_l = np.ones(n, bool)
        ok_s = np.ones(n, bool)
        if self.adx_max and self.adx_max > 0:
            if self.adx_tf == "D1":
                ad = self._d1_on_sig(ctx, b, I.adx(ctx.bars("D1"), self.adx_n))
            else:
                ad = I.adx(b, self.adx_n).to_numpy()
            m = ad < self.adx_max          # NaN (warm-up) -> False
            ok_l &= m
            ok_s &= m
        if self.vol_max and self.vol_max > 0:
            vr = (I.atr(b, self.atr_n) / I.atr(b, self.vol_n)).to_numpy()
            m = vr < self.vol_max
            ok_l &= m
            ok_s &= m
        if self.d1_trend != "none":
            d1 = ctx.bars("D1")
            c = d1["close"]
            if self.d1_trend == "flat":
                dist = (c - I.ema(c, self.d1_n)).abs() / I.atr(d1, 20)
                m = self._d1_on_sig(ctx, b, dist) < self.d1_k
                ok_l &= m
                ok_s &= m
            elif self.d1_trend == "with":
                sm = I.sma(c, self.d1_n)
                up = self._d1_on_sig(ctx, b, (c > sm).astype(float).where(sm.notna()))
                ok_l &= up == 1.0
                ok_s &= up == 0.0
            else:
                raise ValueError(self.d1_trend)
        if self.tf != "D1":
            exec_hour = (b.index + TF_DURATION[self.tf]).hour.to_numpy()
            allowed = SESSIONS[self.hours]
            if allowed is not None:
                m = np.isin(exec_hour, list(allowed))
                ok_l &= m
                ok_s &= m
            if self.skip_rollover:
                m = exec_hour != 0
                ok_l &= m
                ok_s &= m
        return ok_l, ok_s

    def signals(self, b: pd.DataFrame):
        c = b["close"]
        if self.entry == "rsi":
            r = I.rsi(c, self.rsi_n)
            lo, hi = float(self.rsi_lo), 100.0 - float(self.rsi_lo)
            L, S = (r < lo), (r > hi)
        elif self.entry == "bb":
            lb, _, ub = I.bollinger(c, self.bb_n, self.bb_k)
            L = (c.shift(1) < lb.shift(1)) & (c > lb)
            S = (c.shift(1) > ub.shift(1)) & (c < ub)
        elif self.entry == "z":
            m = I.sma(c, self.z_n)
            sd = c.rolling(self.z_n, min_periods=self.z_n).std(ddof=0)
            z = (c - m) / sd
            L, S = (z < -self.z_in), (z > self.z_in)
        else:
            raise ValueError(self.entry)
        return (L.fillna(False).to_numpy(bool).copy(), S.fillna(False).to_numpy(bool).copy())

    def decisions(self, ctx) -> pd.DataFrame:
        b = ctx.bars(self.tf)
        c = b["close"]
        a = I.atr(b, self.atr_n)
        L, S = self.signals(b)
        ok_l, ok_s = self.regime_ok(ctx, b)
        L &= ok_l
        S &= ok_s

        d = empty_decisions(b.index)
        stop = self.stop_atr * a
        d["stop_dist"] = stop
        xl = np.zeros(len(b), bool)
        xs = np.zeros(len(b), bool)
        tp = np.full(len(b), np.nan)
        if self.tp_atr and self.tp_atr > 0:
            tp = (self.tp_atr * a).to_numpy()
        if self.exit == "sma":
            m = I.sma(c, self.exit_n)
            xl = (c > m).to_numpy(bool).copy()
            xs = (c < m).to_numpy(bool).copy()
        elif self.exit == "rsi":
            r = I.rsi(c, self.rsi_n)
            xl = (r > self.exit_rsi).to_numpy(bool).copy()
            xs = (r < 100.0 - self.exit_rsi).to_numpy(bool).copy()
        elif self.exit == "tp":
            m = I.sma(c, self.exit_n)
            dist = (m - c).to_numpy()          # >0 for a long below the mean
            tp_l = np.where(dist > 0, dist, np.nan)
            tp_s = np.where(-dist > 0, -dist, np.nan)
            tp = np.where(L, tp_l, np.where(S, tp_s, tp))
            # a long needs a positive distance to its target (else skip the signal)
            L &= ~np.isnan(tp_l)
            S &= ~np.isnan(tp_s)
        elif self.exit != "none":
            raise ValueError(self.exit)
        # never open a trade whose exit condition is already met on the signal bar
        L &= ~xl
        S &= ~xs

        d["long_entry"] = L
        d["short_entry"] = S
        d["tp_dist"] = tp
        d["exit_long"] = xl
        d["exit_short"] = xs
        d["max_hold"] = int(self.max_hold or 0)
        return d


class MeanReversionDelayedD1(Strategy):
    """Same D1 rules, but every D1 decision is executed at the 01:00 server-time H1 open
    instead of at the 00:00 open (the daily rollover, where real spreads are several
    times wider than the cost model assumes).  Used as an execution-realism check and
    as the reference for the MT5 EA (act on the first tick after 01:00 server time).

    Mechanics: the D1 decision of the daily bar that closes at 00:00 is written onto
    the H1 bar that OPENS at 00:00 (it closes at 01:00, so the engine fills at 01:00).
    That H1 bar is later than the D1 close, so no future information is used.  The time
    stop is converted to H1 bars (24 per trading day).  OANDA data only (needs H1).
    """
    name = "mean_reversion_delayed_d1"
    tf = "H1"

    def __init__(self, **params):
        self._inner = MeanReversion(**{**params, "tf": "D1"})

    def params(self) -> dict:
        return {**self._inner.params(), "exec": "01:00"}

    def decisions(self, ctx) -> pd.DataFrame:
        dd = self._inner.decisions(ctx)
        h1 = ctx.bars("H1")
        d = empty_decisions(h1.index)
        # the D1 bar opening at day D closes at D+1 00:00; its decision is written onto
        # the first H1 bar opening at/after that close (normally D+1 00:00; Monday
        # 00:00 for a Friday bar), exactly the bar the engine would fill a D1 decision
        # at - but here it is filled one hour later, at that H1 bar's close.
        target = dd.index + TF_DURATION["D1"]
        pos = np.searchsorted(h1.index.values, target.values, side="left")
        ok = pos < len(h1)
        rows = pos[ok]
        for col in ["long_entry", "short_entry", "exit_long", "exit_short", "stop_dist",
                    "tp_dist"]:
            vals = dd[col].to_numpy()[ok]
            arr = d[col].to_numpy().copy()
            arr[rows] = vals
            d[col] = arr
        d["max_hold"] = int(self._inner.max_hold or 0) * 24
        return d
