"""Audit of the user's Feb-Mar 2026 YagamiBot backtests (やがみ式 v2 strategy.py / v3 MTF backtester).

    python scripts/yagami_past_audit.py            # all runs + trial log + trades + report
    python scripts/yagami_past_audit.py --report   # rebuild the report from the cached runs
    python scripts/yagami_past_audit.py --only EURUSD   # quick run of one symbol (no report)

What is reproduced (source files from the user's Google Drive folder YagamiBot):
  * v2 signal = yagami_bot/strategy.py check_signal + config.py (identical to backtest_v3.py
    generate_signals): H1 trend = SMA12 vs SMA48 of closes; "double bottom" = this bar's low
    within DOUBLE_TOLERANCE (1.5%) of the lowest low of bars i-30..i-5 and the bar is bullish
    or has a lower wick > body (mirror for tops); SL = lowest low of the last 10 bars
    (incl. this bar), TP = entry + 2 x SL distance, skip if SL distance is outside
    0.3..3.0 x ATR14; entry = the signal bar's close; time-out 30 bars; 3 losses a day stop.
  * the Feb "engine" = backtest_v3.py run_backtest (also used, judging by identical outputs,
    for the timeframe / real-cost / v2 position-management reports): every signal bar is a
    separate, overlapping trade; outcomes scanned on the following H1 bars (SL before TP);
    the daily 3-loss stop is applied in signal order using the outcomes of earlier signals
    that may only be known hours later (look-ahead).
  * v3 signal + engine = backtest_v3_mtf.py (Mar 2026): confirmed swing points (5 bars each
    side) inside 40 bars, two lows within 2% = double bottom, previous bar colour, 7-item PA
    score >= 2 (+1 range), SL = the double-bottom low, TP = 3R, exits SL/TP/48 bars/trend flip,
    one position at a time, 3 losses a day (by exit day), cost 0.05% of price per trade; the
    first bar after entry is never checked for SL/TP (bug).

Engines used here:
  feb_*     H1-bar replica of the user's engines (fills at the signal bar close, no spread)
  c1 v2_live       v2 signals as the live bot trades them (main.py): one position per symbol,
                   SL/TP, time-out 30 wall-clock hours, exit on an opposite signal, 3 realised
                   losses per JST day stop; fxlab.scalp fills (next M1 open, bid/ask, costs)
  c2 v2_all        every v2 signal as its own trade (what backtest_v3.py meant to measure):
                   overlapping, 30-bar time-out, causal 3-loss day stop; fxlab.scalp fills
  c3 v3_h1         the Mar backtester's v3 signals, one position, 48-bar / trend-flip exits,
                   causal 3-loss stop; fxlab.scalp fills
Per-signal outcomes come from scalp.simulate on signals partitioned so that no two in a call
can overlap (bar position mod 31/49); position limits and the day stop are then applied
chronologically (this reproduces simulate's own one-position rule exactly).

Data: OANDA M1 2005-01..2020-05-14 (EURUSD, EURJPY, AUDJPY, XAUUSD raw; USDJPY synthetic =
flagged secondary), Bitstamp BTC/USD M1 2013-01..2026-09-25.  Periods and the survival rule
follow the lab protocol (IS picks nothing here: all parameters are the user's own).
"""
from __future__ import annotations

import argparse
import heapq
import json
import math
import os
import pickle
import sys
import time
from pathlib import Path

import numba as nb
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fxlab import scalp  # noqa: E402
from fxlab.instruments import INSTRUMENTS  # noqa: E402
from fxlab.research import TrialLog  # noqa: E402

KEY = "past_audit"
FAMILY = f"yagami_{KEY}"
LOG = TrialLog(FAMILY)
OUT_DIR = ROOT / "reports" / "yagami"
REPORT = OUT_DIR / "past_backtest_audit.md"
CACHE = scalp.D.M1_DIR.parent / "cache" / f"yagami_{KEY}.pkl"

# ------------------------------------------------------------------ the user's parameters
V2 = dict(MA_TREND=48, MA_SHORT=12, SWING_LOOKBACK=10, DOUBLE_BOTTOM_LOOKBACK=30,
          HORIZONTAL_LOOKBACK=5, ATR_PERIOD=14, ATR_SL_MIN=0.3, ATR_SL_MAX=3.0,
          DOUBLE_TOLERANCE=0.015, RR_RATIO=2.0, MAX_HOLD_CANDLES=30, MAX_DAILY_LOSSES=3)
V3 = dict(rr_ratio=3.0, ma_trend=48, ma_short=12, atr_period=14, swing_period=10,
          db_lookback=40, db_tolerance=0.02, min_swing_dist=5, range_period=12,
          range_atr_mult=1.5, min_range_bars=6, atr_sl_min=0.3, atr_sl_max=4.0, min_score=2,
          max_hold_bars=48, max_daily_loss=3, spread_cost_pct=0.05)

FX_MAIN = ["EURUSD", "EURJPY", "AUDJPY", "XAUUSD"]      # raw OANDA data (pooled verdict)
FX_SYN = ["USDJPY"]                                     # synthetic cross: flagged secondary
BTC = "BTCUSD"
SYMBOLS = FX_MAIN + FX_SYN + [BTC]

P_FX = dict(load_start=None, start="2005-01-01", is_end="2015-01-01", end="2020-05-15")
P_BTC = dict(load_start="2012-10-01", start="2013-01-01", is_end="2020-01-01", end="2026-09-26")
FEB_WIN = ("2024-02-28", "2026-02-27")        # the user's yfinance 1h window (BTC-USD)
BTC15_WIN = ("2025-12-29", "2026-02-27")      # the user's 60-day 15m window
CEX_MULT = 11.0 / 6.0     # BTC exchange-like: spread 4 + slip 2 bps x 1.83 = 11 bps round trip
CANDS = ["v2_live", "v2_all", "v3_h1"]

# What the user's reports said (for the comparison tables)
USER = {
    "tf_1h": {  # やがみ式_時間足比較レポート / backtest_timeframe_results.json (no costs)
        "USDJPY": (3772, 50.7, 2.03, "2023-05-12..2026-02-26"),
        "EURJPY": (3871, 49.9, 1.78, "2023-05-12..2026-02-26"),
        "EURUSD": (3447, 42.8, 1.41, "2023-05-12..2026-02-26"),
        "XAUUSD": (2796, 46.6, 1.84, "2023-10-05..2026-02-26 (GC=F)"),
        "BTCUSD": (1939, 42.8, 1.44, "2024-02-28..2026-02-26"),
    },
    "cost_1h": {  # 実コスト込みバックテスト結果 (realistic scenario)
        "USDJPY": (3741, 50.3, 1.74), "XAUUSD": (2736, 45.1, 1.33), "BTCUSD": (1920, 41.9, 1.25),
    },
    "v2_signals": {  # backtest_v2_results.json: signals / bars / v1 trades
        "USDJPY": (8436, 17139, 3729), "XAUUSD": (5473, 13706, 2625), "BTCUSD": (3178, 17477, 1920),
    },
    "btc_15m": (308, 43.8, 1.69, "2025-12-29..2026-02-26"),
    "v3_mar": {  # backtest_v3_mtf_results.json (RR 3, cost 0.05%)
        "USDJPY": (335, 30.7, 0.77), "EURUSD": (369, 28.7, 0.66), "EURJPY": (361, 29.9, 0.71),
        "AUDJPY": (397, 29.2, 0.61), "XAUUSD": (312, 29.2, 0.85), "BTCUSD": (468, 33.1, 1.04),
    },
}


