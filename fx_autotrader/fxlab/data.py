"""Historical data loading and bar construction.

Sources (all public, see README):
  * OANDA 1-minute mid OHLC, 2005-01 .. 2020-05, UTC (github.com/FutureSharks/financial-data)
  * FRED H.10 daily noon buying rates, 1971 .. present (github.com/datasets/exchange-rates)

Bars are stamped in "server time" = New York time + 7h, i.e. GMT+2 in winter and
GMT+3 in US summer time.  This is the convention used by most MT4/MT5 brokers
(a daily candle closes at 17:00 New York), so indicators computed here match what
an Expert Advisor sees on the broker's charts.
"""
from __future__ import annotations

import glob
import os
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
M1_DIR = Path(os.environ.get("FXLAB_M1_DIR", "/home/user/fxdata/m1"))
OANDA_DIR = Path(os.environ.get(
    "FXLAB_OANDA_DIR",
    "/home/user/futuresharks/financial-data/pyfinancialdata/data/currencies/oanda"))
FRED_CSV = Path(os.environ.get(
    "FXLAB_FRED_CSV", "/home/user/datasets/exchange-rates/data/daily.csv"))

RAW_PAIRS = ["EURUSD", "GBPUSD", "AUDUSD", "USDCAD", "EURJPY", "AUDJPY", "XAUUSD"]

# Synthetic crosses built minute-by-minute from the raw OANDA pairs.
#   ("mul", a, b) -> a * b ;  ("div", a, b) -> a / b
SYNTHETIC = {
    "USDJPY": ("div", "EURJPY", "EURUSD"),
    "GBPJPY": ("mul", "GBPUSD", "USDJPY"),
    "CADJPY": ("div", "USDJPY", "USDCAD"),
    "EURGBP": ("div", "EURUSD", "GBPUSD"),
    "EURAUD": ("div", "EURUSD", "AUDUSD"),
    "GBPAUD": ("div", "GBPUSD", "AUDUSD"),
    "EURCAD": ("mul", "EURUSD", "USDCAD"),
    "AUDCAD": ("mul", "AUDUSD", "USDCAD"),
    "GBPCAD": ("mul", "GBPUSD", "USDCAD"),
}
ALL_PAIRS = RAW_PAIRS + list(SYNTHETIC)

SERVER_OFFSET = pd.Timedelta(hours=7)  # server time = New York + 7h


def _oanda_name(pair: str) -> str:
    return pair[:3] + "_" + pair[3:]


def load_oanda_m1_csv(pair: str) -> pd.DataFrame:
    files = sorted(glob.glob(str(OANDA_DIR / _oanda_name(pair) / "*" / "*.csv")))
    if not files:
        raise FileNotFoundError(f"no OANDA csv for {pair} under {OANDA_DIR}")
    frames = [pd.read_csv(f, usecols=["time", "open", "high", "low", "close", "volume"])
              for f in files]
    df = pd.concat(frames, ignore_index=True)
    df["time"] = pd.to_datetime(df["time"], utc=True)
    df = df.drop_duplicates("time").sort_values("time").set_index("time")
    return df[["open", "high", "low", "close", "volume"]].astype("float64")


def m1_path(pair: str) -> Path:
    return M1_DIR / f"{pair}_M1.parquet"


def load_m1(pair: str) -> pd.DataFrame:
    p = m1_path(pair)
    if p.exists():
        return pd.read_parquet(p)
    if pair in SYNTHETIC:
        df = build_synthetic_m1(pair)
    else:
        df = load_oanda_m1_csv(pair)
    M1_DIR.mkdir(parents=True, exist_ok=True)
    df.to_parquet(p)
    return df


def build_synthetic_m1(pair: str) -> pd.DataFrame:
    op, a, b = SYNTHETIC[pair]
    A, B = load_m1(a), load_m1(b)
    idx = A.index.intersection(B.index)
    A, B = A.loc[idx], B.loc[idx]
    if op == "mul":
        o, c = A.open * B.open, A.close * B.close
        hi = np.maximum.reduce([A.high * B.close, A.close * B.high, o, c])
        lo = np.minimum.reduce([A.low * B.close, A.close * B.low, o, c])
    else:
        o, c = A.open / B.open, A.close / B.close
        hi = np.maximum.reduce([A.high / B.close, A.close / B.low, o, c])
        lo = np.minimum.reduce([A.low / B.close, A.close / B.high, o, c])
    return pd.DataFrame({"open": o, "high": hi, "low": lo, "close": c,
                         "volume": np.minimum(A.volume, B.volume)}, index=idx)


