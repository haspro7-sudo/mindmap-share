"""cross_sectional - cross-sectional currency strategies (research family ``cross_sectional``).

Idea: rank the six currencies USD EUR JPY GBP AUD CAD against each other and trade
the pairs that go long the strongest-ranked currencies against the weakest-ranked
ones, rebalancing weekly or monthly.  The 16-symbol research universe contains all
C(6,2) = 15 pairs of these currencies, so every (strong, weak) combination is
tradeable as exactly one symbol (XAUUSD is never traded by this family).

Currency value
    x_c(t) = log value of one unit of currency c in USD, from the D1 closes of the
    five USD pairs (EURUSD, GBPUSD, AUDUSD -> +log;  USDJPY, USDCAD -> -log;  USD = 0).
    Ranking by any linear price score (return, distance from a moving average) is
    identical whether x is measured in USD or against an equal-weight basket, because
    the basket term is common to all currencies at a given date.  The risk-adjusted
    momentum uses basket-relative daily returns r_c = dx_c - mean_j dx_j for its vol.

Scores (higher = stronger / to be bought)
    mom     x(t - skip) - x(t - L)                       time-series change over L days
    rev     -(x(t) - x(t - L))                           short-term reversal
    vmom    basket-relative change over L / (std of daily basket-relative returns * sqrt(L))
    value   -(x(t) - SMA_L(x))       (value_mode="sma")  5-year mean reversion of the level
            -(x(t) - x(t - L))       (value_mode="ret")
    carry   policy rate of the PREVIOUS calendar year (instruments.policy_rate, plus a
            2004 row defined here) - never the current year's average.  Unavailable
            (NaN) before 2005 decisions of the FRED pre-sample, i.e. carry cannot be
            tested on 1976-2004 data.
    combo   equal-weight average of the cross-sectional z-scores of the listed
            components (components that are NaN at a date are skipped).  A component
            may carry its own lookback, e.g. ("mom21", "mom63", "mom126", "mom252") is a
            momentum ensemble; a bare "mom" uses ``lookback``.

Selection at each rebalance (first D1 bar of a new week "W" / month "M", or every bar
"D"; decided from the bar's own date and the previous bar's date only)
    top-k currencies and bottom-k currencies by score (ties: fixed order USD, EUR, JPY,
    GBP, AUD, CAD).  pair base/quote -> target +1 if base in top-k and quote in bottom-k,
    -1 if base in bottom-k and quote in top-k, else 0.  k is reduced to n//2 when fewer
    than 2k currencies have a score (e.g. EUR before 1999 on FRED).

Orders (per symbol, D1 decision at the bar close; the engine executes at the next
execution bar and moves rollover-hour fills to 01:00 server time)
    rebalance bar:  target +1 -> buy (kept if already long), target -1 -> sell,
                    exit_mode="rank": close any position whose target is no longer its side
                    exit_mode="sign": close a long only when score(base) <= score(quote)
                                      (a short when score(base) >= score(quote))
                    exit_mode="buffer": close a long only when base drops out of the
                                      top-(k+1) or quote out of the bottom-(k+1)
    other bars:     nothing, unless reenter=True (re-enter the last rebalance target
                    after a stop-out)
    every trade:    initial stop = stop_atr * ATR(atr_n) (MT5 iATR), optional chandelier
                    trail = trail_atr * ATR.  No averaging, no grid.

No look-ahead: the score at bar t uses closes <= t only (the cross-section panel is
reindexed onto each symbol's bars with a forward fill), the rebalance flag uses the
calendar dates of bars t and t-1 only, carry uses year(t) - 1.

History before the OANDA data (2005-01-03) is spliced from FRED daily closes so that
long lookbacks (12 months, 5 years) are defined from the first IS bar; FRED values
dated on/after the first OANDA bar are never used on the OANDA source.

FRED source: bars are close-only with a synthetic range (data.fred_as_bars), whose
ATR(20) is ~1.47x the true ATR (median OANDA/FRED ratio 0.68 over the 15 pairs,
range 0.65-0.72, measured on the IS overlap 2005-06..2014-12).  Stops on FRED use
ATR * FRED_ATR_SCALE so stop distances are comparable in price terms (data
calibration only, not tuned on performance).
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np
import pandas as pd

from .. import data as D
from .. import indicators as I
from ..backtest import _bars
from ..instruments import policy_rate
from .base import Strategy, empty_decisions

CCYS = ("USD", "EUR", "JPY", "GBP", "AUD", "CAD")
# currency -> (USD pair, sign of log price giving the currency's USD value)
USD_PAIRS = {"EUR": ("EURUSD", 1.0), "GBP": ("GBPUSD", 1.0), "AUD": ("AUDUSD", 1.0),
             "JPY": ("USDJPY", -1.0), "CAD": ("USDCAD", -1.0)}
FRED_ATR_SCALE = 0.68
# 2004 annual-average policy rates (%), used only as the lagged carry input for 2005
# decisions (instruments._RATES starts in 2005).  Fed funds avg 1.35, ECB 2.0, BoJ 0,
# BoE avg 4.4, RBA 5.25, BoC avg 2.25.
RATES_2004 = {"USD": 1.35, "EUR": 2.0, "JPY": 0.0, "GBP": 4.4, "AUD": 5.25, "CAD": 2.25}
SIGNALS = ("mom", "rev", "vmom", "value", "carry", "combo")


# ------------------------------------------------------------------ data panel
@lru_cache(maxsize=None)
def _fred_closes() -> pd.DataFrame:
    return D.load_fred_daily()


@lru_cache(maxsize=None)
def currency_panel(source: str) -> pd.DataFrame:
    """x_c(t) = log USD value of each currency on a common daily index (USD = 0).

    Columns follow CCYS.  NaN where a currency has no data (EUR before 1999 on FRED).
    """
    cols = {}
    for ccy, (pair, sgn) in USD_PAIRS.items():
        if source == "oanda":
            o = _bars("oanda", pair, "D1")["close"]
            f = _fred_closes()[pair].dropna()
            f = f[f.index < o.index[0]]           # only history before the OANDA data
            s = pd.concat([f, o])
        elif source == "fred":
            s = _fred_closes()[pair].dropna()
        else:
            raise ValueError(source)
        cols[ccy] = sgn * np.log(s)
    px = pd.DataFrame(cols).sort_index()
    # forward fill short holiday gaps only (a currency that has not started stays NaN)
    px = px.ffill(limit=5)
    px.insert(0, "USD", 0.0)
    return px[list(CCYS)]


def _lagged_carry(index: pd.DatetimeIndex) -> pd.DataFrame:
    years = index.year - 1
    out = {}
    for c in CCYS:
        vals = np.full(len(index), np.nan)
        for y in np.unique(years):
            m = years == y
            if y >= 2005:
                vals[m] = policy_rate(c, int(y))
            elif y == 2004:
                vals[m] = RATES_2004[c]
        out[c] = vals
    return pd.DataFrame(out, index=index)


def _zscore_rows(df: pd.DataFrame) -> pd.DataFrame:
    mu = df.mean(axis=1)
    sd = df.std(axis=1, ddof=0)
    return df.sub(mu, axis=0).div(sd.where(sd > 0), axis=0)


# ------------------------------------------------------------------ strategy
class CrossSectional(Strategy):
    name = "cross_sectional"
    tf = "D1"

    def __init__(self, signal="mom", lookback=63, skip=0, value_n=1260, value_mode="sma",
                 vol_n=63, components=("carry", "mom", "value"), k=1, rebalance="M",
                 exit_mode="rank", reenter=False, stop_atr=3.0, atr_n=20, trail_atr=0.0):
        if signal not in SIGNALS:
            raise ValueError(signal)
        if rebalance not in ("D", "W", "M"):
            raise ValueError(rebalance)
        if exit_mode not in ("rank", "sign", "buffer"):
            raise ValueError(exit_mode)
        self.signal = signal
        self.lookback = int(lookback)
        self.skip = int(skip)
        self.value_n = int(value_n)
        self.value_mode = value_mode
        self.vol_n = int(vol_n)
        self.components = tuple(components)
        self.k = int(k)
        self.rebalance = rebalance
        self.exit_mode = exit_mode
        self.reenter = bool(reenter)
        self.stop_atr = float(stop_atr)
        self.atr_n = int(atr_n)
        self.trail_atr = float(trail_atr)
        self._cache: dict = {}

    def params(self) -> dict:
        p = super().params()
        p["components"] = list(self.components)
        return p

    # ---------------------------------------------------------------- scores
    def _component(self, name: str, px: pd.DataFrame) -> pd.DataFrame:
        L = self.lookback
        base = name.rstrip("0123456789")
        if base != name:              # e.g. "mom63": component with its own lookback
            L = int(name[len(base):])
            name = base
        if name == "mom":
            return px.shift(self.skip) - px.shift(L)
        if name == "rev":
            return -(px - px.shift(L))
        if name == "vmom":
            dx = px.diff()
            rb = dx.sub(dx.mean(axis=1), axis=0).where(dx.notna())
            xb = rb.fillna(0.0).cumsum().where(px.notna())
            vol = rb.rolling(self.vol_n, min_periods=self.vol_n).std()
            return (xb - xb.shift(L)) / (vol * np.sqrt(L))
        if name == "value":
            if self.value_mode == "sma":
                return -(px - px.rolling(self.value_n, min_periods=self.value_n).mean())
            return -(px - px.shift(self.value_n))
        if name == "carry":
            return _lagged_carry(px.index).where(px.notna())
        raise ValueError(name)

    def scores(self, source: str) -> pd.DataFrame:
        key = ("scores", source)
        if key not in self._cache:
            px = currency_panel(source)
            if self.signal == "combo":
                zs = [_zscore_rows(self._component(c, px)) for c in self.components]
                stack = np.stack([z.to_numpy() for z in zs])
                with np.errstate(invalid="ignore"):
                    sc = np.nanmean(stack, axis=0) if len(zs) > 1 else stack[0]
                s = pd.DataFrame(sc, index=px.index, columns=px.columns)
            else:
                s = self._component(self.signal, px)
            self._cache[key] = s
        return self._cache[key]

    def targets(self, source: str, extra: int = 0) -> pd.DataFrame:
        """Per-currency selection: +1 top-k, -1 bottom-k, 0 otherwise (per panel date).
        extra > 0 widens the selection to top/bottom-(k+extra) (buffer exit)."""
        key = ("targets", source, extra)
        if key not in self._cache:
            s = self.scores(source)
            n = s.notna().sum(axis=1)
            k_eff = np.minimum(self.k, n // 2)
            if extra:
                k_eff = np.where(k_eff >= 1, np.minimum(k_eff + extra, n // 2), 0)
                k_eff = pd.Series(k_eff, index=s.index)
            # ties broken by the fixed column order (rank method "first")
            hi = s.rank(axis=1, ascending=False, method="first")
            lo = s.rank(axis=1, ascending=True, method="first")
            top = hi.le(k_eff, axis=0) & s.notna()
            bot = lo.le(k_eff, axis=0) & s.notna()
            sel = top.astype(int) - bot.astype(int)
            sel[k_eff < 1] = 0
            self._cache[key] = sel
        return self._cache[key]

    # ------------------------------------------------------------- decisions
    @staticmethod
    def _rebalance_flags(index: pd.DatetimeIndex, rule: str) -> np.ndarray:
        if rule == "D":
            f = np.ones(len(index), bool)
            f[0] = False
            return f
        if rule == "W":
            per = (index.normalize() - pd.to_timedelta(index.dayofweek, unit="D")).values
        else:
            per = (index.year * 12 + index.month).values
        f = np.zeros(len(index), bool)
        f[1:] = per[1:] != per[:-1]
        return f

    def decisions(self, ctx) -> pd.DataFrame:
        src = getattr(ctx, "source", "oanda")
        sym = ctx.symbol
        base, quote = sym[:3], sym[3:]
        b = ctx.bars(self.tf)
        d = empty_decisions(b.index)
        if base not in CCYS or quote not in CCYS:
            return d  # e.g. XAUUSD: not part of this family

        sel = self.targets(src)
        tgt_ccy = sel.reindex(b.index, method="ffill")
        long_t = (tgt_ccy[base] == 1) & (tgt_ccy[quote] == -1)
        short_t = (tgt_ccy[base] == -1) & (tgt_ccy[quote] == 1)
        tgt = pd.Series(np.where(long_t, 1, np.where(short_t, -1, 0)), index=b.index)

        reb = pd.Series(self._rebalance_flags(b.index, self.rebalance), index=b.index)
        le = reb & (tgt == 1)
        se = reb & (tgt == -1)
        if self.exit_mode == "rank":
            xl = reb & (tgt != 1)
            xs = reb & (tgt != -1)
        elif self.exit_mode == "sign":
            s = self.scores(src).reindex(b.index, method="ffill")
            diff = s[base] - s[quote]
            xl = reb & (tgt != 1) & ~(diff > 0)
            xs = reb & (tgt != -1) & ~(diff < 0)
        else:  # buffer: keep while still inside top/bottom-(k+1)
            wide = self.targets(src, extra=1).reindex(b.index, method="ffill")
            keep_l = (wide[base] == 1) & (wide[quote] == -1)
            keep_s = (wide[base] == -1) & (wide[quote] == 1)
            xl = reb & (tgt != 1) & ~keep_l
            xs = reb & (tgt != -1) & ~keep_s
        if self.reenter:
            held = tgt.where(reb).ffill().fillna(0)
            le = le | (~reb & (held == 1))
            se = se | (~reb & (held == -1))

        a = I.atr(b, self.atr_n)
        if src == "fred":
            a = a * FRED_ATR_SCALE
        d["long_entry"] = le.to_numpy(bool)
        d["short_entry"] = se.to_numpy(bool)
        d["exit_long"] = xl.to_numpy(bool)
        d["exit_short"] = xs.to_numpy(bool)
        d["stop_dist"] = self.stop_atr * a
        if self.trail_atr > 0:
            d["trail_dist"] = self.trail_atr * a
        return d