def periods(sym: str) -> dict:
    return P_BTC if sym == BTC else P_FX


def pip(sym: str) -> float:
    return INSTRUMENTS[sym].pip


# ------------------------------------------------------------------ v2 signals (strategy.py)
def v2_signals(b: pd.DataFrame, P: dict = V2) -> pd.DataFrame:
    """Vectorised strategy.check_signal for every closed bar (row = decision bar)."""
    o, h, l, c = (b[k] for k in ("open", "high", "low", "close"))
    n = len(b)
    pos = np.arange(n)
    body = (c - o).abs()
    up = h - np.maximum(o, c)
    lw = np.minimum(o, c) - l
    bull = (c > o).to_numpy()
    ma_t = c.rolling(P["MA_TREND"]).mean()
    ma_s = c.rolling(P["MA_SHORT"]).mean()
    trend = np.where(ma_s > ma_t, 1, np.where(ma_s < ma_t, -1, 0))
    sw_lo = l.rolling(P["SWING_LOOKBACK"]).min()
    sw_hi = h.rolling(P["SWING_LOOKBACK"]).max()
    pc = c.shift(1)
    tr = np.maximum(h - l, np.maximum((h - pc).abs(), (l - pc).abs()))
    atr = tr.rolling(P["ATR_PERIOD"]).mean().to_numpy()
    L = P["DOUBLE_BOTTOM_LOOKBACK"]
    w = L - 5 + 1                                   # lows[i-L .. i-5] (lows[:-5] of L+1 bars)
    min_prev = l.rolling(w).min().shift(5)
    max_prev = h.rolling(w).max().shift(5)
    tol = P["DOUBLE_TOLERANCE"]
    near_lo = ((l - min_prev).abs() <= min_prev * tol).to_numpy() & (pos >= L)
    near_hi = ((h - max_prev).abs() <= max_prev * tol).to_numpy() & (pos >= L)
    db = near_lo & (bull | (lw > body).to_numpy())
    dt = near_hi & (~bull | (up > body).to_numpy())
    d = np.where((trend == 1) & db, 1, np.where((trend == -1) & dt, -1, 0))
    cc = c.to_numpy()
    sl_px = np.where(d > 0, sw_lo.to_numpy(), sw_hi.to_numpy())
    dist = d * (cc - sl_px)
    with np.errstate(invalid="ignore", divide="ignore"):
        ratio = dist / atr
        atr_pos = atr > 0
        ok = (d != 0) & (dist > 0) & (pos >= 50) & \
            (~atr_pos | ((ratio >= P["ATR_SL_MIN"]) & (ratio <= P["ATR_SL_MAX"])))
    # score (informational, as in the bot): +1 pattern, +1 horizontal, +1 strength>=5, +1 RR
    rng6 = (h.rolling(P["HORIZONTAL_LOOKBACK"] + 1).max()
            - l.rolling(P["HORIZONTAL_LOOKBACK"] + 1).min()).to_numpy()
    with np.errstate(invalid="ignore"):
        hz = (rng6 < atr * 1.5) & (atr > 0)
    bd, u, lo = body.to_numpy(), up.to_numpy(), lw.to_numpy()
    tot = bd + u + lo
    with np.errstate(invalid="ignore", divide="ignore"):
        br = np.where(tot > 0, bd / tot, 0.0)
    wick = np.where(bull, lo, u)
    strength = np.select([tot == 0, (br > 0.8) & (wick < bd * 0.1), br > 0.7, br > 0.5, br > 0.3,
                          wick > bd * 2], [1, 7, 6, 5, 4, 3], 2)
    k = np.flatnonzero(ok)
    out = pd.DataFrame({
        "p": k, "dir": d[k].astype(np.int64), "entry": cc[k], "sl_px": sl_px[k],
        "sl_dist": dist[k], "tp_px": cc[k] + d[k] * dist[k] * P["RR_RATIO"],
        "score": 2 + hz[k].astype(int) + (strength[k] >= 5).astype(int),
        "strength": strength[k]}, index=b.index[k])
    diag = {"bars": n, "trend_up": int((trend == 1).sum()), "trend_dn": int((trend == -1).sum()),
            "near_lo_given_up": float(near_lo[trend == 1].mean()),
            "near_hi_given_dn": float(near_hi[trend == -1].mean()),
            "db_given_up": float(db[trend == 1].mean()), "dt_given_dn": float(dt[trend == -1].mean()),
            "tol_px_median": float(np.nanmedian((min_prev * tol).to_numpy())),
            "range30_px_median": float(np.nanmedian(
                (h.rolling(L + 1).max() - l.rolling(L + 1).min()).to_numpy())),
            "sl_px_median": float(np.median(dist[k])) if len(k) else float("nan"),
            "atr_median": float(np.nanmedian(atr)),
            "raw_pattern_bars": int(((trend == 1) & db).sum() + ((trend == -1) & dt).sum()),
            "signals": int(len(k))}
    return out, diag


# ------------------------------------------------------------------ Feb engine (H1 replica)
@nb.njit(cache=True)
def _bar_outcomes(h, l, c, p, d, slp, tpp, maxhold):
    """backtest_v3.run_backtest trade scan: bars p+1..p+maxhold, SL before TP, else close of
    bar p+maxhold (dropped when that bar does not exist).  reason 1 TP 2 SL 3 time 0 none."""
    n = c.shape[0]
    m = p.shape[0]
    xp = np.full(m, np.nan)
    xb = np.full(m, -1)
    rs = np.zeros(m, np.int8)
    for k in range(m):
        i = p[k]
        done = False
        for j in range(i + 1, min(i + maxhold + 1, n)):
            if d[k] > 0:
                if l[j] <= slp[k]:
                    xp[k], xb[k], rs[k], done = slp[k], j, 2, True
                    break
                if h[j] >= tpp[k]:
                    xp[k], xb[k], rs[k], done = tpp[k], j, 1, True
                    break
            else:
                if h[j] >= slp[k]:
                    xp[k], xb[k], rs[k], done = slp[k], j, 2, True
                    break
                if l[j] <= tpp[k]:
                    xp[k], xb[k], rs[k], done = tpp[k], j, 1, True
                    break
        if not done and i + maxhold < n:
            xp[k], xb[k], rs[k] = c[i + maxhold], i + maxhold, 3
    return xp, xb, rs


