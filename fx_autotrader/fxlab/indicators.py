"""Indicators.  Every function uses only data up to and including the current bar,
and the smoothing definitions match MetaTrader 5's built-ins (iMA, iATR, iRSI,
iBands, iADX-Wilder) so the EA reproduces the same values."""
from __future__ import annotations

import numpy as np
import pandas as pd


def sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n, min_periods=n).mean()


def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False, min_periods=n).mean()


def wilder(s: pd.Series, n: int) -> pd.Series:
    """Wilder smoothing (RMA), seeded with the first n-bar simple average."""
    x = s.to_numpy(dtype=float)
    out = np.full(len(x), np.nan)
    valid = np.where(~np.isnan(x))[0]
    if len(valid) < n:
        return pd.Series(out, index=s.index)
    first = valid[0]
    seed = first + n - 1
    out[seed] = np.nanmean(x[first:seed + 1])
    for i in range(seed + 1, len(x)):
        v = x[i]
        out[i] = out[i - 1] if np.isnan(v) else (out[i - 1] * (n - 1) + v) / n
    return pd.Series(out, index=s.index)


def true_range(df: pd.DataFrame) -> pd.Series:
    pc = df["close"].shift(1)
    tr = pd.concat([df["high"] - df["low"], (df["high"] - pc).abs(), (df["low"] - pc).abs()],
                   axis=1).max(axis=1)
    tr.iloc[0] = df["high"].iloc[0] - df["low"].iloc[0]
    return tr


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    """MT5 iATR = simple moving average of true range."""
    return sma(true_range(df), n)


def atr_wilder(df: pd.DataFrame, n: int = 14) -> pd.Series:
    return wilder(true_range(df), n)


def donchian_high(df: pd.DataFrame, n: int) -> pd.Series:
    return df["high"].rolling(n, min_periods=n).max()


def donchian_low(df: pd.DataFrame, n: int) -> pd.Series:
    return df["low"].rolling(n, min_periods=n).min()


def rsi(s: pd.Series, n: int = 14) -> pd.Series:
    d = s.diff()
    up = wilder(d.clip(lower=0), n)
    dn = wilder((-d).clip(lower=0), n)
    rs = up / dn.replace(0, np.nan)
    out = 100 - 100 / (1 + rs)
    return out.where(dn != 0, 100.0).where(up.notna())


def bollinger(s: pd.Series, n: int = 20, k: float = 2.0):
    m = sma(s, n)
    sd = s.rolling(n, min_periods=n).std(ddof=0)
    return m - k * sd, m, m + k * sd


def adx(df: pd.DataFrame, n: int = 14) -> pd.Series:
    up = df["high"].diff()
    dn = -df["low"].diff()
    pdm = pd.Series(np.where((up > dn) & (up > 0), up, 0.0), index=df.index)
    ndm = pd.Series(np.where((dn > up) & (dn > 0), dn, 0.0), index=df.index)
    tr = wilder(true_range(df), n)
    pdi = 100 * wilder(pdm, n) / tr
    ndi = 100 * wilder(ndm, n) / tr
    dx = 100 * (pdi - ndi).abs() / (pdi + ndi).replace(0, np.nan)
    return wilder(dx, n)


def realized_vol(s: pd.Series, n: int) -> pd.Series:
    return np.log(s).diff().rolling(n, min_periods=n).std()
