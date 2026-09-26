"""Price levels and scheduled order flows at scalping speed (round numbers, London 4pm fix,
month-end, Tokyo 09:55 fix / gotobi) on M1 bars.

    python scripts/scalp_levels_flows.py              # final: OOS once + stress + report
    python scripts/scalp_levels_flows.py --stage rn   # IS: round-number first touches
    python scripts/scalp_levels_flows.py --stage ldn  # IS: London 4pm WM/R fix, month-end
    python scripts/scalp_levels_flows.py --stage tky  # IS: Tokyo 09:55 fix, gotobi, fast vs slow

Protocol (every configuration is appended to reports/trials/scalp_levels_flows.jsonl):
  IS 2005-01-01..2014-12-31 only is used to rank configurations.  At most 3 final
  candidates (FINAL below, one per sub-family, fixed from the IS log by the rule written
  here BEFORE the IS runs) are evaluated ONCE on 2015-01-01..2020-05-14, plus cost x1.5 / x2,
  per year, per pair, entry delayed by 1 and 2 minutes, frictionless and random direction.

  Selection rule (fixed before the IS runs):
    rn   the (level class, mode, exit shape) with the best pooled IS avg net pips over the
         6 raw pairs.
    ldn  the configuration with the best pooled IS avg net pips over the 4 USD pairs among
         those with >= 200 pooled IS trades.
    tky  the FAST configuration (not the slow 09:55->15:00 reference) with the best USDJPY IS
         avg net pips; the candidate trades USDJPY only (the instrument the flow is about),
         EURJPY / AUDJPY (raw data) are reported as confirmation.  The slow reference is
         evaluated next to it (it is the known strategy, not a new selection).

Sub-families (decision on the close of the signal bar, entry at the next M1 open; every
feature uses bars up to and including the signal bar only):
  rn   Round numbers.  Levels every 100 pips ("00": 1.xx00 / xx.00) or the odd 50s ("50":
       1.xx50 / xx.50).  A first touch of the day = the bar whose high (low) reaches the
       first level above the day's high (below the day's low) of the COMPLETED bars of the
       same server day.  Modes: fade (trade against the approach), fade_rej (fade only when
       the touch bar closed back on the approach side of the level), break (trade in the
       approach direction only when the touch bar closed >= 1 pip beyond the level).
       Exit: fixed TP / SL / time stop.  Server hours 03-22, Mon-Fri.
  ldn  London 16:00 WM/R fix (all clocks in Europe/London local time, so UK/US DST is exact).
       Pre-fix momentum (15:30->16:00 or 15:45->16:00 in the direction of the prior move),
       month-end rebalancing proxies on the last weekday of the month (sell USD into the fix
       when the USD rose month-to-date, or when US500 rose month-to-date), post-fix reversal
       (fade the 15:30->fix move, 16:00 or 16:05 -> 16:30).  Clock exit, stop 0.5 x D1 ATR(14).
  tky  Tokyo fix 09:55 JST on gotobi / non-gotobi Japanese business days.  Pre-fix JPY
       selling (long XXXJPY 09:30/09:45/09:50 -> 09:55) and post-fix JPY buying (short
       09:55 -> 10:00/10:05/10:10/10:25) vs the slow reference 09:55 -> 15:00
       (fxlab/strategies/seasonality.py).  Stop 0.5 x D1 ATR(14) of the last completed
       server day, no TP.

Delays: the signal is moved 1 / 2 bars later.  Relative exits (rn) keep TP/SL/hold; clock
trades keep their clock exit (a late entry has less time in the trade).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import pickle
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fxlab import scalp  # noqa: E402
from fxlab.instruments import INSTRUMENTS  # noqa: E402
from fxlab.research import TrialLog  # noqa: E402
from fxlab.strategies.seasonality import gotobi_set, jp_business_day  # noqa: E402

FAMILY = "scalp_levels_flows"
KEY = "levels_flows"
LOG = TrialLog(FAMILY)
OUT_DIR = ROOT / "reports" / "scalping"
REPORT = OUT_DIR / f"{KEY}.md"
IS_START = pd.Timestamp("2005-01-01")
IS_END = scalp.IS_END                                  # 2015-01-01
OOS_END = pd.Timestamp("2020-05-15")
WORKERS = 2
MIN = 60_000_000_000                                   # one minute in ns
DAY = 24 * 60 * MIN

RAW = ["EURUSD", "GBPUSD", "AUDUSD", "USDCAD", "EURJPY", "AUDJPY"]
SYN = ["USDJPY"]                                       # synthetic: secondary evidence only
RN_PAIRS = RAW + SYN
LDN_PAIRS = ["EURUSD", "GBPUSD", "AUDUSD", "USDCAD"]
TKY_PAIRS = ["USDJPY", "EURJPY", "AUDJPY"]
USD_SIGN = {"EURUSD": -1, "GBPUSD": -1, "AUDUSD": -1, "USDCAD": 1}  # +1: pair up = USD up

# ---------------------------------------------------------------- configuration grids
RN_SHAPES = [(5.0, 5.0, 30.0), (10.0, 10.0, 60.0), (4.0, 10.0, 30.0), (10.0, 4.0, 30.0)]
RN_HOURS = list(range(3, 23))
RN_CFGS = [dict(sub="rn", cls=c, mode=m, tp=tp, sl=sl, hold=hd)
           for c in ("00", "50") for m in ("fade", "fade_rej", "break")
           for tp, sl, hd in RN_SHAPES]

# London: kind, entry clock, exit clock, days, reference clock (start of the move), thr pips
LDN_CFGS = [
    dict(sub="ldn", name="pre_mom1h_all", kind="mom", entry="15:30", exit="16:00", days="all",
         ref="14:30"),
    dict(sub="ldn", name="pre_mom1h_me", kind="mom", entry="15:30", exit="16:00", days="me",
         ref="14:30"),
    dict(sub="ldn", name="pre_mom1h_big_all", kind="mom", entry="15:30", exit="16:00",
         days="all", ref="14:30", thr=10.0),
    dict(sub="ldn", name="pre_mom45_all", kind="mom", entry="15:45", exit="16:00", days="all",
         ref="15:00"),
    dict(sub="ldn", name="pre_mom45_me", kind="mom", entry="15:45", exit="16:00", days="me",
         ref="15:00"),
    dict(sub="ldn", name="me_fx_pre30", kind="me_fx", entry="15:30", exit="16:00", days="me"),
    dict(sub="ldn", name="me_eq_pre30", kind="me_eq", entry="15:30", exit="16:00", days="me"),
    dict(sub="ldn", name="me_fx_pre60", kind="me_fx", entry="15:00", exit="16:00", days="me"),
    dict(sub="ldn", name="me_eq_pre60", kind="me_eq", entry="15:00", exit="16:00", days="me"),
    dict(sub="ldn", name="post_rev_1605_all", kind="rev", entry="16:05", exit="16:30",
         days="all", ref="15:30"),
    dict(sub="ldn", name="post_rev_1605_me", kind="rev", entry="16:05", exit="16:30",
         days="me", ref="15:30"),
    dict(sub="ldn", name="post_rev_1605_big_all", kind="rev", entry="16:05", exit="16:30",
         days="all", ref="15:30", thr=10.0),
    dict(sub="ldn", name="post_rev_1600_all", kind="rev", entry="16:00", exit="16:30",
         days="all", ref="15:30"),
    dict(sub="ldn", name="post_rev_1600_me", kind="rev", entry="16:00", exit="16:30",
         days="me", ref="15:30"),
    dict(sub="ldn", name="me_fx_post", kind="me_fx_post", entry="16:05", exit="16:30",
         days="me"),
    dict(sub="ldn", name="me_eq_post", kind="me_eq_post", entry="16:05", exit="16:30",
         days="me"),
]

TKY_WINDOWS = {
    "pre_0930": ("09:30", "09:55", +1), "pre_0945": ("09:45", "09:55", +1),
    "pre_0950": ("09:50", "09:55", +1),
    "post_5": ("09:55", "10:00", -1), "post_10": ("09:55", "10:05", -1),
    "post_15": ("09:55", "10:10", -1), "post_30": ("09:55", "10:25", -1),
    "slow_1500": ("09:55", "15:00", -1),              # the known strategy (reference)
}
TKY_CFGS = [dict(sub="tky", name=f"{w}_{d}", window=w, days=d)
            for d in ("gotobi", "non_gotobi") for w in TKY_WINDOWS]
STOP_ATR = 0.5
ATR_N = 14
FWD_H = [5, 15, 30]

# Final candidates, fixed from the IS trial log (56 configurations) with the selection rule in
# the docstring, before any OOS evaluation.
def _cfg(sub: str, **kw) -> dict:
    for c in SUB_CFGS_ALL[sub]:
        if all(c.get(k) == v for k, v in kw.items()):
            return dict(c)
    raise KeyError(kw)


SUB_CFGS_ALL = {"rn": RN_CFGS, "ldn": LDN_CFGS, "tky": TKY_CFGS}
FINAL: list[dict] = [
    dict(name="rn50_fade_rej", cfg=_cfg("rn", cls="50", mode="fade_rej", tp=10.0, sl=10.0,
                                        hold=60.0), pairs=RAW,
         rule="その日初めて xx.50 / 1.xx50 の節目に触れた M1 足が節目の手前側で引けたら逆張り"
              "（新高値で触れたら売り、新安値なら買い）、TP 10 / SL 10 pips / 60分、サーバー3-22時",
         why="節目24設定の中で実6ペア合算の IS 平均ネットが最良（ただし IS でも負）"),
    dict(name="me_eq_pre60", cfg=_cfg("ldn", name="me_eq_pre60"), pairs=LDN_PAIRS,
         rule="月の最終平日（ロンドン日付）、ロンドン15:00に成行で入り16:00（WM/R フィキシング）に決済。"
              "方向: US500 の月初来リターンがプラスならドル売り、マイナスならドル買い（エントリー直前までのデータ）。"
              "損切り 0.5×日足ATR(14)",
         why="ロンドン16設定の中で4ペア合算の IS 平均ネットが最良（+9.9 pips、t=6.2、4ペアすべてプラス）"),
    dict(name="gotobi_post30", cfg=_cfg("tky", name="post_30_gotobi"), pairs=["USDJPY"],
         rule="五十日の 09:55 JST（仲値決定時刻）に USDJPY を成行で売り、10:25 JST に決済（30分）。"
              "損切り 0.5×日足ATR(14)、利確なし",
         why="速い版（09:55 前後 5-30 分）の中で USDJPY の IS 平均ネットが最良（+1.37 pips、t=3.6）",
         confirm=["EURJPY", "AUDJPY"],
         reference=dict(name="gotobi_slow_1500", cfg=_cfg("tky", name="slow_1500_gotobi"),
                        rule="既存戦略: 五十日 09:55 JST に売り 15:00 JST に決済、損切り 0.5×ATR")),
]


# =============================================================================== helpers
def _load(sym: str, start, end) -> pd.DataFrame:
    return scalp.load(sym, start=start, end=end)[["open", "high", "low", "close"]].astype("float64")


def _hm(s: str) -> int:
    h, m = s.split(":")
    return (int(h) * 60 + int(m)) * MIN


class Ctx:
    """Per-pair arrays shared by all signal builders."""

    def __init__(self, sym: str, m1: pd.DataFrame, us500: pd.Series | None = None):
        self.sym, self.m1 = sym, m1
        self.pip = INSTRUMENTS[sym].pip
        self.t = m1.index.as_unit("ns").asi8.astype(np.int64)
        self.o, self.h, self.l, self.c = (m1[k].to_numpy(float) for k in ("open", "high", "low", "close"))
        self.n = len(self.t)
        self.us500 = us500
        self._loc: dict = {}
        self._atr = None

    def local(self, tz: str) -> np.ndarray:
        if tz not in self._loc:
            lt = pd.Series(scalp.local_time(self.m1.index, tz)).ffill().bfill()  # NaT: none in FX hours
            self._loc[tz] = pd.DatetimeIndex(lt).as_unit("ns").asi8.astype(np.int64)
        return self._loc[tz]

    def atr_prev_day(self, pos: np.ndarray) -> np.ndarray:
        """0.5 x ATR(14) (SMA of true range, MT5 iATR) of the last COMPLETED server day
        (Mon-Fri) before the day of each bar position, in price units."""
        if self._atr is None:
            day = self.t // DAY
            starts = np.flatnonzero(np.r_[True, day[1:] != day[:-1]])
            ends = np.r_[starts[1:], self.n] - 1
            dd = day[starts]
            dow = (dd + 3) % 7                        # 1970-01-01 was a Thursday (dow 3)
            keep = dow < 5
            hi = np.maximum.reduceat(self.h, starts)[keep]
            lo = np.minimum.reduceat(self.l, starts)[keep]
            cl = self.c[ends][keep]
            pc = np.r_[np.nan, cl[:-1]]
            tr = np.nanmax(np.c_[hi - lo, np.abs(hi - pc), np.abs(lo - pc)], axis=1)
            atr = pd.Series(tr).rolling(ATR_N, min_periods=ATR_N).mean().to_numpy()
            self._atr = (dd[keep], atr)
        dd, atr = self._atr
        k = np.searchsorted(dd, self.t[pos] // DAY, side="left") - 1
        out = np.full(len(pos), np.nan)
        ok = k >= 0
        out[ok] = atr[k[ok]]
        return out


def sig_frame(ctx: Ctx, pos, d, tp, sl, hold) -> pd.DataFrame:
    return pd.DataFrame({"dir": np.asarray(d, float), "tp": tp, "sl": sl, "hold": hold},
                        index=ctx.m1.index[pos])


# ============================================================================ round numbers
def rn_events(ctx: Ctx, cls: str):
    """First touches of the day of the round level class `cls`.
    Returns (pos, side, level) with side +1 = touched from below (new day high)."""
    tick = ctx.pip / 10.0
    H = np.rint(ctx.h / tick).astype(np.int64)
    Lo = np.rint(ctx.l / tick).astype(np.int64)
    day = ctx.t // DAY
    new = np.r_[True, day[1:] != day[:-1]]
    grp = np.cumsum(new)
    cum_hi = pd.Series(H).groupby(grp).cummax().to_numpy()
    cum_lo = pd.Series(Lo).groupby(grp).cummin().to_numpy()
    prev_hi = np.r_[0, cum_hi[:-1]]
    prev_lo = np.r_[0, cum_lo[:-1]]
    S = (100 if cls == "00" else 50) * 10
    up_l = (prev_hi // S + 1) * S                      # first level strictly above the day high
    dn_l = ((prev_lo - 1) // S) * S                    # first level strictly below the day low
    up = ~new & (H >= up_l)
    dn = ~new & (Lo <= dn_l)
    if cls == "50":
        up &= (up_l % 1000) != 0
        dn &= (dn_l % 1000) != 0
    both = up & dn
    up &= ~both
    dn &= ~both
    pos = np.flatnonzero(up | dn)
    side = np.where(up[pos], 1, -1)
    level = np.where(side > 0, up_l[pos], dn_l[pos]) * tick
    return pos, side, level


def rn_mask(ctx: Ctx, pos: np.ndarray) -> np.ndarray:
    idx = ctx.m1.index[pos]
    hr, dow = idx.hour.to_numpy(), idx.dayofweek.to_numpy()
    keep = np.isin(hr, RN_HOURS) & (dow < 5)
    keep &= ~((dow == 4) & (hr >= 21))
    keep &= pos + 1 < ctx.n
    return keep


def rn_signals(ctx: Ctx, cfg: dict, ev_cache: dict, delay: int = 0):
    """Returns (signal DataFrame, level of each signal)."""
    if cfg["cls"] not in ev_cache:
        ev_cache[cfg["cls"]] = rn_events(ctx, cfg["cls"])
    pos, side, level = ev_cache[cfg["cls"]]
    keep = rn_mask(ctx, pos)
    pos, side, level = pos[keep], side[keep], level[keep]
    c = ctx.c[pos]
    mode = cfg["mode"]
    if mode == "fade":
        d, ok = -side, np.ones(len(pos), bool)
    elif mode == "fade_rej":
        d, ok = -side, np.where(side > 0, c < level, c > level)
    elif mode == "break":
        d = side
        ok = np.where(side > 0, c >= level + ctx.pip, c <= level - ctx.pip)
    else:
        raise ValueError(mode)
    pos, d, level = pos[ok], d[ok], level[ok]
    if delay:
        pos = pos + delay
        ok = pos + 1 < ctx.n
        pos, d, level = pos[ok], d[ok], level[ok]
    return sig_frame(ctx, pos, d, cfg["tp"], cfg["sl"], cfg["hold"]), level


def rn_fwd(ctx: Ctx, sig: pd.DataFrame, level: np.ndarray) -> dict:
    """Frictionless mid moves in the trade direction (pips, mean over all signals):
    mkt_h = from the next bar open (what the simulator trades) to h minutes later;
    lvl_h = from the level itself (a resting order at the level, filled during the touch
    bar) to h minutes after the touch bar's open.  lvl is only implementable for 'fade'."""
    pos = ctx.m1.index.get_indexer(sig.index)
    d = sig["dir"].to_numpy()
    out = {}
    for hmin in FWD_H:
        j = np.searchsorted(ctx.t, ctx.t[pos + 1] + hmin * MIN, side="right") - 1
        out[f"mkt{hmin}"] = float(np.mean(d * (ctx.c[j] - ctx.o[pos + 1]) / ctx.pip))
        j2 = np.searchsorted(ctx.t, ctx.t[pos] + hmin * MIN, side="left") - 1
        out[f"lvl{hmin}"] = float(np.mean(d * (ctx.c[j2] - level) / ctx.pip))
    out["gap_open_vs_level"] = float(np.mean(d * (level - ctx.o[pos + 1]) / ctx.pip))
    return out