def approx_cost_pct(sym: str, entry: np.ndarray, is_sl: np.ndarray, nights: np.ndarray) -> np.ndarray:
    """Round-trip Titan-like cost in % of price for the H1 replicas (no hour multipliers)."""
    inst = INSTRUMENTS[sym]
    if inst.cost_in_bps:
        bps = inst.spread_pips + 2 * inst.slip_pips + inst.stop_slip_pips * is_sl \
            + inst.carry_bps_per_day * nights
        return bps / 100.0
    pips = inst.spread_pips + 2 * inst.slip_pips + inst.stop_slip_pips * is_sl \
        + scalp.commission_pips(sym)
    return pips * inst.pip / entry * 100.0


def feb_outcomes(sym: str, b: pd.DataFrame, sig: pd.DataFrame, maxhold: int = 30) -> pd.DataFrame:
    h, l, c = (b[k].to_numpy(float) for k in ("high", "low", "close"))
    xp, xb, rs = _bar_outcomes(h, l, c, sig.p.to_numpy(np.int64), sig.dir.to_numpy(np.int64),
                               sig.sl_px.to_numpy(float), sig.tp_px.to_numpy(float), maxhold)
    out = sig.copy()
    out["xp"], out["xb"], out["reason"] = xp, xb, rs
    out = out[rs > 0].copy()
    out["pnl0"] = out.dir * (out.xp - out.entry) / out.entry * 100.0          # % of price
    days = b.index.as_unit("ns").normalize().asi8 // 86_400_000_000_000
    out["day"] = days[out.p.to_numpy()]
    out["xday"] = days[out.xb.to_numpy()]
    nights = (out.xday - out.day).to_numpy()
    out["cost"] = approx_cost_pct(sym, out.entry.to_numpy(), (out.reason == 2).to_numpy().astype(float),
                                  nights)
    out["sl_pct"] = out.sl_dist / out.entry * 100.0
    return out


def feb_select(o: pd.DataFrame, mode: str, loss_col: str, one_pos: bool = False,
               maxl: int = 3) -> np.ndarray:
    """Which signals the engine trades.
    lookahead = backtest_v3.run_backtest: in signal order, per signal date, stop after 3
                LOSE results of earlier signals of that date, whenever those were realised
    causal    = only losses already realised (exit bar <= decision bar), counted by exit day
    none      = every signal"""
    p = o.p.to_numpy()
    xb = o.xb.to_numpy()
    loss = (o[loss_col] < 0).to_numpy()
    day, xday = o.day.to_numpy(), o.xday.to_numpy()
    n = len(o)
    keep = np.zeros(n, bool)
    if mode == "lookahead":
        last, dl = None, 0
        for k in range(n):
            if day[k] != last:
                last, dl = day[k], 0
            if dl >= maxl:
                continue
            keep[k] = True
            if loss[k]:
                dl += 1
        return keep
    heap: list = []
    cnt: dict = {}
    busy = -1
    for k in range(n):
        while heap and heap[0][0] <= p[k]:
            _, lo, dd = heapq.heappop(heap)
            if lo:
                cnt[dd] = cnt.get(dd, 0) + 1
        if mode == "causal" and cnt.get(day[k], 0) >= maxl:
            continue
        if one_pos and p[k] < busy:
            continue
        keep[k] = True
        heapq.heappush(heap, (xb[k], bool(loss[k]), xday[k]))
        busy = max(busy, xb[k])
    return keep


def pf(x) -> float:
    x = np.asarray(x, float)
    lo = -x[x < 0].sum()
    return float(x[x > 0].sum() / lo) if lo > 0 else float("inf")


def feb_stats(o: pd.DataFrame, pnl_col: str, n_bars: int | None = None) -> dict:
    if not len(o):
        return {"n": 0}
    x = o[pnl_col].to_numpy()
    R = x / o.sl_pct.to_numpy()
    s = {"n": int(len(o)), "win": float((x > 0).mean()), "pf": pf(x), "avg_pct": float(x.mean()),
         "sum_pct": float(x.sum()), "avg_R": float(R.mean()), "pf_R": pf(R),
         "t_R": float(R.mean() / R.std(ddof=1) * math.sqrt(len(R))) if len(R) > 2 else float("nan"),
         "long_share": float((o.dir > 0).mean())}
    if n_bars:
        s["open_avg"] = float((o.xb - o.p).sum() / n_bars)     # mean number of open positions
    return s


def in_window(idx: pd.DatetimeIndex, a, b) -> np.ndarray:
    return (idx >= pd.Timestamp(a)) & (idx < pd.Timestamp(b))


# ------------------------------------------------------------------ v3 (backtest_v3_mtf.py)
@nb.njit(cache=True)
def _v3_double(arr, idx, period, lookback, min_dist, tol, is_low):
    """find_swing_lows/highs + detect_double_bottom/top: up to 6 most recent confirmed swings
    among bars idx-period-1 .. max(idx-lookback, period)+1; first pair >= min_dist bars apart
    within tol -> the extreme of the pair, else NaN."""
    n = arr.shape[0]
    pv = np.zeros(6)
    pb = np.zeros(6, np.int64)
    cnt = 0
    stop = max(idx - lookback, period)
    i = idx - period - 1
    while i > stop:
        if i - period >= 0 and i + period < n:
            v = arr[i]
            ok = True
            for j in range(1, period + 1):
                if is_low:
                    if arr[i - j] < v or arr[i + j] < v:
                        ok = False
                        break
                else:
                    if arr[i - j] > v or arr[i + j] > v:
                        ok = False
                        break
            if ok:
                pv[cnt] = v
                pb[cnt] = i
                cnt += 1
                if cnt >= 6:
                    break
        i -= 1
    for a in range(cnt):
        for bb in range(a + 1, cnt):
            if abs(pb[a] - pb[bb]) < min_dist:
                continue
            avg = (pv[a] + pv[bb]) / 2.0
            if avg > 0 and abs(pv[a] - pv[bb]) / avg <= tol:
                return min(pv[a], pv[bb]) if is_low else max(pv[a], pv[bb])
    return np.nan


@nb.njit(cache=True)
def _v3_rev(o, h, l, c, p, d):
    body = abs(c[p] - o[p])
    rng = h[p] - l[p]
    if rng <= 0 or body / rng < 0.2:
        return False
    return c[p] > o[p] if d == 1 else c[p] < o[p]