def to_server_time(index: pd.DatetimeIndex) -> pd.DatetimeIndex:
    ny = index.tz_convert("America/New_York").tz_localize(None)
    return ny + SERVER_OFFSET


def resample_ohlc(m1: pd.DataFrame, rule: str) -> pd.DataFrame:
    """Resample UTC M1 bars into server-time bars labelled by bar open time."""
    df = m1.copy()
    df.index = to_server_time(df.index)
    # DST transitions can create duplicate/missing local stamps; keep first occurrence.
    df = df[~df.index.duplicated(keep="first")]
    agg = df.resample(rule, label="left", closed="left").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"})
    agg = agg.dropna(subset=["open"])
    # In server time the FX week runs Mon 00:00 .. Fri 24:00; drop weekend stubs.
    agg = agg[agg.index.dayofweek < 5]
    agg.index.name = "time"
    return agg


def bars_path(pair: str, tf: str) -> Path:
    return DATA_DIR / tf / f"{pair}_{tf}.parquet"


def load_bars(pair: str, tf: str = "H1") -> pd.DataFrame:
    """Load server-time OHLC bars. tf in {H1, H4, D1}."""
    p = bars_path(pair, tf)
    if not p.exists():
        raise FileNotFoundError(f"{p} missing - run scripts/build_data.py")
    return pd.read_parquet(p)


def load_fred_daily() -> pd.DataFrame:
    """FRED H.10 noon buying rates as market-convention quotes (one column per pair).

    The source file states every rate as foreign currency per USD; we invert the
    currencies that the FX market quotes against the USD (EUR, GBP, AUD, NZD).
    """
    raw = pd.read_csv(FRED_CSV)
    raw["Date"] = pd.to_datetime(raw["Date"])
    wide = raw.pivot_table(index="Date", columns="Country", values="Exchange rate")
    out = pd.DataFrame(index=wide.index)
    out["USDJPY"] = wide["Japan"]
    out["EURUSD"] = 1.0 / wide["Euro"]
    out["GBPUSD"] = 1.0 / wide["United Kingdom"]
    out["AUDUSD"] = 1.0 / wide["Australia"]
    out["NZDUSD"] = 1.0 / wide["New Zealand"]
    out["USDCAD"] = wide["Canada"]
    out["USDCHF"] = wide["Switzerland"]
    out["EURJPY"] = out["EURUSD"] * out["USDJPY"]
    out["GBPJPY"] = out["GBPUSD"] * out["USDJPY"]
    out["AUDJPY"] = out["AUDUSD"] * out["USDJPY"]
    out["CADJPY"] = out["USDJPY"] / out["USDCAD"]
    out["EURGBP"] = out["EURUSD"] / out["GBPUSD"]
    out["EURAUD"] = out["EURUSD"] / out["AUDUSD"]
    out["GBPAUD"] = out["GBPUSD"] / out["AUDUSD"]
    out["EURCAD"] = out["EURUSD"] * out["USDCAD"]
    out["AUDCAD"] = out["AUDUSD"] * out["USDCAD"]
    out["GBPCAD"] = out["GBPUSD"] * out["USDCAD"]
    return out.sort_index()


def fred_as_bars(pair: str, start=None, end=None) -> pd.DataFrame:
    """FRED close-only series shaped like OHLC bars (open=prev close, high/low=max/min).

    High/low are unknown for FRED data, so intrabar stop logic sees only the
    close-to-close path.  Use it for daily-strategy out-of-sample checks only.
    """
    s = load_fred_daily()[pair].dropna()
    if start is not None:
        s = s[s.index >= pd.Timestamp(start)]
    if end is not None:
        s = s[s.index <= pd.Timestamp(end)]
    o = s.shift(1).fillna(s)
    df = pd.DataFrame({"open": o, "high": np.maximum(o, s), "low": np.minimum(o, s),
                       "close": s, "volume": 0.0})
    df.index.name = "time"
    return df