# ============================================================================ clock trades
def clock_base(ctx: Ctx, tz: str, entry: str, exit_: str, days: str, tol_min: int = 3):
    """One signal per qualifying local date: entry bar = first bar at/after the local entry
    clock (within tol_min), signal bar = the bar before it.  Returns (sig_pos, exit_ns)."""
    loc = ctx.local(tz)
    lday = np.unique(loc // DAY)
    lday = lday[_day_filter(lday, days)]
    te = lday * DAY + _hm(entry)
    p = np.searchsorted(loc, te, side="left")
    ok = (p < ctx.n) & (p >= 1)
    p, te, lday = p[ok], te[ok], lday[ok]
    ok = (loc[p] - te) < tol_min * MIN
    p, lday = p[ok], lday[ok]
    tx = lday * DAY + _hm(exit_)
    return p - 1, tx


def clock_hold(ctx: Ctx, tz: str, sig_pos: np.ndarray, exit_ns: np.ndarray) -> np.ndarray:
    loc = ctx.local(tz)
    return (exit_ns - loc[sig_pos + 1]) / MIN




def _day_filter(lday: np.ndarray, days: str) -> np.ndarray:
    dts = pd.to_datetime(lday * DAY)
    dow = dts.dayofweek.to_numpy()
    if days in ("gotobi", "non_gotobi"):
        g = gotobi_set()
        dd = [x.date() for x in dts]
        isg = np.array([x in g for x in dd])
        bday = np.array([jp_business_day(x) for x in dd])
        return isg if days == "gotobi" else (bday & ~isg)
    wk = dow < 5
    wk &= ~((dts.month == 12) & (dts.day == 25)) & ~((dts.month == 1) & (dts.day == 1))
    if days == "all":
        return wk
    if days == "me":
        # last Monday-Friday of the calendar month (London date)
        last = dts + pd.offsets.MonthEnd(0)
        back = np.where(last.dayofweek == 5, 1, np.where(last.dayofweek == 6, 2, 0))
        lastwd = (last - pd.to_timedelta(back, unit="D")).normalize()
        return wk & (dts.normalize() == lastwd)
    raise ValueError(days)


def _month_ref(t_arr: np.ndarray, vals: np.ndarray, t_sig: np.ndarray) -> np.ndarray:
    """Value of the last bar strictly before the server-time month start of each t_sig."""
    ms = pd.to_datetime(t_sig).to_period("M").to_timestamp().as_unit("ns").asi8
    k = np.searchsorted(t_arr, ms, side="left") - 1
    out = np.full(len(t_sig), np.nan)
    ok = k >= 0
    out[ok] = vals[k[ok]]
    return out


def ldn_signals(ctx: Ctx, cfg: dict, delay: int = 0) -> pd.DataFrame:
    tz = "Europe/London"
    sp, tx = clock_base(ctx, tz, cfg["entry"], cfg["exit"], cfg["days"])
    kind = cfg["kind"]
    if kind in ("mom", "rev"):
        loc = ctx.local(tz)
        tref = (loc[sp + 1] // DAY) * DAY + _hm(cfg["ref"])
        pr = np.searchsorted(loc, tref, side="left")
        ok = pr < sp
        mv = np.where(ok, ctx.c[sp] - ctx.o[np.minimum(pr, ctx.n - 1)], np.nan) / ctx.pip
        d = np.sign(mv) * (1 if kind == "mom" else -1)
        d = np.where(np.abs(mv) >= cfg.get("thr", 0.0), d, 0)
    elif kind.startswith("me_fx"):
        ref = _month_ref(ctx.t, ctx.c, ctx.t[sp])
        d = -np.sign(ctx.c[sp] - ref)                  # sell USD if USD rose MTD
        if kind.endswith("post"):
            d = -d
    elif kind.startswith("me_eq"):
        us = ctx.us500
        ut = us.index.as_unit("ns").asi8
        uv = us.to_numpy(float)
        k = np.searchsorted(ut, ctx.t[sp], side="right") - 1   # US500 bar <= signal bar
        now = np.where(k >= 0, uv[np.maximum(k, 0)], np.nan)
        ref = _month_ref(ut, uv, ctx.t[sp])
        eq = now - ref
        d = -USD_SIGN[ctx.sym] * np.sign(eq)            # sell USD if US equities rose MTD
        if kind.endswith("post"):
            d = -d
    else:
        raise ValueError(kind)
    d = np.nan_to_num(d)
    sl = STOP_ATR * ctx.atr_prev_day(sp) / ctx.pip
    ok = (d != 0) & np.isfinite(sl) & (sl > 0)
    sp, tx, d, sl = sp[ok], tx[ok], d[ok], sl[ok]
    if delay:
        sp = sp + delay
        ok = sp + 1 < ctx.n
        sp, tx, d, sl = sp[ok], tx[ok], d[ok], sl[ok]
    hold = clock_hold(ctx, tz, sp, tx)
    ok = hold > 0
    return sig_frame(ctx, sp[ok], d[ok], np.nan, sl[ok], hold[ok])


def tky_signals(ctx: Ctx, cfg: dict, delay: int = 0) -> pd.DataFrame:
    tz = "Asia/Tokyo"
    entry, exit_, dj = TKY_WINDOWS[cfg["window"]]
    sp, tx = clock_base(ctx, tz, entry, exit_, cfg["days"])
    sl = STOP_ATR * ctx.atr_prev_day(sp) / ctx.pip
    ok = np.isfinite(sl) & (sl > 0)
    sp, tx, sl = sp[ok], tx[ok], sl[ok]
    if delay:
        sp = sp + delay
        ok = sp + 1 < ctx.n
        sp, tx, sl = sp[ok], tx[ok], sl[ok]
    hold = clock_hold(ctx, tz, sp, tx)
    ok = hold > 0
    return sig_frame(ctx, sp[ok], np.full(ok.sum(), dj), np.nan, sl[ok], hold[ok])


def build(ctx: Ctx, cfg: dict, cache: dict, delay: int = 0) -> pd.DataFrame:
    if cfg["sub"] == "rn":
        return rn_signals(ctx, cfg, cache, delay)[0]
    if cfg["sub"] == "ldn":
        return ldn_signals(ctx, cfg, delay)
    return tky_signals(ctx, cfg, delay)


# ============================================================================ aggregation
def moments(tr: pd.DataFrame, tr0: pd.DataFrame | None = None) -> dict:
    net = tr["net_pips"].to_numpy()
    m = {"n": int(len(net)), "s": float(net.sum()), "ss": float((net ** 2).sum()),
         "w": int((net > 0).sum()), "min": float(tr["minutes"].sum())}
    if tr0 is not None:
        m.update(n0=int(len(tr0)), s0=float(tr0["gross_pips"].sum()),
                 w0=int((tr0["gross_pips"] > 0).sum()))
    return m


def pooled(ms: list[dict]) -> dict:
    n = sum(m["n"] for m in ms)
    if n < 2:
        return {"n": n}
    s, ss = sum(m["s"] for m in ms), sum(m["ss"] for m in ms)
    mean = s / n
    sd = math.sqrt(max(ss - n * mean * mean, 0.0) / (n - 1))
    out = {"n": n, "avg_net": mean, "t": mean / sd * math.sqrt(n) if sd > 0 else float("nan"),
           "win": sum(m["w"] for m in ms) / n, "avg_min": sum(m["min"] for m in ms) / n}
    if all("n0" in m for m in ms):
        n0 = sum(m["n0"] for m in ms)
        out["avg_frictionless"] = sum(m["s0"] for m in ms) / max(n0, 1)
        out["win_frictionless"] = sum(m["w0"] for m in ms) / max(n0, 1)
        out["cost_eaten"] = out["avg_frictionless"] - mean
    return out


def summarize_trades(tr: pd.DataFrame) -> dict:
    s = scalp.stats(tr) if len(tr) else {"n": 0}
    keep = ["n", "trades_per_year", "win_rate", "avg_net_pips", "avg_gross_pips", "t_stat",
            "profit_factor", "total_net_pips", "avg_minutes"]
    return {k: s.get(k, float("nan")) for k in keep}


# ============================================================================== IS stages
SUB_PAIRS = {"rn": RN_PAIRS, "ldn": LDN_PAIRS, "tky": TKY_PAIRS}
SUB_CFGS = {"rn": RN_CFGS, "ldn": LDN_CFGS, "tky": TKY_CFGS}


def _load_us500(start, end) -> pd.Series:
    return scalp.load("US500", start=start, end=end)["close"].astype("float64")


def _eval_pair_is(args):
    sym, sub = args
    t0 = time.time()
    m1 = _load(sym, IS_START, IS_END)
    ctx = Ctx(sym, m1, _load_us500(IS_START - pd.Timedelta(days=40), IS_END) if sub == "ldn" else None)
    cache: dict = {}
    res = []
    for cfg in SUB_CFGS[sub]:
        if sub == "rn":
            sig, level = rn_signals(ctx, cfg, cache)
        else:
            sig, level = build(ctx, cfg, cache), None
        tr1 = scalp.simulate(m1, sig, sym, cost_mult=1.0)
        tr0 = scalp.simulate(m1, sig, sym, cost_mult=0.0)
        m = moments(tr1, tr0)
        m["n_signals"] = int(len(sig))
        m["avg_sl"] = float(sig["sl"].mean()) if len(sig) else float("nan")
        if sub == "rn" and cfg["tp"] == RN_SHAPES[0][0] and cfg["sl"] == RN_SHAPES[0][1] and len(sig):
            m.update(rn_fwd(ctx, sig, level))
        res.append(m)
    print(f"  {sym} [{sub}]: {len(res)} configs in {time.time() - t0:.0f}s", flush=True)
    return sym, res


def run_is(sub: str) -> pd.DataFrame:
    pairs, cfgs = SUB_PAIRS[sub], SUB_CFGS[sub]
    with ProcessPoolExecutor(WORKERS) as ex:
        out = dict(ex.map(_eval_pair_is, [(s, sub) for s in pairs]))
    raw = [s for s in pairs if s not in SYN]
    rows = []
    for i, cfg in enumerate(cfgs):
        per = {s: out[s][i] for s in pairs}
        per_pair = {}
        for s in pairs:
            p = pooled([per[s]])
            p.update({k: v for k, v in per[s].items() if k.startswith(("mkt", "lvl", "gap", "n_sig", "avg_sl"))})
            per_pair[s] = p
        metrics = {"raw_pool": pooled([per[s] for s in raw]), "per_pair": per_pair}
        if sub == "tky":
            metrics["jpy_raw_pool"] = pooled([per[s] for s in ("EURJPY", "AUDJPY")])
        LOG.log(dict(cfg), metrics, period="is")
        rows.append({**cfg, **{f"raw_{k}": v for k, v in metrics["raw_pool"].items()},
                     **{f"{s}_{k}": v for s in pairs for k, v in per_pair[s].items()}})
    return pd.DataFrame(rows)


def load_log(sub: str | None = None) -> pd.DataFrame:
    if not LOG.path.exists():
        return pd.DataFrame()
    rows = []
    for line in open(LOG.path):
        r = json.loads(line)
        if r.get("period") != "is" or (sub and r["params"].get("sub") != sub):
            continue
        row = dict(r["params"])
        for pool in ("raw_pool", "jpy_raw_pool"):
            for k, v in r["metrics"].get(pool, {}).items():
                row[f"{pool.replace('_pool', '')}_{k}"] = v
        for s, p in r["metrics"]["per_pair"].items():
            for k, v in p.items():
                row[f"{s}_{k}"] = v
        rows.append(row)
    df = pd.DataFrame(rows)
    if not len(df):
        return df
    keys = [k for k in ("sub", "cls", "mode", "tp", "sl", "hold", "name") if k in df.columns]
    return df.drop_duplicates(subset=keys, keep="last")


def show_is(sub: str):
    df = load_log(sub)
    pd.set_option("display.width", 250)
    if sub == "rn":
        cols = ["cls", "mode", "tp", "sl", "hold", "raw_n", "raw_win", "raw_avg_frictionless",
                "raw_avg_net", "raw_t", "USDJPY_avg_net"]
    elif sub == "ldn":
        cols = ["name", "raw_n", "raw_win", "raw_avg_frictionless", "raw_avg_net", "raw_t"] + \
               [f"{s}_avg_net" for s in LDN_PAIRS]
    else:
        cols = ["name", "USDJPY_n", "USDJPY_win", "USDJPY_avg_frictionless", "USDJPY_avg_net",
                "USDJPY_t", "EURJPY_avg_net", "EURJPY_t", "AUDJPY_avg_net", "AUDJPY_t", "USDJPY_avg_min"]
    key = "USDJPY_avg_net" if sub == "tky" else "raw_avg_net"
    print(df[cols].sort_values(key, ascending=False).round(3).to_string())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", choices=["rn", "ldn", "tky", "show"], default=None)
    ap.add_argument("--sub", default=None)
    a = ap.parse_args()
    t0 = time.time()
    if a.stage in ("rn", "ldn", "tky"):
        run_is(a.stage)
        show_is(a.stage)
    elif a.stage == "show":
        show_is(a.sub)
    else:
        final()
    print(f"done in {time.time() - t0:.0f}s")


# ================================================================================ final
RUNS = [("base", 1.0, 0), ("cost1.5", 1.5, 0), ("cost2", 2.0, 0), ("frictionless", 0.0, 0),
        ("delay1", 1.0, 1), ("delay2", 1.0, 2)]
DECOMP_WINDOWS = ["post_30", "slow_1500"]


def _ctx_for(sym: str, sub: str) -> Ctx:
    m1 = _load(sym, IS_START, OOS_END)
    us = _load_us500(IS_START - pd.Timedelta(days=40), OOS_END) if sub == "ldn" else None
    return Ctx(sym, m1, us)


def _eval_pair_final(args):
    sym, cfg, kind = args
    t0 = time.time()
    if kind == "decomp":
        # frictionless gotobi moves of USDJPY (synthetic) and its two raw legs, JPY-buying /
        # USD-selling direction: USDJPY short, EURJPY short, EURUSD long
        ctx = _ctx_for(sym, "tky")
        out = {}
        for w in DECOMP_WINDOWS:
            sig = tky_signals(ctx, dict(window=w, days="gotobi"))
            if sym == "EURUSD":
                sig = sig.assign(dir=-sig["dir"])
            tr = scalp.simulate(ctx.m1, sig, sym, cost_mult=0.0)
            tr["bp"] = tr["gross_pips"] * ctx.pip / tr["entry_px"] * 1e4
            out[w] = tr
        return sym, out
    ctx = _ctx_for(sym, cfg["sub"])
    cache: dict = {}
    sig = build(ctx, cfg, cache)
    runs = {}
    plan = RUNS if kind == "full" else [r for r in RUNS if r[0] in ("base", "frictionless", "cost2")]
    for name, cm, dl in plan:
        s = sig if dl == 0 else build(ctx, cfg, cache, delay=dl)
        runs[name] = scalp.simulate(ctx.m1, s, sym, cost_mult=cm)
    if kind == "full":
        rng = np.random.default_rng(sum(map(ord, sym)) + 7)
        rs = sig.assign(dir=rng.choice([-1.0, 1.0], size=len(sig)))
        runs["random"] = scalp.simulate(ctx.m1, rs, sym, cost_mult=1.0)
    print(f"  final {sym} {cfg.get('name', cfg.get('mode'))} [{kind}] {time.time() - t0:.0f}s", flush=True)
    return sym, runs


def _run_set(cfg: dict, pairs: list[str], kind: str) -> dict:
    with ProcessPoolExecutor(WORKERS) as ex:
        out = dict(ex.map(_eval_pair_final, [(s, cfg, kind) for s in pairs]))
    keys = out[pairs[0]].keys()
    return {k: pd.concat([out[s][k] for s in pairs], ignore_index=True) for k in keys}


def _split(tr):
    return tr[tr.entry_time < IS_END], tr[tr.entry_time >= IS_END]


def _logged_finals() -> set:
    if not LOG.path.exists():
        return set()
    recs = [json.loads(x) for x in open(LOG.path)]
    return {(r["params"].get("final_name"), r["params"].get("pair"), r.get("period"))
            for r in recs if str(r.get("period", "")).startswith("final")}


def _log_final(name: str, cfg: dict, base: pd.DataFrame, period: str):
    done = _logged_finals()
    for s in sorted(base.symbol.unique()):
        if (name, s, period) in done:
            continue
        b = base[base.symbol == s]
        ins, oos = _split(b)
        LOG.log({"final_name": name, "pair": s, **cfg},
                {"is": summarize_trades(ins), "oos": summarize_trades(oos)}, period=period)


def verdict(runs) -> dict:
    ins, oos = _split(runs["base"])
    s_is, s_oos = summarize_trades(ins), summarize_trades(oos)
    oos15 = _split(runs["cost1.5"])[1]
    yr = oos.groupby(oos.entry_time.dt.year).net_pips.sum()
    drop = oos[oos.entry_time.dt.year != yr.idxmax()] if len(yr) else oos
    checks = {
        "IS 平均ネット > 0": s_is["avg_net_pips"] > 0,
        "OOS 平均ネット > 0": s_oos["avg_net_pips"] > 0,
        "OOS t値 >= 2.0": s_oos["t_stat"] >= 2.0,
        "OOS 取引数 >= 200": s_oos["n"] >= 200,
        "OOS コスト1.5倍でも > 0": len(oos15) > 0 and oos15.net_pips.mean() > 0,
        "OOS 最良年を除いても > 0": len(drop) > 0 and drop.net_pips.mean() > 0,
    }
    return {"is": s_is, "oos": s_oos, "checks": checks, "survives": all(checks.values()),
            "drop_best_year": float(drop.net_pips.mean()) if len(drop) else float("nan"),
            "best_year": int(yr.idxmax()) if len(yr) else None}


def final():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    cache = os.environ.get("LEVELS_FLOWS_CACHE")          # optional pickle (report iteration)
    if cache and Path(cache).exists():
        with open(cache, "rb") as fh:
            return _write(*pickle.load(fh))
    results, extras = {}, {}
    for cand in FINAL:
        runs = _run_set(cand["cfg"], cand["pairs"], "full")
        runs["base"].to_parquet(OUT_DIR / f"trades_{KEY}_{cand['name']}.parquet")
        _log_final(cand["name"], cand["cfg"], runs["base"], "final")
        results[cand["name"]] = (cand, runs)
        if cand.get("confirm"):
            extras[cand["name"] + "_confirm"] = _run_set(cand["cfg"], cand["confirm"], "light")
            _log_final(cand["name"], cand["cfg"], extras[cand["name"] + "_confirm"]["base"],
                       "final_confirm")
        if cand.get("reference"):
            ref = cand["reference"]
            extras[ref["name"]] = _run_set(ref["cfg"], cand["pairs"], "full")
            extras[ref["name"] + "_confirm"] = _run_set(ref["cfg"], cand.get("confirm", []), "light")
            _log_final(ref["name"], ref["cfg"], extras[ref["name"]]["base"], "final_reference")
    extras["decomp"] = _run_set({}, ["USDJPY", "EURJPY", "EURUSD"], "decomp")
    if cache:
        with open(cache, "wb") as fh:
            pickle.dump((results, extras), fh)
    _write(results, extras)


def _write(results, extras):
    REPORT.write_text(report_text(results, extras))
    print(REPORT.read_text())


# =============================================================================== report
def f(x, d=2):
    if x is None or (isinstance(x, float) and not np.isfinite(x)):
        return "-"
    if isinstance(x, (int, np.integer)):
        return f"{x:,}"
    return f"{x:+.{d}f}"


def _row(name, tr, extra: str = "") -> str:
    s = summarize_trades(tr)
    if not s["n"]:
        return f"| {name} | 0 | - | - | - | - | - | - |"
    sd = tr.net_pips.std(ddof=1)
    return (f"| {name} | {s['n']:,} | {s['trades_per_year']:.0f} | {s['win_rate']:.1%} "
            f"| {f(s['avg_gross_pips'])} | {f(s['avg_net_pips'])} | {sd:.1f} | {s['t_stat']:+.2f} |")


HDR = ["| 区間・条件 | 取引数 | 年あたり | 勝率 | 平均グロス(スプレッド・滑り後、手数料前) | 平均ネット(pips) | 標準偏差 | t値 |",
       "|---|---:|---:|---:|---:|---:|---:|---:|"]


def win_expectancy(tr) -> str:
    net = tr.net_pips
    w, lo = net[net > 0], net[net <= 0]
    if not len(w) or not len(lo):
        return "-"
    aw, al = w.mean(), -lo.mean()
    be = al / (aw + al)
    return (f"勝率 {len(w) / len(net):.1%}、平均利益 {aw:.2f} pips、平均損失 {al:.2f} pips → "
            f"損益分岐の勝率 {be:.1%}、期待値 {net.mean():+.2f} pips/回")


def _pairs_label(pairs):
    return ", ".join(f"{s}（合成）" if s in SYN else s for s in pairs)


def _t(x) -> float:
    x = np.asarray(x, float)
    return float(x.mean() / x.std(ddof=1) * math.sqrt(len(x))) if len(x) > 1 and x.std() > 0 else float("nan")


def robustness(runs) -> dict:
    b = runs["base"]
    ins, oos = _split(b)
    di = ins.groupby(ins.entry_time.dt.normalize()).net_pips.mean()
    do = oos.groupby(oos.entry_time.dt.normalize()).net_pips.mean()
    pm = oos.groupby("symbol").net_pips.mean()
    best = pm.idxmax()
    rest = oos[oos.symbol != best].net_pips
    return {"is_day_t": _t(di), "is_days": len(di), "oos_day_t": _t(do), "oos_days": len(do),
            "best_pair": best, "ex_best_pair": float(rest.mean()) if len(rest) else float("nan"),
            "ex_best_pair_t": _t(rest), "ex_best_pair_n": len(rest)}


def candidate_section(cand, runs, v, extras) -> list[str]:
    L = [f"### 候補 `{cand['name']}`", "",
         f"* ルール: {cand['rule']}",
         f"* ペア: {_pairs_label(cand['pairs'])}",
         f"* 選定理由（IS のみ）: {cand['why']}", ""] + HDR
    ins, oos = _split(runs["base"])
    L += [_row("IS 2005-2014（コスト1.0）", ins), _row("**OOS 2015-2020.5（コスト1.0）**", oos)]
    for k, lab in [("cost1.5", "OOS コスト1.5倍"), ("cost2", "OOS コスト2倍"),
                   ("frictionless", "OOS 摩擦ゼロ（スプレッド・滑り・手数料なし）"),
                   ("delay1", "OOS エントリー1分遅れ"), ("delay2", "OOS エントリー2分遅れ"),
                   ("random", "OOS 同じ時刻・ランダム方向")]:
        L.append(_row(lab, _split(runs[k])[1]))
    L += ["", "IS 側の同じ比較:", ""] + HDR
    for k, lab in [("frictionless", "IS 摩擦ゼロ"), ("cost1.5", "IS コスト1.5倍"), ("cost2", "IS コスト2倍"),
                   ("delay1", "IS 1分遅れ"), ("delay2", "IS 2分遅れ"), ("random", "IS ランダム方向")]:
        L.append(_row(lab, _split(runs[k])[0]))
    L += ["", "生き残り判定:", ""]
    for k, ok in v["checks"].items():
        L.append(f"* {'OK' if ok else 'NG'}: {k}")
    L += [f"* 最良年 {v['best_year']} を除いた OOS 平均: {f(v['drop_best_year'])} pips/回",
          f"* **判定: {'生き残り' if v['survives'] else '不合格'}**", "",
          "年別（コスト1.0、候補のペア合算）:", "",
          "| 年 | 区間 | 取引数 | 勝率 | 平均ネット | 合計ネット(pips) | 摩擦ゼロ平均 | コスト1.5倍 平均 |",
          "|---|---|---:|---:|---:|---:|---:|---:|"]
    base, fr, c15 = runs["base"], runs["frictionless"], runs["cost1.5"]
    fy = fr.groupby(fr.entry_time.dt.year).gross_pips.mean()
    cy = c15.groupby(c15.entry_time.dt.year).net_pips.mean()
    for y, g in base.groupby(base.entry_time.dt.year):
        L.append(f"| {y} | {'IS' if y < IS_END.year else 'OOS'} | {len(g):,} | {(g.net_pips > 0).mean():.0%} "
                 f"| {f(g.net_pips.mean())} | {g.net_pips.sum():+,.0f} | {f(fy.get(y, np.nan))} "
                 f"| {f(cy.get(y, np.nan))} |")
    conf = extras.get(cand["name"] + "_confirm")
    L += ["", "ペア別（コスト1.0）:", "",
          "| ペア | IS 取引数 | IS 平均ネット | IS t値 | IS 摩擦ゼロ | OOS 取引数 | OOS 勝率 | OOS 平均ネット | OOS t値 | OOS 摩擦ゼロ |",
          "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    rows = [(s, base, fr, "") for s in cand["pairs"]]
    if conf is not None:
        rows += [(s, conf["base"], conf["frictionless"], "（確認用、候補外）") for s in cand["confirm"]]
    for s, b_all, f_all, tag in rows:
        bi, bo = _split(b_all[b_all.symbol == s])
        fi, fo = _split(f_all[f_all.symbol == s])
        si, so = summarize_trades(bi), summarize_trades(bo)
        L.append(f"| {s}{'（合成）' if s in SYN else ''}{tag} | {si['n']:,} | {f(si['avg_net_pips'])} | {f(si['t_stat'])} "
                 f"| {f(fi.gross_pips.mean())} | {so['n']:,} | {so.get('win_rate', 0):.0%} | {f(so['avg_net_pips'])} "
                 f"| {f(so['t_stat'])} | {f(fo.gross_pips.mean())} |")
    rb = robustness(runs)
    L += ["", "補足の頑健性チェック（事前に決めた生き残り基準には含めない）:", "",
          f"* 同じ日の取引をまとめた t 値（日ごとに候補ペアの平均ネットを取り、日数で t を計算。"
          f"同じ日の複数ペアは同じフローで動くので、取引単位の t は割り引いて見る必要があります）: "
          f"IS {rb['is_day_t']:+.2f}（{rb['is_days']:,}日）、OOS {rb['oos_day_t']:+.2f}（{rb['oos_days']:,}日）"]
    if len(cand["pairs"]) > 1:
        L.append(f"* OOS で最も良かったペア（{rb['best_pair']}）を除いた OOS 平均ネット: "
                 f"{f(rb['ex_best_pair'])} pips/回（t={rb['ex_best_pair_t']:+.2f}、{rb['ex_best_pair_n']:,}回）")
    rc = oos.reason.value_counts()
    L += ["", "出口の内訳（OOS）: " + "、".join(f"{k} {int(rc.get(k, 0)):,}" for k in ["tp", "sl", "time"]),
          "", "勝率と期待値（OOS、コスト1.0）: " + win_expectancy(oos),
          "", "同じ時刻・ランダム方向（OOS）: " + win_expectancy(_split(runs["random"])[1]), ""]
    return L


# ---------------------------------------------------------------- IS tables (from the log)
def rn_table(df: pd.DataFrame) -> list[str]:
    L = ["| 節目 | モード | TP | SL | 時間 | 取引数 | 勝率 | 摩擦ゼロ平均 | コスト込み平均 | t値 | 正のペア数(6) | USDJPY(合成) コスト込み |",
         "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for r in df.sort_values("raw_avg_net", ascending=False).to_dict("records"):
        npos = sum((r.get(f"{s}_avg_net") or -1) > 0 for s in RAW)
        L.append(f"| {r['cls']} | {r['mode']} | {r['tp']:g} | {r['sl']:g} | {r['hold']:g}分 | {r['raw_n']:,} "
                 f"| {r['raw_win']:.0%} | {f(r['raw_avg_frictionless'])} | {f(r['raw_avg_net'])} | {r['raw_t']:+.1f} "
                 f"| {npos} | {f(r['USDJPY_avg_net'])} |")
    return L


def rn_fwd_table(df: pd.DataFrame) -> list[str]:
    L = ["| 節目 | モード | シグナル数(6ペア) | 次足始値から 5分 | 15分 | 30分 | 節目の価格から 5分 | 15分 | 30分 | 次足始値の節目からの距離 |",
         "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
    d = df[(df.tp == RN_SHAPES[0][0]) & (df.sl == RN_SHAPES[0][1])]
    for r in d.to_dict("records"):
        w = np.array([r[f"{s}_n_signals"] for s in RAW], float)

        def pw(k):
            v = np.array([r[f"{s}_{k}"] for s in RAW], float)
            return float((v * w).sum() / w.sum())
        lv = [f(pw(f"lvl{h}")) for h in FWD_H] if r["mode"] == "fade" else ["（先読み）"] * 3
        L.append(f"| {r['cls']} | {r['mode']} | {int(w.sum()):,} | " + " | ".join(f(pw(f"mkt{h}")) for h in FWD_H)
                 + " | " + " | ".join(lv) + f" | {f(-pw('gap_open_vs_level'))} |")
    return L


LDN_JA = {
    "pre_mom1h_all": "全営業日: 14:30→15:29 の動きの方向に 15:30 エントリー → 16:00",
    "pre_mom1h_me": "月末のみ: 14:30→15:29 の方向に 15:30 → 16:00",
    "pre_mom1h_big_all": "全営業日: 14:30→15:29 の方向に 15:30 → 16:00（動き 10 pips 以上の日だけ）",
    "pre_mom45_all": "全営業日: 15:00→15:44 の方向に 15:45 → 16:00",
    "pre_mom45_me": "月末のみ: 15:00→15:44 の方向に 15:45 → 16:00",
    "me_fx_pre30": "月末: 月初来でドル高ならドル売り 15:30 → 16:00",
    "me_eq_pre30": "月末: US500 月初来プラスならドル売り 15:30 → 16:00",
    "me_fx_pre60": "月末: 月初来でドル高ならドル売り 15:00 → 16:00",
    "me_eq_pre60": "月末: US500 月初来プラスならドル売り 15:00 → 16:00",
    "post_rev_1605_all": "全営業日: 15:30→16:04 の動きに逆張り 16:05 → 16:30",
    "post_rev_1605_me": "月末のみ: 15:30→16:04 の動きに逆張り 16:05 → 16:30",
    "post_rev_1605_big_all": "全営業日: 15:30→16:04 の動きに逆張り 16:05 → 16:30（動き 10 pips 以上）",
    "post_rev_1600_all": "全営業日: 15:30→15:59 の動きに逆張り 16:00 → 16:30",
    "post_rev_1600_me": "月末のみ: 15:30→15:59 の動きに逆張り 16:00 → 16:30",
    "me_fx_post": "月末: フィックス後に月初来のドルの方向へ戻す 16:05 → 16:30",
    "me_eq_post": "月末: フィックス後に US500 ルールの逆 16:05 → 16:30",
}


def ldn_table(df: pd.DataFrame) -> list[str]:
    L = ["| 設定 | 内容（ロンドン時間） | 取引数 | 勝率 | 摩擦ゼロ平均 | コスト込み平均 | t値 | " +
         " | ".join(LDN_PAIRS) + " |", "|---|---|---:|---:|---:|---:|---:|" + "---:|" * len(LDN_PAIRS)]
    for r in df.sort_values("raw_avg_net", ascending=False).to_dict("records"):
        L.append(f"| {r['name']} | {LDN_JA[r['name']]} | {r['raw_n']:,} | {r['raw_win']:.0%} "
                 f"| {f(r['raw_avg_frictionless'])} | {f(r['raw_avg_net'])} | {r['raw_t']:+.1f} | "
                 + " | ".join(f(r[f"{s}_avg_net"]) for s in LDN_PAIRS) + " |")
    return L


TKY_JA = {"pre_0930": "09:30 買い → 09:55", "pre_0945": "09:45 買い → 09:55", "pre_0950": "09:50 買い → 09:55",
          "post_5": "09:55 売り → 10:00", "post_10": "09:55 売り → 10:05", "post_15": "09:55 売り → 10:10",
          "post_30": "09:55 売り → 10:25", "slow_1500": "09:55 売り → 15:00（既存・遅い版）"}


def tky_table(df: pd.DataFrame) -> list[str]:
    L = ["| 日 | 窓（JST、XXXJPY） | USDJPY(合成) 取引数 | 勝率 | 摩擦ゼロ | コスト込み | t値 | 平均保有 | pips/分 "
         "| EURJPY 摩擦ゼロ / コスト込み (t) | AUDJPY 摩擦ゼロ / コスト込み (t) |",
         "|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|"]
    order = list(TKY_WINDOWS)
    df = df.assign(_o=df.window.map(order.index), _d=(df.days != "gotobi").astype(int)).sort_values(["_d", "_o"])
    for r in df.to_dict("records"):
        L.append(f"| {'五十日' if r['days'] == 'gotobi' else '五十日以外'} | {TKY_JA[r['window']]} | {r['USDJPY_n']:,} "
                 f"| {r['USDJPY_win']:.0%} | {f(r['USDJPY_avg_frictionless'])} | {f(r['USDJPY_avg_net'])} "
                 f"| {r['USDJPY_t']:+.1f} | {r['USDJPY_avg_min']:.0f}分 | {r['USDJPY_avg_net'] / r['USDJPY_avg_min']:+.3f} "
                 f"| {f(r['EURJPY_avg_frictionless'])} / {f(r['EURJPY_avg_net'])} ({r['EURJPY_t']:+.1f}) "
                 f"| {f(r['AUDJPY_avg_frictionless'])} / {f(r['AUDJPY_avg_net'])} ({r['AUDJPY_t']:+.1f}) |")
    return L


def fast_slow_table(cand_runs, ref_runs) -> list[str]:
    L = ["| 版 | 区間 | 取引数 | 勝率 | 平均ネット(pips) | 標準偏差 | t値 | 平均保有(分) | ネット/分 | 摩擦ゼロ | コスト2倍 | 1分遅れ | 2分遅れ |",
         "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for lab, runs in [("速い版 09:55→10:25", cand_runs), ("遅い版 09:55→15:00", ref_runs)]:
        for pi, per in enumerate(["IS", "OOS"]):
            b = _split(runs["base"])[pi]
            s = summarize_trades(b)
            fr = _split(runs["frictionless"])[pi].gross_pips.mean()
            c2 = _split(runs["cost2"])[pi].net_pips.mean()
            d1 = _split(runs["delay1"])[pi].net_pips.mean()
            d2 = _split(runs["delay2"])[pi].net_pips.mean()
            L.append(f"| {lab} | {per} | {s['n']:,} | {s['win_rate']:.0%} | {f(s['avg_net_pips'])} | {b.net_pips.std():.1f} "
                     f"| {s['t_stat']:+.2f} | {s['avg_minutes']:.0f} | {s['avg_net_pips'] / s['avg_minutes']:+.3f} "
                     f"| {f(fr)} | {f(c2)} | {f(d1)} | {f(d2)} |")
    return L


def decomp_table(dec) -> list[str]:
    L = ["| 窓 | 区間 | USDJPY 売り（合成） | EURJPY 売り（実データ） | EURUSD 買い（実データ） | EURJPY + EURUSD | 日数 |",
         "|---|---|---:|---:|---:|---:|---:|"]
    for w in DECOMP_WINDOWS:
        tr = dec[w]
        tr = tr.assign(day=tr.entry_time.dt.normalize())
        piv = tr.pivot_table(index="day", columns="symbol", values="bp", aggfunc="first").dropna()
        for pi, per in enumerate(["IS", "OOS"]):
            p = piv[piv.index < IS_END] if pi == 0 else piv[piv.index >= IS_END]
            L.append(f"| {TKY_JA[w]} | {per} | {p.USDJPY.mean():+.2f} bp | {p.EURJPY.mean():+.2f} bp "
                     f"| {p.EURUSD.mean():+.2f} bp | {(p.EURJPY + p.EURUSD).mean():+.2f} bp | {len(p):,} |")
    return L


def report_text(results, extras) -> str:
    rn, ldn, tky = load_log("rn"), load_log("ldn"), load_log("tky")
    n_cfg = len(rn) + len(ldn) + len(tky)
    V = {k: verdict(r) for k, (c, r) in results.items()}
    L = [f"# 節目・フィキシング・月末フロー・東京仲値の高速スキャルピング検証 — {KEY}", "",
         "再現: `python scripts/scalp_levels_flows.py`（最終評価とこのレポート）、"
         "`--stage rn|ldn|tky`（IS 探索、試行ログ `reports/trials/scalp_levels_flows.jsonl` に追記）。", ""]
    L += summary(results, extras, V, rn, ldn, tky)
    L += ["", "## 1. 何を検証したか", "",
          f"* データ: OANDA M1 仲値 2005-01〜2020-05-14。主証拠は実データのペア（{', '.join(RAW)}）。"
          "USDJPY は EURJPY÷EURUSD から作った合成で、M1 の高値・安値が広すぎます。そのため節目（高値・安値で判定）では参考扱いにしました。"
          "時刻で入って時刻で出る取引（仲値・フィックス）は始値だけを使うので、合成の歪みは小さくなります（第4節で確認）。",
          "* 約定: fxlab/scalp.py。シグナル足の終値で判断し、次の M1 足の始値で成行。スプレッドは Titan FX ブレード相当 × 時間帯倍率"
          "（サーバー23時 2倍、0時 5倍、1-2時 1.5倍、3-8時 1.2倍）。ほかに滑り、損切りの追加滑り、手数料 720円/lot 往復"
          "（USDJPY 0.72 pips、EURUSD 0.65 pips 相当）。同じ足の中では損切りを優先し、1銘柄1ポジション。",
          "* 手順: IS（2005-2014）だけでルールとパラメータを選びました。選び方は IS を走らせる前にスクリプトの冒頭に固定し、"
          "最終候補（各系統1つ、計3つ）は OOS（2015-2020.5）で1回だけ評価しました。",
          f"* 試した設定数: **{n_cfg} 通り**。内訳は節目 {len(rn)}、ロンドン16時フィックス・月末 {len(ldn)}、東京仲値 {len(tky)}。"
          "すべて試行ログに記録しています。",
          "* (a) 節目（ラウンドナンバー）: 「00」= 1.xx00 / xx.00（100 pips ごと）、「50」= 1.xx50 / xx.50。"
          "その日（サーバー日）の確定済みの足の高値より上（安値より下）にある最初の節目に、M1 の高値（安値）が届いた足を「その日の初タッチ」とします。"
          "モードは3つです。`fade` は来た方向と逆に入る（新高値で節目に触れたら売り）。`fade_rej` は、タッチした足が節目の手前側で引けたときだけ逆張り。"
          "`break` は、節目を 1 pip 以上抜けて引けたときだけ順張り。出口は TP/SL/時間切れの4形"
          "（5/5/30分、10/10/60分、4/10/30分、10/4/30分）。対象はサーバー3-22時の平日。",
          "* (b) ロンドン16時（WM/R）フィックス: 時刻はすべてロンドン現地時間で、英米の夏時間のずれも正確に扱っています。"
          "調べたのは、フィックス前のモメンタム、月末のリバランス代理変数、フィックス後の反転です。"
          "代理変数は2つ。そのペアの月初来のドルの動き（ドル高ならドル売り）と、US500（S&P500 CFD、OANDA）の月初来リターン（プラスならドル売り）です。"
          "月末は「その月の最後の平日（ロンドン日付）」。出口は時刻で決め、損切りは 0.5×日足ATR(14)（前日までの確定足）。利確はなし。",
          "* (c) 東京仲値 09:55 JST: 五十日（fxlab/strategies/seasonality.py の暦）と、五十日以外の日本の営業日で比べました。"
          "仲値前の円売り（XXXJPY 買い）は 09:30/09:45/09:50 に入って 09:55 に決済。"
          "仲値後の円買い（売り）は 09:55 に入って 5/10/15/30 分後に決済。比較対象の遅い版（既存戦略）は 09:55→15:00 です。"
          "損切りは 0.5×日足ATR(14)。",
          "* 遅延テスト: シグナルを 1本・2本後ろにずらしました（= 1分・2分遅れの約定）。"
          "節目は TP/SL/保有時間をそのまま使います。時刻で出る取引は決済時刻を固定するので、遅れた分だけ保有が短くなります。",
          "* 「摩擦ゼロ」= cost_mult=0（スプレッド・滑り・手数料なし）= コスト前のグロスエッジ。"
          "「同じ時刻・ランダム方向」= シグナルと同じ時刻に、方向だけコイン投げで決めた取引（方向を当てる力がゼロのときの成績）。", "",
          "## 2. IS 結果（2005-2014）", "",
          "### 2a. 節目の初タッチ（実6ペア合算）", ""]
    L += rn_table(rn)
    L += ["", "節目タッチ後の仲値の動き（IS、実6ペアのシグナル数加重平均、取引方向を正、pips、コストなし）。"
          "「次足始値から」はシミュレーターと同じ成行の入り方です。「節目の価格から」は、節目に指値を置いて待っていた場合の入り方です"
          "（タッチした足の中で約定。`fade` だけが実行可能です。`fade_rej`/`break` は足の終値を見てから決める条件なので、節目での約定は先読みになります）。"
          "最後の列は、次足始値が節目からどれだけ進んだ位置にあるかです（取引方向を正）。", ""]
    L += rn_fwd_table(rn)
    L += ["", "### 2b. ロンドン16時フィックス・月末（EURUSD, GBPUSD, AUDUSD, USDCAD 合算）", ""]
    L += ldn_table(ldn)
    L += ["", "### 2c. 東京仲値 09:55 JST（XXXJPY、損切り 0.5×ATR）", ""]
    L += tky_table(tky)
    L += ["", "## 3. 最終候補（OOS は1回だけ評価）", ""]
    for name, (cand, runs) in results.items():
        L += candidate_section(cand, runs, V[name], extras)
    L += tokyo_section(results, extras)
    L += discussion(results, extras, V, rn, ldn, tky)
    return "\n".join(L) + "\n"


def _o(runs, k="base", per=1) -> dict:
    return summarize_trades(_split(runs[k])[per])


def _we(tr) -> dict:
    net = tr.net_pips
    w, lo = net[net > 0], net[net <= 0]
    aw, al = (w.mean() if len(w) else 0.0), (-lo.mean() if len(lo) else 0.0)
    return {"win": float((net > 0).mean()), "aw": float(aw), "al": float(al),
            "be": float(al / (aw + al)) if aw + al > 0 else float("nan"), "exp": float(net.mean())}


def summary(results, extras, V, rn, ldn, tky) -> list[str]:
    surv = [n for n in results if V[n]["survives"]]
    _, me = results["me_eq_pre60"]
    _, gp = results["gotobi_post30"]
    _, rr = results["rn50_fade_rej"]
    slow = extras["gotobi_slow_1500"]
    vm, rbm = V["me_eq_pre60"], robustness(me)
    mi, mo = vm["is"], vm["oos"]
    gi, go = V["gotobi_post30"]["is"], V["gotobi_post30"]["oos"]
    si, so = _o(slow, per=0), _o(slow)
    ri, ro = V["rn50_fade_rej"]["is"], V["rn50_fade_rej"]["oos"]
    fast_is = tky[(tky.days == "gotobi") & (tky.window != "slow_1500")]
    mo_b = _split(me["base"])[1]
    yr = mo_b.groupby(mo_b.entry_time.dt.year).net_pips.mean()
    npos_y, n_y = int((yr > 0).sum()), len(yr)
    fades = rn[rn["mode"] != "break"].raw_avg_frictionless
    brk = rn[rn["mode"] == "break"].raw_avg_frictionless
    ng = tky[tky.days == "non_gotobi"]
    ng_fast = ng[ng.window != "slow_1500"]
    ng_slow = ng[ng.window == "slow_1500"].iloc[0]
    L = ["## 結論", "",
         f"* **生き残った候補: {len(surv)} / {len(results)}**（{', '.join(surv) if surv else 'なし'}）。"
         "残ったのは「速く判断する」手法ではありません。**カレンダーで前もって決まっている大口フロー**に、決まった時刻に乗る手法でした。",
         f"* **月末のロンドン16時フィックス前のドル売買（`me_eq_pre60`）**: 月の最終平日のロンドン15:00に入り、16:00（WM/R フィックス）に決済します。"
         "方向は、US500 の月初来リターンがプラスならドル売り、マイナスならドル買い（海外投資家の為替ヘッジのリバランス、Melvin & Prins 2015 の仕組み）。",
         f"  * EURUSD・GBPUSD・AUDUSD・USDCAD 合算で IS {mi['avg_net_pips']:+.2f} pips/回（t={mi['t_stat']:+.1f}、勝率 {mi['win_rate']:.0%}）"
         f"→ **OOS {mo['avg_net_pips']:+.2f} pips/回（t={mo['t_stat']:+.2f}、勝率 {mo['win_rate']:.0%}、{mo['n']}回）**。",
         f"  * コスト1.5倍 {_o(me, 'cost1.5')['avg_net_pips']:+.2f}、2倍 {_o(me, 'cost2')['avg_net_pips']:+.2f}。"
         f"1分遅れ {_o(me, 'delay1')['avg_net_pips']:+.2f}、2分遅れ {_o(me, 'delay2')['avg_net_pips']:+.2f}。"
         f"最良年 {vm['best_year']} を除いても {vm['drop_best_year']:+.2f}。OOS の年別平均は {npos_y} / {n_y} 年でプラスでした。",
         f"  * ただし薄い結果です。同じ日の4ペアは同じフローで動くので、日単位でまとめると OOS の t は {rbm['oos_day_t']:+.2f}（{rbm['oos_days']}日）に下がります。"
         f"OOS の利益の多くは GBPUSD（{_o({'b': me['base'][me['base'].symbol == 'GBPUSD']}, 'b')['avg_net_pips']:+.1f} pips/回）から来ており、"
         f"{rbm['best_pair']} を除くと {rbm['ex_best_pair']:+.2f} pips/回（t={rbm['ex_best_pair_t']:+.2f}）です。"
         "取引できるのは月1日だけで、年12日×4ペアです。",
         f"* **東京仲値の速い版は、遅い版に勝てませんでした**。IS で最良の速い版（五十日 09:55 売り→10:25）は "
         f"IS {gi['avg_net_pips']:+.2f} → OOS {go['avg_net_pips']:+.2f} pips/回（t={go['t_stat']:+.2f}）で不合格です。",
         f"  * 既存の遅い版（09:55→15:00）は同じ条件で IS {si['avg_net_pips']:+.2f} → OOS {so['avg_net_pips']:+.2f} pips/回。1回あたりのネットは遅い版の方が大きくなりました。",
         f"  * IS で試した7つの速い窓の最良値は {fast_is.USDJPY_avg_net.max():+.2f} pips/回で、遅い版の {si['avg_net_pips']:+.2f} に届きません。",
         f"  * 仲値直後の下げ自体は OOS でも残っています（摩擦ゼロ {_o(gp, 'frictionless')['avg_net_pips']:+.2f} pips、t={_o(gp, 'frictionless')['t_stat']:+.1f}）。"
         "しかし 30 分で取れる値幅は約 2 pips で、往復コスト約 1.7 pips（スプレッド＋滑り＋手数料 0.72 pips）がそのほとんどを消します。"
         "保有を短くしても、コストは1回ごとに同じだけ掛かります。",
         f"  * 五十日以外の日にも、仲値前の上げと仲値後の下げはコスト前で小さく出ています（USDJPY の速い窓で "
         f"{ng_fast.USDJPY_avg_frictionless.min():+.1f}〜{ng_fast.USDJPY_avg_frictionless.max():+.1f} pips）。"
         f"しかし速い窓はコスト込みですべてマイナスで、遅い版も {ng_slow.USDJPY_avg_net:+.2f} pips/回（t={ng_slow.USDJPY_t:+.1f}）と有意ではありません。",
         f"* **節目（ラウンドナンバー）の初タッチは全滅**: 24 設定すべてで IS がマイナス（最良 {rn.raw_avg_net.max():+.2f} pips/回）。"
         f"最終候補は OOS {ro['avg_net_pips']:+.2f} pips/回で、コスト前でも OOS {_o(rr, 'frictionless')['avg_net_pips']:+.2f} pips です。",
         f"  * 節目での小さな反発はあります（逆張り16設定のコスト前 {fades.min():+.2f}〜{fades.max():+.2f} pips）。"
         f"一方、抜けた後の順張りはコスト前でもほぼマイナスでした（{brk.min():+.2f}〜{brk.max():+.2f} pips）。",
         "  * 節目に指値を置いて待つ入り方は、成行よりさらに悪くなりました（第2a節）。指値は、価格が節目を越えて進んでいく場面でも必ず約定します（逆選択）。"
         "そのため、約定直後に平均で約 1 pip 不利になります。",
         f"* **勝率と期待値**: 勝率は TP/SL の形でほぼ自由に変えられます（節目の同じシグナルで IS 勝率 "
         f"{rn[(rn.cls == '50') & (rn['mode'] == 'fade_rej')].raw_win.min():.0%}〜{rn[(rn.cls == '50') & (rn['mode'] == 'fade_rej')].raw_win.max():.0%}）。"
         "しかし期待値はどの形でもマイナスでした。生き残った月末フィックスは勝率 60% 前後で、平均利益と平均損失がほぼ同じ大きさです。"
         "つまり「方向が当たる」ことで勝っています。同じ時刻にランダムな方向で入ると勝率 50% 前後・期待値ほぼゼロなので、差は方向の当たりです（第5節）。",
         f"* **速さについて**: 分単位の遅れは、フローの取引で効きます。東京仲値の速い版は、エントリーが1分遅れると OOS {go['avg_net_pips']:+.2f} → "
         f"{_o(gp, 'delay1')['avg_net_pips']:+.2f}、2分遅れると {_o(gp, 'delay2')['avg_net_pips']:+.2f} pips/回。仲値直後の下げは最初の数分に集中しているからです。",
         "  * ただし、これは「判断の速さ」ではなく「決まった時刻に確実に約定する」ことの問題です。何をするかは前日までにカレンダーで決まっています。",
         "  * 1分足の終値を見てから判断する手法（節目）では、どれだけ速く判断しても、コスト前のエッジがコストより小さいという事実は変わりませんでした（第6節）。",
         ]
    return L


def discussion(results, extras, V, rn, ldn, tky) -> list[str]:
    _, me = results["me_eq_pre60"]
    _, gp = results["gotobi_post30"]
    _, rr = results["rn50_fade_rej"]
    slow = extras["gotobi_slow_1500"]
    mo_b = _split(me["base"])[1]
    dsum = mo_b.groupby(mo_b.entry_time.dt.normalize()).net_pips.sum()
    L = ["", "## 5. 勝率と期待値の関係", "",
         "期待値（1回あたりのネット pips）= 勝率 × 平均利益 − (1 − 勝率) × 平均損失。損益分岐の勝率 = 平均損失 ÷ (平均利益 + 平均損失)。", "",
         "| ルール | 条件 | 勝率 | 平均利益 | 平均損失 | 損益分岐の勝率 | 期待値(pips/回) |",
         "|---|---|---:|---:|---:|---:|---:|"]
    rows = [("月末フィックス me_eq_pre60", "OOS コスト込み", _split(me["base"])[1]),
            ("月末フィックス me_eq_pre60", "OOS 同じ時刻・ランダム方向", _split(me["random"])[1]),
            ("月末フィックス me_eq_pre60", "OOS 摩擦ゼロ", _split(me["frictionless"])[1].assign(net_pips=lambda d: d.gross_pips)),
            ("東京仲値 速い版 gotobi_post30", "OOS コスト込み", _split(gp["base"])[1]),
            ("東京仲値 速い版 gotobi_post30", "OOS 摩擦ゼロ", _split(gp["frictionless"])[1].assign(net_pips=lambda d: d.gross_pips)),
            ("東京仲値 遅い版（既存）", "OOS コスト込み", _split(slow["base"])[1]),
            ("節目 rn50_fade_rej", "OOS コスト込み", _split(rr["base"])[1]),
            ("節目 rn50_fade_rej", "OOS 摩擦ゼロ", _split(rr["frictionless"])[1].assign(net_pips=lambda d: d.gross_pips))]
    for a, b, tr in rows:
        w = _we(tr)
        L.append(f"| {a} | {b} | {w['win']:.1%} | {w['aw']:.2f} | {w['al']:.2f} | {w['be']:.1%} | {w['exp']:+.2f} |")
    sub = rn[(rn.cls == "50") & (rn["mode"] == "fade_rej")].sort_values("raw_win")
    L += ["", "節目（50 / fade_rej）の出口の形だけを変えた IS 結果（実6ペア合算）:", "",
          "| TP | SL | 時間 | 勝率 | 摩擦ゼロ平均 | コスト込み平均 |", "|---:|---:|---:|---:|---:|---:|"]
    for r in sub.to_dict("records"):
        L.append(f"| {r['tp']:g} | {r['sl']:g} | {r['hold']:g}分 | {r['raw_win']:.0%} | {f(r['raw_avg_frictionless'])} | {f(r['raw_avg_net'])} |")
    L += ["",
          "* 勝率は「どこで利確・損切りするか」でほぼ決まります。TP を小さく SL を大きくすれば勝率は上がりますが、1回の負けが大きくなります。"
          "エッジがなければ、どの形でも期待値はコスト分（約 −1.7〜−2 pips）のマイナスに収束します（上の表と、既存の EURUSD ランダム売買の測定）。",
          "* 勝ち残った月末フィックスは、平均利益と平均損失がほぼ同じ（利確も損切りもほぼ時間決済）です。そのうえで勝率が 60% 前後あります。"
          "つまり勝率の高さが「方向を当てた結果」として出ています。この形の勝率なら意味があります。",
          "* コストは勝率を直接下げます。東京仲値の速い版は摩擦ゼロだと勝率約 60% ですが、コスト込みでは約 49% に落ちます。"
          "1回の値幅が小さい取引ほど、固定のコスト（往復 1.5〜2 pips）が勝ち負けをひっくり返します。",
          "", "## 6. 分単位の速さ（エントリー遅延テスト）と「AI で高速判断」について", "",
          "| ルール | 区間 | 遅れなし | 1分遅れ | 2分遅れ | 摩擦ゼロ |", "|---|---|---:|---:|---:|---:|"]
    for lab, runs in [("月末フィックス me_eq_pre60（60分保有）", me), ("東京仲値 速い版（30分保有）", gp),
                      ("東京仲値 遅い版（300分保有）", slow), ("節目 rn50_fade_rej", rr)]:
        for pi, per in enumerate(["IS", "OOS"]):
            L.append(f"| {lab} | {per} | {f(_o(runs, 'base', pi)['avg_net_pips'])} | {f(_o(runs, 'delay1', pi)['avg_net_pips'])} "
                     f"| {f(_o(runs, 'delay2', pi)['avg_net_pips'])} | {f(_o(runs, 'frictionless', pi)['avg_net_pips'])} |")
    L += ["",
          "* 東京仲値は、仲値直後の数分に値動きが集中しています。1〜2分の遅れで速い版の OOS はマイナスに転じ、遅い版も1分あたり約 "
          f"{(_o(slow)['avg_net_pips'] - _o(slow, 'delay2')['avg_net_pips']) / 2:.1f} pips 削られます（OOS）。"
          "09:55:00 ちょうどに約定させる実装（EA のタイマー、サーバー時刻の確認、約定の確認）が重要です。",
          "* 月末フィックスは60分の取引なので、1〜2分の遅れの影響は小さく済みました。IS ではむしろ良くなり、OOS では1分あたり約 "
          f"{(_o(me)['avg_net_pips'] - _o(me, 'delay2')['avg_net_pips']) / 2:.2f} pips の悪化です。",
          "* 節目の逆張りは、遅れの有無にかかわらずマイナスです。判断を速くしても、元のエッジ（IS のコスト前で最大 "
          f"{rn.raw_avg_frictionless.max():+.2f} pips）が 1.7〜2 pips のコストに届きません。",
          "* **AI で高速判断すれば勝率が上がるか**: この検証の範囲では、答えは「いいえ」です。",
          "  * 残ったエッジは2つとも、カレンダー（月末・五十日）と時刻（16:00・09:55）で前もって決まる大口のフローです。"
          "判断はその場でする必要がなく、普通の MT5 EA（ミリ秒単位で動く）で十分です。",
          "  * 大規模言語モデルのような AI の応答は数秒かかります。むしろ EA より遅くなります。",
          "  * 価格パターンから速く判断する手法（節目、ほかのファミリーの逆張り・ブレイク）は、コスト前のエッジが 1 回 0.1〜1 pips 程度にとどまりました。"
          "EURUSD でも往復約 1.3〜2 pips のコストを超えられません。",
          "  * AI（機械学習）を使うなら、この壁（1回あたり 2 pips 超のグロスエッジ）を超える予測力が必要です。"
          "それを示す証拠は、この M1 データの範囲では見つかっていません。",
          "  * 秒未満の本当の高速取引は、銀行や HFT 業者がサーバーを取引所の隣に置いて行う世界です。個人の MT5 口座で競える領域ではありません。"
          "また、この1分足データでは検証もできません。",
          "", "## 7. 注意点とシミュレーターについて", "",
          "* 月末フィックスの候補は、ペア×月末日で OOS 256 回ですが、独立な日は 64 日しかありません。GBPUSD への依存も大きい結果です。"
          "「本物の効果がまだ残っている可能性が高い」とは言えますが、確実とは言えません。広く知られた効果なので、2020年6月以降に弱まっている可能性もあります。"
          "実弾で使うなら、少額で2020年以降のデータかフォワードテストで確かめてからにしてください。",
          "* 月末や仲値の時刻は、実際にはスプレッドが広がりやすく、約定が滑りやすい時間帯です。シミュレーターの時間帯倍率はサーバー時間の1時間単位"
          "（ロンドン15-16時は 1.0 倍、東京 09:55 は 1.2〜1.5 倍）なので、フィックスの瞬間の広がりは入っていません。"
          "コスト1.5倍・2倍のストレス結果（月末フィックスは2倍でも OOS +3.4 pips/回、t=1.9）を現実的な下限の目安にしてください。",
          "* 1分足なので、1分未満の約定の遅れや、同じ1分の中の値動きの順番は再現できません。"
          "09:55 の「始値」は 09:55:00 以降の最初の気配値です。実際の EA は数秒遅れる可能性があります。",
          "* 合成 USDJPY: 時刻で入って時刻で出る取引では、EURJPY 売り＋EURUSD 買いの合計とほぼ一致しました（第4b節）。"
          "損切りに掛かることもほぼありません。したがって東京仲値の結果は信頼できます。"
          "五十日の仲値の動きの大部分は円の脚（EURJPY でも同じ幅）から来ていて、ドルの脚（EURUSD）の寄与は小さい結果でした。"
          "一方、高値・安値を使う節目のタッチ判定は、合成 USDJPY では信頼できません（参考値にとどめています）。",
          "* 節目に指値を置いて待つ入り方は、scalp.simulate では再現できません（成行のみ）。そのため第2a節ではコストなしのイベントスタディで比べました。",
          "* US500 は OANDA の CFD（ほぼ24時間取引）です。月初来リターンは、シグナル足の時刻までの値だけで計算しています。",
          "", "## 8. 10万円→100万円チャレンジへの含意", "",
          f"* 生き残った月末フィックスは年12日しか取引できません。4ペアを同じロット数で持つと、OOS の1日あたりの合計は平均 {dsum.mean():+.1f} pips、"
          f"標準偏差 {dsum.std():.0f} pips、最悪の日は {dsum.min():+.0f} pips でした。年間の合計は約 {dsum.mean() * 12:+.0f} pips の見込みです"
          "（1ロットなら 1 pip ≒ 1,000円前後）。",
          "* 10倍を短期間で狙うレバレッジを掛けると、1回の月末で口座の大部分が動きます。"
          f"OOS の日単位の勝率は {(dsum > 0).mean():.0%} で、およそ3回に1回は負けます。1回ごとの結果は読めません。"
          "この手法は「期待値がややプラスで、回数の少ない賭け」です。短期で資金を10倍にする道具にはなりません。",
          "* 速いスキャルピング（1日に何十回も売買する手法）は、この検証でも他のファミリーでも、コスト込みの期待値がマイナスでした。"
          "マイナスの期待値の取引を高レバレッジで回数多く繰り返すと、資金はほぼ確実に減ります。",
          ]
    return L


def tokyo_section(results, extras) -> list[str]:
    cand, runs = results["gotobi_post30"]
    ref = extras["gotobi_slow_1500"]
    refc = extras["gotobi_slow_1500_confirm"]
    L = ["## 4. 東京仲値: 速い版と遅い版、合成 USDJPY の信頼性", "",
         "### 4a. 速い版（09:55→10:25）と既存の遅い版（09:55→15:00）、USDJPY、五十日", ""]
    L += fast_slow_table(runs, ref)
    L += ["", "遅い版の実データ円クロス（確認用）:", "",
          "| ペア | IS 取引数 | IS 平均ネット | IS t値 | OOS 取引数 | OOS 平均ネット | OOS t値 | OOS 摩擦ゼロ |",
          "|---|---:|---:|---:|---:|---:|---:|---:|"]
    for s in cand.get("confirm", []):
        bi, bo = _split(refc["base"][refc["base"].symbol == s])
        fo = _split(refc["frictionless"][refc["frictionless"].symbol == s])[1]
        si, so = summarize_trades(bi), summarize_trades(bo)
        L.append(f"| {s} | {si['n']:,} | {f(si['avg_net_pips'])} | {f(si['t_stat'])} | {so['n']:,} "
                 f"| {f(so['avg_net_pips'])} | {f(so['t_stat'])} | {f(fo.gross_pips.mean())} |")
    L += ["", "### 4b. 合成 USDJPY の分解（五十日、コストなし、bp = 0.01%）", "",
          "USDJPY = EURJPY ÷ EURUSD なので、USDJPY 売りのリターン ≒ EURJPY 売り + EURUSD 買い です。"
          "日付をそろえて比べ、仲値の動きがどちらの脚から来ているかを見ます。", ""]
    L += decomp_table(extras["decomp"])
    L += ["", "30分の窓では、合成 USDJPY と2つの実データの脚の合計が一致します。"
          "5時間の遅い版では少しずれます。0.5×ATR の損切りが、脚ごと・合成ごとに別々に掛かるためです。", ""]
    sl_share = {}
    for s, tr in [("USDJPY", runs["base"]), ("EURJPY", extras["gotobi_post30_confirm"]["base"])]:
        sl_share[s] = (tr.reason == "sl").mean()
    L += ["", f"30分の速い版で損切り（0.5×ATR）に掛かった割合: USDJPY（合成）{sl_share['USDJPY']:.1%}、"
          f"EURJPY（実データ）{sl_share['EURJPY']:.1%}。時刻で出る取引では、合成データの広すぎる高値・安値の影響はこの程度に限られます。", ""]
    return L


if __name__ == "__main__":
    main()