@nb.njit(cache=True)
def _v3_pa(o, h, l, c, idx, d):
    if idx < 3:
        return 0
    s = 0
    o1, c1, h1, l1 = o[idx - 1], c[idx - 1], h[idx - 1], l[idx - 1]
    body1 = abs(c1 - o1)
    range1 = h1 - l1
    if (d == 1 and c1 > o1) or (d == -1 and c1 < o1):
        s += 1
    if range1 > 0 and body1 > 0:
        if d == 1:
            lw = min(o1, c1) - l1
            if lw >= 2.0 * body1 and lw >= 0.6 * range1:
                s += 1
        else:
            uw = h1 - max(o1, c1)
            if uw >= 2.0 * body1 and uw >= 0.6 * range1:
                s += 1
    if idx >= 2:
        o2, c2 = o[idx - 2], c[idx - 2]
        if d == 1:
            if c1 > o1 and c2 < o2 and c1 > o2 and o1 < c2:
                s += 1
        else:
            if c1 < o1 and c2 > o2 and c1 < o2 and o1 > c2:
                s += 1
    if idx >= 4:
        o3, c3 = o[idx - 3], c[idx - 3]
        o2, c2 = o[idx - 2], c[idx - 2]
        body3 = abs(c3 - o3)
        body2 = abs(c2 - o2)
        if d == 1:
            if c3 < o3 and body3 > 0 and body2 <= body3 * 0.3 and c1 > o1 and c1 > (o3 + c3) / 2.0:
                s += 1
        else:
            if c3 > o3 and body3 > 0 and body2 <= body3 * 0.3 and c1 < o1 and c1 < (o3 + c3) / 2.0:
                s += 1
        h3, l3, h2, l2 = h[idx - 3], l[idx - 3], h[idx - 2], l[idx - 2]
        if h2 < h3 and l2 > l3:
            if d == 1 and c1 > h2:
                s += 1
            elif d == -1 and c1 < l2:
                s += 1
    if idx >= 11:
        ab = 0.0
        for i in range(2, 12):
            ab += abs(c[idx - i] - o[idx - i])
        ab /= 10.0
        if ab > 0 and body1 > ab * 1.5:
            s += 1
    wc = 0
    for i in range(2, min(21, idx)):
        r = idx - i
        if d == 1:
            wick = min(o[r], c[r]) - l[r]
            if wick > 0 and l1 > 0 and abs(l[r] - l1) / l1 < 0.005:
                wc += 1
        else:
            wick = h[r] - max(o[r], c[r])
            if wick > 0 and h1 > 0 and abs(h[r] - h1) / h1 < 0.005:
                wc += 1
    if wc >= 2:
        s += 1
    return s


@nb.njit(cache=True)
def _v3_range(h, l, atr, idx, rperiod, rmult, rmin):
    start = max(0, idx - rperiod)
    if idx - start < rmin:
        return False, 0.0, 0.0
    rh = h[start]
    rl = l[start]
    for i in range(start, idx):
        rh = max(rh, h[i])
        rl = min(rl, l[i])
    a = atr[idx - 1]
    if not (a > 0):
        return False, 0.0, 0.0
    if rh - rl <= a * rmult:
        return True, rh, rl     # every bar of the window is inside its own high/low
    return False, 0.0, 0.0


@nb.njit(cache=True)
def _v3_scan(o, h, l, c, trend, atr, rr, tol, lookback, period, min_dist, rperiod, rmult, rmin,
             slmin, slmax, minscore, first):
    """detect_signal(df, idx) for every idx: decision on bar idx-1's close.  Stored at idx."""
    n = c.shape[0]
    sd = np.zeros(n, np.int64)
    ssl = np.full(n, np.nan)
    styp = np.zeros(n, np.int64)
    sps = np.zeros(n, np.int64)
    for idx in range(first, n):
        p = idx - 1
        tr = trend[p]
        a = atr[p]
        if tr == 0 or not (a > 0):
            continue
        price = c[p]
        if tr == 1:
            lvl = _v3_double(l, idx, period, lookback, min_dist, tol, True)
        else:
            lvl = _v3_double(h, idx, period, lookback, min_dist, tol, False)
        handled = False
        if not np.isnan(lvl) and _v3_rev(o, h, l, c, p, tr):
            ok, rh, rl = _v3_range(h, l, atr, idx, rperiod, rmult, rmin)
            pa = _v3_pa(o, h, l, c, idx, tr) + (1 if ok else 0)
            if pa >= minscore:
                handled = True
                dist = (price - lvl) if tr == 1 else (lvl - price)
                if dist > 0:
                    ratio = dist / a
                    if ratio >= slmin and ratio <= slmax:
                        sd[idx], ssl[idx], styp[idx], sps[idx] = tr, lvl, 1, pa
        if handled:
            continue
        ok, rh, rl = _v3_range(h, l, atr, idx, rperiod, rmult, rmin)
        if ok:
            center = (rh + rl) / 2.0
            if tr == 1 and price < center and _v3_rev(o, h, l, c, p, 1):
                pa = _v3_pa(o, h, l, c, idx, 1)
                if pa >= max(1, minscore - 1):
                    dist = price - rl
                    if dist > 0 and slmin <= dist / a <= slmax:
                        sd[idx], ssl[idx], styp[idx], sps[idx] = 1, rl, 2, pa
            elif tr == -1 and price > center and _v3_rev(o, h, l, c, p, -1):
                pa = _v3_pa(o, h, l, c, idx, -1)
                if pa >= max(1, minscore - 1):
                    dist = rh - price
                    if dist > 0 and slmin <= dist / a <= slmax:
                        sd[idx], ssl[idx], styp[idx], sps[idx] = -1, rh, 2, pa
    return sd, ssl, styp, sps


def v3_prepare(b: pd.DataFrame, P: dict = V3):
    c = b["close"]
    ma_t = c.rolling(P["ma_trend"]).mean()
    ma_s = c.rolling(P["ma_short"]).mean()
    trend = np.where(ma_s > ma_t, 1, np.where(ma_s < ma_t, -1, 0)).astype(np.int64)
    pc = c.shift(1)
    tr = np.maximum(b.high - b.low, np.maximum((b.high - pc).abs(), (b.low - pc).abs()))
    atr = tr.rolling(P["atr_period"]).mean().to_numpy(float)
    return trend, atr


