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

# Stock-index CFDs (Titan FX style names -> OANDA directory names)
INDEX_OANDA = {"US500": "SPX500_USD", "NAS100": "NAS100_USD", "JPN225": "JP225_USD",
               "UK100": "UK100_GBP", "FRA40": "FR40_EUR", "AUS200": "AU200_AUD",
               "US2000": "US2000_USD"}
INDICES = list(INDEX_OANDA)

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
ALL_SYMBOLS = ALL_PAIRS + INDICES

SERVER_OFFSET = pd.Timedelta(hours=7)  # server time = New York + 7h


def _oanda_name(pair: str) -> str:
    if pair in INDEX_OANDA:
        return INDEX_OANDA[pair]
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


BTC_DIR = Path(os.environ.get("FXLAB_BTC_DIR", "/home/user/fxdata/btc"))


def load_bitstamp_btc_m1() -> pd.DataFrame:
    """Bitstamp BTC/USD 1-minute bars (github.com/ff137/bitstamp-btcusd-minute-data):
    the 2012-2025 bulk file plus the daily-updated file.  The source fills missing minutes
    with flat zero-volume candles; those are dropped so gaps look like OANDA's."""
    files = [BTC_DIR / "btcusd_bitstamp_1min_2012-2025.csv.gz",
             BTC_DIR / "btcusd_bitstamp_1min_latest.csv"]
    frames = [pd.read_csv(f) for f in files if f.exists()]
    if not frames:
        raise FileNotFoundError(f"no Bitstamp BTC csv under {BTC_DIR}")
    df = pd.concat(frames, ignore_index=True)
    df = df[df["volume"] > 0]
    df["time"] = pd.to_datetime(df["timestamp"], unit="s", utc=True)
    df = df.drop_duplicates("time").sort_values("time").set_index("time")
    return df[["open", "high", "low", "close", "volume"]].astype("float64")


def load_m1(pair: str) -> pd.DataFrame:
    p = m1_path(pair)
    if p.exists():
        return pd.read_parquet(p)
    if pair == "BTCUSD":
        df = load_bitstamp_btc_m1()
    elif pair in SYNTHETIC:
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


PST_DIR = Path(os.environ.get(
    "FXLAB_PST_DIR", "/home/user/robcarver17/pysystemtrade/data/futures/adjusted_prices_csv"))
# symbol -> pysystemtrade back-adjusted futures series (daily-ish, 1975..2024-03)
PST_MAP = {"US500": "SP500", "NAS100": "NASDAQ", "UK100": "FTSE100", "FRA40": "CAC",
           "JPN225": "NIKKEI", "XAUUSD": "GOLD", "GER40": "DAX", "US2000": "RUSSELL"}


def _pst_daily_last(path: Path, col: int) -> pd.Series:
    df = pd.read_csv(path)
    t = pd.to_datetime(df.iloc[:, 0])
    x = pd.Series(pd.to_numeric(df.iloc[:, col], errors="coerce").to_numpy(float),
                  index=t).sort_index().dropna()
    x = x.groupby(x.index.normalize()).last()
    return x[x.index.dayofweek < 5]


def load_pst_daily(symbol: str) -> pd.Series:
    """Daily total-return series of the rolled future (pysystemtrade), ratio-adjusted.

    Back-adjusted (additive) futures prices keep point changes but distort early
    price LEVELS (e.g. S&P 500 shows 682 in 1982 instead of ~120), which breaks any
    percentage-based logic and notional-based costs.  We rebuild a multiplicative
    series: r_t = (A_t - A_{t-1}) / P_{t-1} with A = back-adjusted and P = the traded
    contract's actual price, anchored to the latest actual price.  The returns contain
    the futures carry (dividends minus financing), so backtests on this source must
    use carry_mode="futures"."""
    name = PST_MAP[symbol]
    adj = _pst_daily_last(PST_DIR / f"{name}.csv", 1)
    mp_path = PST_DIR.parent / "multiple_prices_csv" / f"{name}.csv"
    if not mp_path.exists():
        return adj
    px = _pst_daily_last(mp_path, 3)   # PRICE column
    j = pd.concat([adj, px], axis=1, keys=["a", "p"], sort=True).dropna()
    r = j["a"].diff() / j["p"].shift(1)
    r = r.fillna(0.0).clip(-0.5, 0.5)
    level = (1.0 + r).cumprod()
    level = level / level.iloc[-1] * j["p"].iloc[-1]
    return level


def pst_as_bars(symbol: str, wick_k: float = 1.0) -> pd.DataFrame:
    return synthetic_ohlc_from_closes(load_pst_daily(symbol), wick_k)


FRED_WICK_K = 1.0


def fred_as_bars(pair: str, start=None, end=None, wick_k: float = FRED_WICK_K) -> pd.DataFrame:
    """FRED close-only series shaped like OHLC bars.

    FRED has no intraday high/low.  Using only the close-to-close path would let
    stops survive intraday spikes (an optimistic bias found by the engine audit), so
    a pessimistic synthetic range is added from past data only:
        high = max(open, close) + k * m,  low = min(open, close) - k * m
    where m = 20-day EWM of |close - previous close|, lagged one day, and k = 1.0
    (calibrated on 2005-2020 OANDA daily bars: with k~1 stop/trail strategies score
    the same mean R on synthetic bars as on the true OHLC; see tests).
    """
    s = load_fred_daily()[pair].dropna()
    if start is not None:
        s = s[s.index >= pd.Timestamp(start)]
    if end is not None:
        s = s[s.index <= pd.Timestamp(end)]
    return synthetic_ohlc_from_closes(s, wick_k)


def synthetic_ohlc_from_closes(s: pd.Series, wick_k: float = FRED_WICK_K) -> pd.DataFrame:
    o = s.shift(1).fillna(s)
    m = (s - o).abs().ewm(span=20, adjust=False).mean().shift(1).bfill()
    df = pd.DataFrame({"open": o, "high": np.maximum(o, s) + wick_k * m,
                       "low": np.minimum(o, s) - wick_k * m, "close": s, "volume": 0.0})
    df.index.name = "time"
    return df