def v3_signals(b: pd.DataFrame, P: dict = V3) -> tuple[pd.DataFrame, np.ndarray]:
    trend, atr = v3_prepare(b, P)
    o, h, l, c = (b[k].to_numpy(float) for k in ("open", "high", "low", "close"))
    sd, ssl, styp, sps = _v3_scan(o, h, l, c, trend, atr, P["rr_ratio"], P["db_tolerance"],
                                  P["db_lookback"], max(P["swing_period"] // 2, 2),
                                  P["min_swing_dist"], P["range_period"], P["range_atr_mult"],
                                  P["min_range_bars"], P["atr_sl_min"], P["atr_sl_max"],
                                  P["min_score"], P["ma_trend"] + 10)
    idx = np.flatnonzero(sd != 0)
    p = idx - 1
    dist = np.abs(c[p] - ssl[idx])
    sig = pd.DataFrame({"p": p, "idx": idx, "dir": sd[idx], "entry": c[p], "sl_px": ssl[idx],
                        "sl_dist": dist, "tp_px": c[p] + sd[idx] * dist * P["rr_ratio"],
                        "typ": styp[idx], "score": sps[idx]}, index=b.index[p])
    return sig, trend


@nb.njit(cache=True)
def _v3_engine(h, l, c, trend, day, sd, ssl, rr, maxhold, maxloss, cost_pct, first, fixed):
    """backtest_v3_mtf.run_backtest.  fixed=0: as written (the entry bar idx is never checked,
    first check on bar idx+1); fixed=1: also check bar idx right after the entry."""
    n = c.shape[0]
    e_i = np.full(n, -1)
    x_i = np.full(n, -1)
    dr_ = np.zeros(n, np.int64)
    e_p = np.zeros(n)
    x_p = np.zeros(n)
    sl_ = np.zeros(n)
    rs = np.zeros(n, np.int64)
    losses = np.zeros(day.max() + 2, np.int64)
    k = 0
    pos = False
    dr, ep, slx, tpx, held = 0, 0.0, 0.0, 0.0, 0
    ei = -1
    for idx in range(first, n):
        for stage in range(2):
            if stage == 1 and not (fixed == 1 and pos and ei == idx):
                break
            if pos and (stage == 1 or ei != idx):
                held += 1
                ex, xp, r = False, 0.0, 0
                if dr == 1 and l[idx] <= slx:
                    ex, xp, r = True, slx, 2
                elif dr == -1 and h[idx] >= slx:
                    ex, xp, r = True, slx, 2
                if not ex:
                    if dr == 1 and h[idx] >= tpx:
                        ex, xp, r = True, tpx, 1
                    elif dr == -1 and l[idx] <= tpx:
                        ex, xp, r = True, tpx, 1
                if not ex and held >= maxhold:
                    ex, xp, r = True, c[idx], 3
                if not ex and trend[idx] == -dr:
                    ex, xp, r = True, c[idx], 4
                if ex:
                    e_i[k], x_i[k], dr_[k], e_p[k], x_p[k], sl_[k], rs[k] = ei, idx, dr, ep, xp, slx, r
                    k += 1
                    pnl = dr * (xp - ep) / ep * 100.0 - cost_pct
                    if pnl < 0:
                        losses[day[idx]] += 1
                    pos = False
            if stage == 0 and not pos:
                if losses[day[idx]] >= maxloss:
                    break
                if sd[idx] != 0:
                    dr = sd[idx]
                    ep = c[idx - 1]
                    slx = ssl[idx]
                    dist = abs(ep - slx)
                    tpx = ep + dr * dist * rr
                    held = 0
                    ei = idx
                    pos = True
    if pos:
        e_i[k], x_i[k], dr_[k], e_p[k], x_p[k], sl_[k], rs[k] = ei, n - 1, dr, ep, c[n - 1], slx, 5
        k += 1
    return e_i[:k], x_i[:k], dr_[:k], e_p[:k], x_p[:k], sl_[:k], rs[:k]


def v3_engine(b: pd.DataFrame, sig: pd.DataFrame, trend: np.ndarray, cost_pct: float,
              fixed: int, P: dict = V3) -> pd.DataFrame:
    n = len(b)
    sd = np.zeros(n, np.int64)
    ssl = np.full(n, np.nan)
    sd[sig.idx.to_numpy()] = sig.dir.to_numpy()
    ssl[sig.idx.to_numpy()] = sig.sl_px.to_numpy()
    day = (b.index.as_unit("ns").normalize().asi8 // 86_400_000_000_000).astype(np.int64)
    day = day - day.min()
    h, l, c = (b[k].to_numpy(float) for k in ("high", "low", "close"))
    e_i, x_i, d, ep, xp, slx, rs = _v3_engine(h, l, c, trend, day, sd, ssl, P["rr_ratio"],
                                              P["max_hold_bars"], P["max_daily_loss"], cost_pct,
                                              P["ma_trend"] + 20, fixed)
    pnl = d * (xp - ep) / ep * 100.0 - cost_pct
    sl_pct = np.abs(ep - slx) / ep * 100.0
    out = pd.DataFrame({"p": e_i - 1, "xb": x_i, "dir": d, "entry": ep, "xp": xp,
                        "reason": rs, "pnl": pnl, "sl_pct": sl_pct}, index=b.index[e_i])
    return out


# ------------------------------------------------------------------ correct engine (fxlab.scalp)
MIN = np.timedelta64(1, "m")


def jst_day(t) -> np.ndarray:
    """JST calendar day number (the live bot runs on a Japanese PC: date.today())."""
    t = pd.DatetimeIndex(t)
    j = scalp.local_time(t)
    j = pd.DatetimeIndex(np.where(j.isna(), t + pd.Timedelta(hours=7), j))
    return j.as_unit("ns").normalize().asi8 // 86_400_000_000_000


def server_day(t) -> np.ndarray:
    return pd.DatetimeIndex(t).as_unit("ns").normalize().asi8 // 86_400_000_000_000


def sim_frame(sym: str, m1: pd.DataFrame, b: pd.DataFrame, sig: pd.DataFrame, cand: str,
              delay: str, trend: np.ndarray | None = None) -> pd.DataFrame:
    """scalp.simulate input for one candidate: index = signal M1 bar, cols dir tp sl hold,
    plus sid (row in sig), sig_t, ent_t.  delay: '' | 'm1' (+1 M1 bar) | 'bar' (+1 H1 bar).
    Exit rules keep their own clock: opposite signal / trend flip at its normal time,
    time-outs counted from the actual entry."""
    idx = m1.index
    iv = idx.values
    lmpos = idx.get_indexer(pd.DatetimeIndex(b["last_m1"].to_numpy()))
    nbar = len(b)
    p = sig.p.to_numpy()
    d = sig.dir.to_numpy()
    sb = 1 if delay == "bar" else 0
    sm = 1 if delay == "m1" else 0
    q = np.minimum(p + sb, nbar - 1)
    sp = lmpos[q] + sm
    ep = sp + 1
    ok = (p + sb < nbar) & (ep < len(idx))
    sp, ep = np.minimum(sp, len(idx) - 1), np.minimum(ep, len(idx) - 1)
    sig_t, ent_t = iv[sp], iv[ep]
    ok &= (ent_t - sig_t) <= 5 * MIN                    # simulate() skips longer gaps
    far = np.datetime64("2200-01-01").astype(iv.dtype)     # same unit as the M1 index
    eb = p + 1 + sb                                     # entry H1 bar
    if cand == "v2_live":
        stop = ent_t + 1800 * MIN                       # 30 hourly checks of main.py
        rev = np.full(len(p), far)
        for side in (1, -1):
            me = d == side
            opp = np.sort(p[d == -side])
            j = np.searchsorted(opp, p[me], side="right")
            has = j < len(opp)
            r = np.where(has, opp[np.minimum(j, len(opp) - 1)], 0) if len(opp) else np.zeros(me.sum(), int)
            has &= len(opp) > 0
            t_r = np.where(has, iv[np.minimum(lmpos[r] + 1, len(idx) - 1)], far)
            rev[me] = t_r
        ok &= rev > ent_t
        stop = np.minimum(stop, rev)
        rr = V2["RR_RATIO"]
    elif cand == "v2_all":
        tb = eb + V2["MAX_HOLD_CANDLES"]
        ok &= tb < nbar
        stop = b.index.values[np.minimum(tb, nbar - 1)]
        rr = V2["RR_RATIO"]
    else:                                              # v3_h1
        tb = eb + V3["max_hold_bars"]
        t_out = np.where(tb < nbar, b.index.values[np.minimum(tb, nbar - 1)], far)
        nxt = {}
        for side in (1, -1):
            a = np.where(trend == side, np.arange(nbar), nbar)
            nxt[side] = np.minimum.accumulate(a[::-1])[::-1]
        flip = np.where(d > 0, nxt[-1][np.minimum(eb, nbar - 1)], nxt[1][np.minimum(eb, nbar - 1)])
        t_flip = np.where(flip < nbar, iv[np.minimum(lmpos[np.minimum(flip, nbar - 1)] + 1, len(idx) - 1)], far)
        stop = np.minimum(t_out, t_flip)
        ok &= stop < far
        rr = V3["rr_ratio"]
    hold = (stop - ent_t) / MIN
    ok &= hold > 0
    sl = sig.sl_dist.to_numpy() / pip(sym)
    fr = pd.DataFrame({"dir": d, "tp": rr * sl, "sl": sl, "hold": hold.astype(float),
                       "sid": np.arange(len(sig)), "sig_t": sig_t, "ent_t": ent_t,
                       "dec_t": sig.index.values}, index=pd.DatetimeIndex(sig_t))
    return fr[ok]


def sim_each(m1: pd.DataFrame, fr: pd.DataFrame, sym: str, cm: float) -> pd.DataFrame:
    """Independent outcome of every signal: signals are packed into lanes where each one
    starts after the previous one's latest possible exit (entry + time stop), so simulate()'s
    one-position rule never binds inside a lane."""
    fr = fr.sort_index(kind="stable")
    st = fr.index.values
    free = (fr.ent_t.values + (fr.hold.values * 60e9).astype("timedelta64[ns]"))
    lanes = np.empty(len(fr), np.int64)
    heap: list = []
    nl = 0
    for k in range(len(fr)):
        if heap and heap[0][0] < st[k]:
            _, ln = heapq.heappop(heap)
        else:
            ln, nl = nl, nl + 1
        lanes[k] = ln
        heapq.heappush(heap, (free[k], ln))
    outs = []
    for ln in range(nl):
        sub = fr[lanes == ln]
        tr = scalp.simulate(m1, sub[["dir", "tp", "sl", "hold"]], sym, cm)
        mp = pd.Series(sub.sid.values, index=pd.DatetimeIndex(sub.ent_t.values))
        tr["sid"] = mp.reindex(pd.DatetimeIndex(tr.entry_time)).to_numpy()
        outs.append(tr)
    out = pd.concat(outs, ignore_index=True) if outs else pd.DataFrame()
    miss = len(fr) - len(out)
    if miss:
        print(f"  [warn] {sym}: {miss} signals without a trade in sim_each", flush=True)
    dec = pd.Series(fr.dec_t.values, index=fr.sid.values)
    out["dec_t"] = dec.reindex(out.sid.to_numpy()).to_numpy()
    return out.sort_values("entry_time", kind="stable").reset_index(drop=True)


def derive(tr: pd.DataFrame, one_pos: bool, dayfun, strict_loss: bool, maxl: int = 3) -> pd.DataFrame:
    """Apply one-position-per-symbol and the 3-losses-a-day stop chronologically.  A loss
    counts on its exit day once it has happened (exit_time < new entry)."""
    if not len(tr):
        return tr
    et = tr.entry_time.values
    xt = tr.exit_time.values
    net = tr.net_pips.to_numpy()
    loss = net < 0 if strict_loss else net <= 0
    eday = dayfun(et)
    xday = dayfun(xt)
    keep = np.zeros(len(tr), bool)
    heap: list = []
    cnt: dict = {}
    last_exit = np.datetime64("1970-01-01")
    for k in range(len(tr)):
        while heap and heap[0][0] < et[k]:
            _, lo, dd = heapq.heappop(heap)
            if lo:
                cnt[dd] = cnt.get(dd, 0) + 1
        if cnt.get(eday[k], 0) >= maxl:
            continue
        if one_pos and et[k] <= last_exit:
            continue
        keep[k] = True
        heapq.heappush(heap, (xt[k], bool(loss[k]), eday[k] * 0 + xday[k]))
        if xt[k] > last_exit:
            last_exit = xt[k]
    return tr[keep].reset_index(drop=True)


CAND_RULES = {"v2_live": dict(one_pos=True, dayfun=jst_day, strict=False),
              "v2_all": dict(one_pos=False, dayfun=jst_day, strict=False),
              "v3_h1": dict(one_pos=True, dayfun=server_day, strict=True)}


def variants(sym: str) -> list[tuple[str, float, str]]:
    v = [("c1", 1.0, ""), ("c0", 0.0, ""), ("c1.5", 1.5, ""), ("c2", 2.0, ""),
         ("d_m1", 1.0, "m1"), ("d_bar", 1.0, "bar")]
    if sym == BTC:
        v.append(("cex", CEX_MULT, ""))
    if os.environ.get("YAGAMI_FAST"):             # smoke test only
        v = v[:2]
    return v


COLS = ["symbol", "entry_time", "exit_time", "dir", "entry_px", "exit_px", "tp_pips", "sl_pips",
        "gross_pips", "net_pips", "R", "reason", "minutes"]


def run_candidate(sym: str, m1: pd.DataFrame, b: pd.DataFrame, sig: pd.DataFrame, cand: str,
                  trend: np.ndarray | None) -> dict:
    rules = CAND_RULES[cand]
    out = {}
    base0 = None
    for name, cm, delay in variants(sym):
        t0 = time.time()
        fr = sim_frame(sym, m1, b, sig, cand, delay, trend)
        each = sim_each(m1, fr, sym, cm)
        if name == "cex":                      # exchange-like: spread+slip only, no financing
            each["net_pips"] = each["gross_pips"]
            each["R"] = each["net_pips"] / each["sl_pips"]
        if name == "c0":
            base0 = each.copy()
        out[name] = derive(each, rules["one_pos"], rules["dayfun"], rules["strict"])[COLS]
        print(f"  {sym} {cand} {name}: signals {len(fr)} -> trades {len(out[name])} "
              f"({time.time() - t0:.0f}s)", flush=True)
    # the March backtester's cost: 0.05% of price per round trip, on frictionless fills
    e = base0.copy()
    e["net_pips"] = e["gross_pips"] - 0.0005 * e["entry_px"] / pip(sym)
    e["R"] = e["net_pips"] / e["sl_pips"]
    out["c005"] = derive(e, rules["one_pos"], rules["dayfun"], rules["strict"])[COLS]
    for k in out:
        out[k] = compact(out[k])
    return out


def compact(tr: pd.DataFrame) -> pd.DataFrame:
    tr = tr.copy()
    for c in ["entry_px", "exit_px", "tp_pips", "sl_pips", "gross_pips", "net_pips", "R", "minutes"]:
        tr[c] = tr[c].astype("float64")
    tr["dir"] = tr["dir"].astype("int8")
    return tr


# ------------------------------------------------------------------ 15-minute / 60-day samples
def m15_blocks(sym: str, m1: pd.DataFrame, P: dict) -> dict:
    b = scalp.resample(m1, "15min")
    b = b[b.index < pd.Timestamp(P["end"])]
    sig, diag = v2_signals(b)
    o = feb_outcomes(sym, b, sig)
    o = o[o.index >= pd.Timestamp(P["start"])]
    o["pnlc"] = o.pnl0 - o.cost
    res = {"diag": diag}
    start = pd.Timestamp(P["start"])
    for mode in ["lookahead", "none"]:
        for col in ["pnl0", "pnlc"]:
            k = feb_select(o, mode, col)
            t = o[k]
            blk = ((t.index - start).days // 60).to_numpy()
            g = pd.DataFrame({"blk": blk, "x": t[col].to_numpy()}).groupby("blk").x
            pfs = g.apply(pf)
            ns = g.size()
            pfs = pfs[ns >= 100]
            res[(mode, col)] = {
                "blocks": int(len(pfs)), "pf_median": float(pfs.median()),
                "pf_q10": float(pfs.quantile(0.1)), "pf_q90": float(pfs.quantile(0.9)),
                "share_pf_ge_1": float((pfs >= 1.0).mean()), "share_pf_ge_1_5": float((pfs >= 1.5).mean()),
                "n_median": float(ns[ns >= 100].median()),
                "all": feb_stats(t, col)}
            if sym == BTC:
                w = t[in_window(t.index, *BTC15_WIN)]
                res[(mode, col)]["user_window"] = feb_stats(w, col)
    return res


# ------------------------------------------------------------------ per-symbol driver
def period_masks(idx: pd.DatetimeIndex, sym: str) -> dict:
    P = periods(sym)
    m = {"is": in_window(idx, P["start"], P["is_end"]), "oos": in_window(idx, P["is_end"], P["end"]),
         "all": in_window(idx, P["start"], P["end"])}
    if sym == BTC:
        m["feb"] = in_window(idx, *FEB_WIN)
    return m


def run_symbol(sym: str) -> dict:
    t0 = time.time()
    P = periods(sym)
    m1 = scalp.load(sym, start=P["load_start"])[["open", "high", "low", "close"]].astype("float64")
    b = scalp.resample(m1, "1h")
    b = b[b.index < pd.Timestamp(P["end"])]
    res: dict = {"sym": sym}
    # ---- v2 signals and the Feb engine replica
    sig2, diag2 = v2_signals(b)
    res["diag_v2"] = diag2
    o = feb_outcomes(sym, b, sig2)
    o["pnlc"] = o.pnl0 - o.cost
    feb = {}
    for per, msk in period_masks(o.index, sym).items():
        w = o[msk]
        nb_ = int(period_masks(b.index, sym)[per].sum())
        feb[(per, "signals")] = {"n": int(len(w)), "bars": nb_}
        for mode, one in [("lookahead", False), ("none", False), ("causal", False), ("causal", True)]:
            for col in ["pnl0", "pnlc"]:
                k = feb_select(w, mode, col, one)
                feb[(per, mode, one, col)] = feb_stats(w[k], col, nb_)
    res["feb"] = feb
    # ---- v3 signals and the Mar engine replica
    sig3, trend = v3_signals(b)
    rep = {}
    for cost in [V3["spread_cost_pct"], 0.0]:
        for fixed in [0, 1]:
            tr = v3_engine(b, sig3, trend, cost, fixed)
            tr = tr[tr.index >= pd.Timestamp(P["start"])]
            for per, msk in period_masks(tr.index, sym).items():
                w = tr[msk]
                x = w.pnl.to_numpy()
                R = x / w.sl_pct.to_numpy()
                rep[(per, cost, fixed)] = {
                    "n": int(len(w)), "win": float((x > 0).mean()) if len(w) else float("nan"),
                    "pf": pf(x), "pf_R": pf(R), "avg_R": float(R.mean()) if len(w) else float("nan"),
                    "reasons": w.reason.value_counts().sort_index().to_dict(),
                    "sl_pct_median": float(w.sl_pct.median()) if len(w) else float("nan")}
    res["v3_replica"] = rep
    res["diag_v3"] = {"signals": int(len(sig3)), "bars": int(len(b)),
                      "types": sig3.typ.value_counts().to_dict(),
                      "sl_pct_median": float((sig3.sl_dist / sig3.entry * 100).median())}
    # ---- correct engine, three candidates
    keep2 = sig2.index >= pd.Timestamp(P["start"])
    keep3 = sig3.index >= pd.Timestamp(P["start"])
    res["cand"] = {}
    for cand in CANDS:
        sig = sig2[keep2] if cand.startswith("v2") else sig3[keep3]
        res["cand"][cand] = run_candidate(sym, m1, b, sig, cand, trend)
    # ---- 15-minute bars in 60-day samples (the user's 15m tests)
    if sym in (BTC, "EURJPY"):
        res["m15"] = m15_blocks(sym, m1, P)
    print(f"{sym} done in {time.time() - t0:.0f}s", flush=True)
    return res


# ------------------------------------------------------------------ statistics
def tstats(tr: pd.DataFrame) -> dict:
    n = len(tr)
    if n == 0:
        return {"n": 0}
    R = tr["R"].to_numpy()
    net = tr["net_pips"].to_numpy()
    pv = tr["symbol"].map(lambda s: INSTRUMENTS[s].pip).to_numpy(float)
    bps = net * pv / tr["entry_px"].to_numpy() * 1e4
    gR = tr["gross_pips"].to_numpy() / tr["sl_pips"].to_numpy()
    years = max((tr.entry_time.max() - tr.entry_time.min()).days / 365.25, 1e-9)
    sd = R.std(ddof=1) if n > 1 else float("nan")
    day = tr.entry_time.dt.normalize()
    ds = pd.Series(R).groupby(day.to_numpy()).sum()
    tday = float(ds.mean() / ds.std(ddof=1) * math.sqrt(len(ds))) if len(ds) > 2 and ds.std(ddof=1) > 0 \
        else float("nan")
    w, lo = R[R > 0], R[R <= 0]
    return {"n": n, "per_year": n / years, "win": float((net > 0).mean()),
            "avg_pips": float(net.mean()), "avg_gross_pips": float(tr["gross_pips"].mean()),
            "avg_R": float(R.mean()), "avg_gross_R": float(gR.mean()), "avg_bps": float(bps.mean()),
            "pf_bps": pf(bps), "pf_R": pf(R),
            "t_R": float(R.mean() / sd * math.sqrt(n)) if sd and sd > 0 else float("nan"),
            "t_day": tday, "sum_R": float(R.sum()), "avg_min": float(tr["minutes"].mean()),
            "avg_win_R": float(w.mean()) if len(w) else float("nan"),
            "avg_loss_R": float(-lo.mean()) if len(lo) else float("nan"),
            "long_share": float((tr["dir"] > 0).mean())}


def split(tr: pd.DataFrame, sym_group: str) -> dict:
    P = P_BTC if sym_group == "btc" else P_FX
    et = tr.entry_time
    out = {"is": tr[(et >= P["start"]) & (et < P["is_end"])],
           "oos": tr[(et >= P["is_end"]) & (et < P["end"])], "all": tr}
    if sym_group == "btc":
        out["feb"] = tr[(et >= FEB_WIN[0]) & (et < FEB_WIN[1])]
    return out


def group_trades(results: dict, cand: str, var: str, group: str) -> pd.DataFrame:
    syms = {"fx4": FX_MAIN, "btc": [BTC], "usdjpy": FX_SYN}.get(group, [group])
    parts = [results[s]["cand"][cand][var] for s in syms if s in results]
    return pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=COLS)


def by_year(tr: pd.DataFrame) -> pd.DataFrame:
    g = tr.groupby(tr.entry_time.dt.year)
    return pd.DataFrame({"n": g.size(), "win": g.net_pips.apply(lambda x: (x > 0).mean()),
                         "avg_R": g.R.mean(), "sum_R": g.R.sum()})


def verdict(results: dict, cand: str, group: str) -> dict:
    gt = "btc" if group == "btc" else "fx"
    base = split(group_trades(results, cand, "c1", group), gt)
    s_is, s_oos = tstats(base["is"]), tstats(base["oos"])
    o15 = split(group_trades(results, cand, "c1.5", group), gt)["oos"]
    oos = base["oos"]
    yr = oos.groupby(oos.entry_time.dt.year).R.sum() if len(oos) else pd.Series(dtype=float)
    drop = oos[oos.entry_time.dt.year != yr.idxmax()] if len(yr) else oos
    checks = {
        "IS 平均ネット > 0": s_is.get("avg_R", -1) > 0,
        "OOS 平均ネット > 0": s_oos.get("avg_R", -1) > 0,
        "OOS 日次t値 >= 2.0": s_oos.get("t_day", 0) >= 2.0,
        "OOS 取引数 >= 150": s_oos.get("n", 0) >= 150,
        "OOS コスト1.5倍でも > 0": len(o15) > 0 and o15.R.mean() > 0,
        "OOS 最良年を除いても > 0": len(drop) > 0 and drop.R.mean() > 0,
    }
    return {"is": s_is, "oos": s_oos, "checks": checks, "survives": all(checks.values()),
            "drop_best_year": float(drop.R.mean()) if len(drop) else float("nan"),
            "best_year": int(yr.idxmax()) if len(yr) else None,
            "oos_c15": float(o15.R.mean()) if len(o15) else float("nan")}


# ------------------------------------------------------------------ trial log / outputs
def log_trials(results: dict) -> None:
    seen = set()
    if LOG.path.exists():
        for line in open(LOG.path):
            r = json.loads(line)
            seen.add(json.dumps(r["params"], sort_keys=True) + r["period"])

    def put(params, metrics, period="is"):
        key = json.dumps(params, sort_keys=True, default=float) + period
        if key in seen:
            return
        seen.add(key)
        LOG.log(params, metrics, period)

    for sym, r in results.items():
        for key, m in r["feb"].items():
            if key[0] == "is" and len(key) == 4:
                _, mode, one, col = key
                put({"engine": "feb_replica_h1", "symbol": sym, "day_stop": mode, "one_pos": one,
                     "cost": "none" if col == "pnl0" else "approx_titan", "rules": "v2 config.py"}, m)
        for (per, cost, fixed), m in r["v3_replica"].items():
            if per == "is":
                put({"engine": "v3_replica_h1", "symbol": sym, "cost_pct": cost,
                     "entry_bar_checked": bool(fixed), "rules": "backtest_v3_mtf.py Config"},
                    {k: v for k, v in m.items() if k != "reasons"})
        for cand in CANDS:
            for var, tr in r["cand"][cand].items():
                gt = "btc" if sym == BTC else "fx"
                put({"engine": cand, "symbol": sym, "variant": var}, tstats(split(tr, gt)["is"]))
        if "m15" in r:
            for key, m in r["m15"].items():
                if key != "diag":
                    put({"engine": "feb_replica_m15_60d_blocks", "symbol": sym, "day_stop": key[0],
                         "cost": "none" if key[1] == "pnl0" else "approx_titan"},
                        {k: (v if not isinstance(v, dict) else None) for k, v in m.items()
                         if not isinstance(v, dict)}, "full")
    for cand in CANDS:
        for var in ["c1", "c0", "c1.5", "c2", "c005", "d_m1", "d_bar"]:
            put({"engine": cand, "symbol": "FX4_pool", "variant": var},
                tstats(split(group_trades(results, cand, var, "fx4"), "fx")["is"]))
        for group in ["fx4", "btc"]:
            v = verdict(results, cand, group)
            put({"engine": cand, "symbol": group, "variant": "c1", "final": True}, v["oos"], "oos")


def save_trades(results: dict) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for cand in CANDS:
        parts = [results[s]["cand"][cand]["c1"] for s in SYMBOLS if s in results]
        tr = pd.concat(parts, ignore_index=True).sort_values(["symbol", "entry_time"])
        tr.to_parquet(OUT_DIR / f"trades_{KEY}_{cand}.parquet", index=False)


# ------------------------------------------------------------------ main
def main_run(symbols: list[str], workers: int) -> dict:
    from concurrent.futures import ProcessPoolExecutor
    results = {}
    if workers <= 1:
        for s in symbols:
            results[s] = run_symbol(s)
    else:
        with ProcessPoolExecutor(workers) as ex:
            for r in ex.map(run_symbol, symbols):
                results[r["sym"]] = r
    return results


def cli():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--workers", type=int, default=2)
    a = ap.parse_args()
    if a.report:
        with open(CACHE, "rb") as fh:
            results = pickle.load(fh)
        write_report(results)
        return
    if a.only:
        res = main_run(a.only, 1)
        for s, r in res.items():
            print(s, {k: v for k, v in r["feb"].items() if k[0] == "all" and len(k) == 4 and k[3] == "pnl0"})
        return
    order = [BTC, "EURUSD", "USDJPY", "EURJPY", "AUDJPY", "XAUUSD"]
    results = main_run(order, a.workers)
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    with open(CACHE, "wb") as fh:
        pickle.dump(results, fh)
    log_trials(results)
    save_trades(results)
    write_report(results)


def write_report(results: dict) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(report_text(results))
    print(REPORT.read_text())


def report_text(results: dict) -> str:
    return "(report pending)\n"


if __name__ == "__main__":
    cli()
