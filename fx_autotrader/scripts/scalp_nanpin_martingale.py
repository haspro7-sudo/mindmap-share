"""ナンピン・マーチン (averaging-down grid / martingale basket EAs) on M1 bid/ask, JPY account.

    python scripts/scalp_nanpin_martingale.py              # final: OOS once + stress + report
    python scripts/scalp_nanpin_martingale.py --stage 1    # IS geometry screen (trial log)
    python scripts/scalp_nanpin_martingale.py --stage 2    # IS take-profit x basket-stop grid
    python scripts/scalp_nanpin_martingale.py --stage 3    # IS entry-signal / first-lot variants

What is simulated (one basket at a time per pair, every order on the side it fills on):
  * first entry: market order at the open of the bar after a signal bar.  Signals: `fade60`
    (fade the last 60 M1 bars' move when it is >= 10 pips), `fade30` (30 bars, >= 5 pips)
    or `alt` (alternate long/short, enter as soon as the previous basket is closed).  First
    entries only Mon-Fri server time, not in server hours 23/00 (rollover), not Friday
    >= 21:00 or Monday < 02:00.  Features use bars <= the signal bar only.
  * averaging down (ナンピン): each time the entry-side quote (ask for a long basket) moves
    G pips against the last fill, another market order is sent (fill = level + slippage,
    or the bar open + slippage on a gap); lot of level n = first lot * m**n rounded to
    0.01 lot; at most L positions.  An add-on needs free margin >= its margin (MT5 rule);
    if not, the EA stops adding.
  * basket take-profit: all positions close when the exit-side quote reaches the
    volume-weighted average entry + Y pips (a broker-side limit: no slippage).
  * optional hard basket stop (stop_k > 0): once no more positions can be added (L reached
    or margin exhausted), a stop sits stop_k * G pips beyond the last fill.
  * account: Titan FX 1:1000 (margin = notional in JPY / 1000, fixed at each fill price),
    stop-out when equity <= 20% of margin (the whole basket is closed at the trigger
    price), zero-cut (a negative balance is reset to 0).  Stops and stop-outs pay slippage +
    the extra stop slippage (as fxlab/scalp.py).
  * costs: Titan Blade half spread x server-hour multiplier (scalp.half_spread_series),
    slippage, 720 JPY/lot round-turn commission (charged at each fill), swap at every server
    rollover (Wed triple) from fxlab.instruments.CostModel (interest differential minus a
    2.5%/yr broker markup; cost_mult scales spread, slippage, commission and the markup).
  * P&L in JPY.  EURJPY/AUDJPY are JPY-quoted.  EURUSD/GBPUSD use a CONSTANT 110 JPY/USD
    for P&L, margin and swap (flagged in the report).
  * Intrabar order is adverse-first: add-ons, stop-out and the hard stop are resolved in
    price order along the move against the basket before the take-profit; after an
    intrabar add-on the (lower) take-profit only counts if the bar CLOSES beyond it.

Two modes:
  * basket study (fresh=True): every basket starts on a fresh 100,000 JPY account with a
    fixed first lot -> per-basket P&L, win rate, MAE.  Survival criteria use the per-basket
    net P&L in "first-lot pips" (JPY / JPY value of one pip of the first lot).
  * rolling-start account study (fresh=False): a 100,000 JPY account started on the first
    trading day of every month, run until 1,000,000 JPY (10x), < 5,000 JPY (ruin) or 12
    months; equity compounds and the stop-out distance moves with the balance.

Protocol (reports/trials/scalp_nanpin_martingale.jsonl logs every configuration):
  stage 1  IS 2005-2014: G {5,10,20,30} x m {1.0,1.3,1.5,2.0} x L {4,8,12}, Y 5, lot 0.01,
           no hard stop, fade60 (48 configurations; cost 1.0 and frictionless).
  stage 2  IS: the best stage-1 geometry of each style (equal-lot grid m=1.0, mild
           martingale m=1.3/1.5, martingale m=2.0) x Y {2,5,10,15} x stop {none,1G,3G}.
  stage 3  IS: the best stage-2 config of each style with entry fade30 / alt and first lot
           0.03 / 0.1.
  final    one candidate per style (best IS in the style), evaluated ONCE on 2015-01-01..
           2020-05-14 plus cost x1.5 / x2, frictionless, first entry delayed 1 and 2 min,
           per year, per pair, and the rolling-start account study.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numba as nb
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fxlab import scalp  # noqa: E402
from fxlab.instruments import INSTRUMENTS, CostModel  # noqa: E402
from fxlab.research import TrialLog  # noqa: E402

FAMILY = "scalp_nanpin_martingale"
KEY = "nanpin_martingale"
LOG = TrialLog(FAMILY)
OUT_DIR = ROOT / "reports" / "scalping"
REPORT = OUT_DIR / f"{KEY}.md"
ROLLING_FILE = OUT_DIR / f"rolling_{KEY}.parquet"
IS_START = pd.Timestamp("2005-01-01")
IS_END = scalp.IS_END                                  # 2015-01-01
OOS_END = pd.Timestamp("2020-05-15")
IS_YEARS = (IS_END - IS_START).days / 365.25
OOS_YEARS = (pd.Timestamp("2020-05-14") - IS_END).days / 365.25

PAIRS = ["EURJPY", "EURUSD", "GBPUSD", "AUDJPY"]        # raw OANDA pairs only
JPY_PER_USD = 110.0                                     # constant conversion (flagged)
BAL0 = 100_000.0
LEVERAGE = 1000.0
STOP_OUT = 0.20
TARGET = 1_000_000.0
RUIN = 5_000.0
COMM_JPY_LOT_RT = 720.0
WORKERS = 2
MAX_DELAY_NS = int(5 * 60e9)
_ROLL_WEIGHT = np.array([0, 1, 1, 3, 1, 1, 0])          # rollover INTO Mon..Sun (engine.py)

ENTRIES = {"fade60": dict(n=60, thr=10.0), "fade30": dict(n=30, thr=5.0), "alt": None}
STAGE1 = dict(G=[5.0, 10.0, 20.0, 30.0], m=[1.0, 1.3, 1.5, 2.0], L=[4, 8, 12])
STAGE1_FIXED = dict(Y=5.0, stop_k=0.0, entry="fade60", lot=0.01)
STAGE2 = dict(Y=[2.0, 5.0, 10.0, 15.0], stop_k=[0.0, 1.0, 3.0])
STYLES = {"grid": [1.0], "mild": [1.3, 1.5], "marti": [2.0]}
STYLE_JA = {"grid": "等倍ナンピン（グリッド, m=1.0）", "mild": "弱マーチン（m=1.3/1.5）",
            "marti": "マーチン（m=2.0）"}
LOT_POLICIES = {                                       # rolling-start account study
    "fix0.01": dict(lot_mode=0, lot=0.01), "fix0.03": dict(lot_mode=0, lot=0.03),
    "fix0.10": dict(lot_mode=0, lot=0.10), "comp0.03": dict(lot_mode=1, lot=0.03)}
LOT_JA = {"fix0.01": "固定 0.01 lot", "fix0.03": "固定 0.03 lot", "fix0.10": "固定 0.1 lot",
          "comp0.03": "複利 0.03 lot/10万円"}
CFG_KEYS = ["G", "m", "L", "Y", "stop_k", "entry", "lot"]

# Final candidates: fixed from the IS trial log (stages 1-3: 96 evaluations, 93 unique configurations) before any
# OOS evaluation: in each style (fixed in advance) the configuration with the best pooled IS
# average net P&L per basket.  All were negative in-sample, so these are "the best each
# style could do", not edges.
FINAL: list[dict] = [
    dict(name="grid10", style="grid",
         cfg=dict(G=10.0, m=1.0, L=4, Y=2.0, stop_k=3.0, entry="alt", lot=0.01),
         rule="等倍ナンピン: 初回はロング/ショート交互（前のバスケット決済直後に成行）、10 pips 逆行する"
              "ごとに同じロット（0.01）を追加、最大4ポジション、平均建値 +2 pips で全決済、4本目の建値から"
              "さらに 30 pips（3G）逆行で全損切り",
         why="等倍（m=1.0）の IS 設定の中で最良（IS で試した93設定すべてがマイナス）"),
    dict(name="mild30", style="mild",
         cfg=dict(G=30.0, m=1.5, L=4, Y=2.0, stop_k=0.0, entry="fade60", lot=0.01),
         rule="弱マーチン: 初回は直近60分の値動き（10 pips 以上）の逆張り、30 pips 逆行するごとにロット"
              "1.5倍で追加（0.01→0.02→0.02→0.03）、最大4ポジション、平均建値 +2 pips で全決済、損切りなし"
              "（証拠金維持率20%のロスカットのみ）",
         why="m=1.3/1.5 の IS 設定の中で最良、かつ93設定全体でも IS 最良（それでもマイナス）"),
    dict(name="marti30", style="marti",
         cfg=dict(G=30.0, m=2.0, L=4, Y=2.0, stop_k=1.0, entry="alt", lot=0.01),
         rule="マーチン: 初回はロング/ショート交互、30 pips 逆行するごとにロット2倍（0.01→0.02→0.04→0.08）、"
              "最大4ポジション、平均建値 +2 pips で全決済、4本目の建値からさらに 30 pips（1G）逆行で全損切り",
         why="m=2.0 の IS 設定の中で最良（IS で試した93設定すべてがマイナス）"),
]


# Reference settings for the rolling-start account study only (no per-basket verdict): the
# stage-1 mid-grid "classic" no-stop settings G=20, L=8, Y=5, fade60, one per style, fixed a
# priori as typical retail defaults (not chosen by any result).
REFERENCE: list[dict] = [
    dict(name="ref_grid20", style="grid", cfg=dict(G=20.0, m=1.0, L=8, Y=5.0, stop_k=0.0, entry="fade60", lot=0.01)),
    dict(name="ref_mild20", style="mild", cfg=dict(G=20.0, m=1.5, L=8, Y=5.0, stop_k=0.0, entry="fade60", lot=0.01)),
    dict(name="ref_marti20", style="marti", cfg=dict(G=20.0, m=2.0, L=8, Y=5.0, stop_k=0.0, entry="fade60", lot=0.01)),
]


# ----------------------------------------------------------------------------- data
def jpy_per_quote(sym: str) -> float:
    q = INSTRUMENTS[sym].quote
    if q == "JPY":
        return 1.0
    if q == "USD":
        return JPY_PER_USD
    raise ValueError(sym)


def pip_value_lot(sym: str) -> float:
    """JPY value of one pip on 1.00 lot."""
    inst = INSTRUMENTS[sym]
    return inst.pip * inst.contract * jpy_per_quote(sym)


def prep(sym: str, start=IS_START, end=OOS_END) -> dict:
    m1 = scalp.load(sym, start=start, end=end)
    idx = m1.index
    t = idx.as_unit("ns").asi8.astype(np.int64)
    day = t // int(86400e9)                             # server-day number (1970-01-01 = Thu)
    d0, d1 = int(day.min()), int(day.max())
    days = np.arange(d0, d1 + 1)
    w = _ROLL_WEIGHT[(days + 3) % 7]                    # dayofweek: Monday = 0
    cw = np.cumsum(w)
    cum = cw[day - d0]
    nights = np.zeros(len(t), np.int16)
    nights[1:] = (cum[1:] - cum[:-1]).astype(np.int16)
    hr, dow = idx.hour.to_numpy(), idx.dayofweek.to_numpy()
    ok = (dow < 5) & ~np.isin(hr, [23, 0]) & ~((dow == 4) & (hr >= 21)) & ~((dow == 0) & (hr < 2))
    return {"sym": sym, "idx": idx, "t": t,
            "o": m1["open"].to_numpy(float), "h": m1["high"].to_numpy(float),
            "l": m1["low"].to_numpy(float), "c": m1["close"].to_numpy(float),
            "hs1": scalp.half_spread_series(idx, sym, 1.0), "nights": nights,
            "yidx": np.clip(idx.year.to_numpy() - 2005, 0, 21).astype(np.int16),
            "entry_ok": ok}


def entry_signal(P: dict, entry: str, delay: int = 0) -> np.ndarray:
    """int8 per bar: +1/-1 first-entry direction (fade), 1 = eligible (alt), 0 = none.
    Uses closes <= the signal bar.  delay shifts every signal `delay` bars later (the
    decision is taken `delay` minutes after the signal bar closes)."""
    pip = INSTRUMENTS[P["sym"]].pip
    c, t, ok = P["c"], P["t"], P["entry_ok"]
    n = len(c)
    sig = np.zeros(n, np.int8)
    spec = ENTRIES[entry]
    if spec is None:
        sig[ok] = 1
    else:
        N, thr = spec["n"], spec["thr"] * pip
        mv = np.full(n, np.nan)
        mv[N:] = c[N:] - c[:-N]
        cont = np.zeros(n, bool)
        cont[N:] = (t[N:] - t[:-N]) <= 2 * N * 60e9
        fire = ok & cont & np.isfinite(mv) & (np.abs(mv) >= thr)
        sig[fire] = -np.sign(mv[fire]).astype(np.int8)
    if delay:
        out = np.zeros(n, np.int8)
        src = np.flatnonzero(sig)
        dst = src + delay
        keep = dst < n
        src, dst = src[keep], dst[keep]
        keep = (t[dst] - t[src]) <= delay * 2 * 60e9
        out[dst[keep]] = sig[src[keep]]
        return out
    return sig


# ----------------------------------------------------------------------------- kernel
@nb.njit(cache=False)
def _round_lot(x):
    v = math.floor(x / 0.01 + 0.5) * 0.01
    return v if v >= 0.01 else 0.01


@nb.njit(cache=False)
def _try_add(d, fill, x_ex, B, Q, S, M, nlv, lot0, mult, C, k, lev, comm_lot):
    lot = _round_lot(lot0 * mult ** nlv)
    mreq = lot * C * k * fill / lev
    eq = B + d * C * k * (Q * x_ex - S)
    if eq - M >= mreq:
        cm = lot * comm_lot
        return True, B - cm, Q + lot, S + lot * fill, M + mreq, cm
    return False, B, Q, S, M, 0.0


@nb.njit(cache=False)
def _kernel(t, o, h, l, c, hs, nights, yidx, sw_long, sw_short, sig, start_i, end_i,
            alt, G, mult, L, Y, stop_k, lot_fixed, lot_mode, lot_base,
            fresh, bal0, target, ruin, C, k, lev, so_lvl, slip, stop_slip, comm_lot,
            max_delay_ns, fav_first, ck_idx, ck_eq,
            o_ei, o_xi, o_dir, o_lv, o_lots, o_lot0, o_pnl, o_gross, o_comm, o_swap,
            o_mae, o_maepx, o_reason, o_bal, o_blk):
    n = o.shape[0]
    cap = o_ei.shape[0]
    nck = ck_idx.shape[0]
    B = bal0
    nbk = 0
    status = 0                     # 0 horizon / data end, 1 target, 2 ruin, -1 buffer full
    prev_dir = -1
    is_open = False
    entry_bar = False
    d = 1
    Q = 0.0
    S = 0.0
    M = 0.0
    nlv = 0
    last = 0.0
    first = 0.0
    next_lv = 0.0
    can_add = False
    hs_on = False
    x_hs = 0.0
    B0 = 0.0
    mae = 0.0
    maepx = 0.0
    bsw = 0.0
    bcm = 0.0
    blk = False
    lot0 = 0.0
    ei = 0
    ckp = 0
    xa = 0.0
    xf = 0.0
    j = start_i
    while j < end_i:
        while ckp < nck and ck_idx[ckp] <= j:
            if is_open:
                ck_eq[ckp] = B + d * C * k * (Q * (o[j] - d * hs[j]) - S)
            else:
                ck_eq[ckp] = B
            ckp += 1
        if not is_open:
            s = sig[j]
            if s == 0 or j + 1 >= end_i or t[j + 1] - t[j] > max_delay_ns:
                j += 1
                continue
            if fresh:
                B = bal0
            else:
                if B >= target:
                    status = 1
                    break
                if B < ruin:
                    status = 2
                    break
            if alt:
                d = -prev_dir
            else:
                d = 1 if s > 0 else -1
            if lot_mode == 1:
                lot0 = math.floor(lot_base * B / bal0 / 0.01 + 1e-9) * 0.01
                if lot0 < 0.01:
                    lot0 = 0.01
            else:
                lot0 = lot_fixed
            i = j + 1
            fill = o[i] + d * (hs[i] + slip)
            mreq = lot0 * C * k * fill / lev
            if mreq > B:
                status = 2
                break
            if nbk >= cap:
                status = -1
                break
            B0 = B
            bcm = lot0 * comm_lot
            B -= bcm
            Q = lot0
            S = lot0 * fill
            M = mreq
            nlv = 1
            last = fill
            first = fill
            next_lv = fill - d * G
            can_add = L > 1
            hs_on = False
            if not can_add and stop_k > 0:
                hs_on = True
                x_hs = last - d * stop_k * G
            mae = 0.0
            maepx = 0.0
            bsw = 0.0
            blk = False
            ei = i
            is_open = True
            entry_bar = True
            j = i
            continue
        # ---------------- basket open: process bar j
        closed = False
        px = 0.0
        reason = 0
        if not entry_bar:
            if nights[j] > 0:
                rate = sw_long[yidx[j]] if d > 0 else sw_short[yidx[j]]
                sw = Q * C * o[j] * k * rate / 365.0 * nights[j]
                B += sw
                bsw += sw
            qo_ex = o[j] - d * hs[j]
            qo_en = o[j] + d * hs[j]
            x_so = S / Q + d * (so_lvl * M - B) / (C * k * Q)
            if hs_on and d * (qo_ex - x_hs) <= 0:
                px = qo_ex - d * stop_slip
                reason = 3
                closed = True
            elif d * (qo_ex - x_so) <= 0:
                px = qo_ex - d * stop_slip
                reason = 2
                closed = True
            elif d * (qo_ex - (S / Q + d * Y)) >= 0:
                px = qo_ex
                reason = 1
                closed = True
            elif can_add and d * (qo_en - next_lv) <= 0:
                fill = qo_en + d * slip
                ok, B, Q, S, M, cm = _try_add(d, fill, qo_ex, B, Q, S, M, nlv, lot0, mult,
                                              C, k, lev, comm_lot)
                if ok:
                    bcm += cm
                    nlv += 1
                    last = fill
                    next_lv = fill - d * G
                    if nlv >= L:
                        can_add = False
                else:
                    can_add = False
                    blk = True
                if not can_add and stop_k > 0 and not hs_on:
                    hs_on = True
                    x_hs = last - d * stop_k * G
            if not closed:
                fl = B - B0 + d * C * k * (Q * qo_ex - S)
                if fl < mae:
                    mae = fl
                if d * (first - qo_ex) > maepx:
                    maepx = d * (first - qo_ex)
        entry_bar = False
        if not closed:
            if d > 0:
                xa = l[j]
                xf = h[j]
            else:
                xa = h[j]
                xf = l[j]
            if fav_first:              # diagnostic: optimistic intrabar order (TP first)
                x_tp = S / Q + d * Y
                if d * ((xf - d * hs[j]) - x_tp) >= 0:
                    px = x_tp
                    reason = 1
                    closed = True
        if not closed:
            xa_ex = xa - d * hs[j]
            xa_en = xa + d * hs[j]
            added = False
            while True:
                x_so = S / Q + d * (so_lvl * M - B) / (C * k * Q)
                ev = 0
                best = -1e300
                if d * (xa_ex - x_so) <= 0:
                    ev = 2
                    best = d * x_so
                if hs_on and d * (xa_ex - x_hs) <= 0 and d * x_hs >= best:
                    ev = 3
                    best = d * x_hs
                if can_add and d * (xa_en - next_lv) <= 0:
                    lv_ex = next_lv - 2.0 * d * hs[j]
                    if d * lv_ex > best:
                        ev = 1
                if ev == 0:
                    break
                if ev == 1:
                    fill = next_lv + d * slip
                    ok, B, Q, S, M, cm = _try_add(d, fill, next_lv - 2.0 * d * hs[j], B, Q, S,
                                                  M, nlv, lot0, mult, C, k, lev, comm_lot)
                    if ok:
                        added = True
                        bcm += cm
                        nlv += 1
                        last = fill
                        next_lv = fill - d * G
                        if nlv >= L:
                            can_add = False
                    else:
                        can_add = False
                        blk = True
                    if not can_add and stop_k > 0 and not hs_on:
                        hs_on = True
                        x_hs = last - d * stop_k * G
                    continue
                px = (x_so if ev == 2 else x_hs) - d * stop_slip
                reason = ev
                closed = True
                break
            if not closed:
                fl = B - B0 + d * C * k * (Q * xa_ex - S)
                if fl < mae:
                    mae = fl
                if d * (first - xa_ex) > maepx:
                    maepx = d * (first - xa_ex)
                x_tp = S / Q + d * Y
                chk = (c[j] if added else xf) - d * hs[j]
                if d * (chk - x_tp) >= 0:
                    px = x_tp
                    reason = 1
                    closed = True
        if closed:
            gross = d * C * k * (Q * px - S)
            B += gross
            if B < 0:
                B = 0.0
            pnl = B - B0
            if pnl < mae:
                mae = pnl
            if d * (first - px) > maepx:
                maepx = d * (first - px)
            o_ei[nbk] = ei
            o_xi[nbk] = j
            o_dir[nbk] = d
            o_lv[nbk] = nlv
            o_lots[nbk] = Q
            o_lot0[nbk] = lot0
            o_pnl[nbk] = pnl
            o_gross[nbk] = gross
            o_comm[nbk] = bcm
            o_swap[nbk] = bsw
            o_mae[nbk] = mae
            o_maepx[nbk] = maepx
            o_reason[nbk] = reason
            o_bal[nbk] = B
            o_blk[nbk] = blk
            nbk += 1
            is_open = False
            prev_dir = d
            if not fresh:
                if B >= target:
                    status = 1
                    break
                if B < ruin:
                    status = 2
                    break
            continue                   # same bar: its close may trigger the next basket
        j += 1
    if is_open and status == 0:
        if end_i < n:
            jj = end_i
            px = o[jj] - d * hs[jj] - d * slip
        else:
            jj = n - 1
            px = c[jj] - d * hs[jj] - d * slip
        gross = d * C * k * (Q * px - S)
        B += gross
        if B < 0:
            B = 0.0
        pnl = B - B0
        o_ei[nbk] = ei
        o_xi[nbk] = jj
        o_dir[nbk] = d
        o_lv[nbk] = nlv
        o_lots[nbk] = Q
        o_lot0[nbk] = lot0
        o_pnl[nbk] = pnl
        o_gross[nbk] = gross
        o_comm[nbk] = bcm
        o_swap[nbk] = bsw
        o_mae[nbk] = min(mae, pnl)
        o_maepx[nbk] = max(maepx, d * (first - px))
        o_reason[nbk] = 4
        o_bal[nbk] = B
        o_blk[nbk] = blk
        nbk += 1
        j = jj
    while ckp < nck:
        ck_eq[ckp] = B
        ckp += 1
    return nbk, status, B, j


REASONS = ["tp", "stopout", "hardstop", "end"]


def run(P: dict, sig: np.ndarray, cfg: dict, start_i: int, end_i: int, cost_mult=1.0,
        fresh=True, lot_mode=0, lot=None, ck_idx=None, cap=None, fav_first=False):
    """Run one basket EA over bars [start_i, end_i) of the prepared pair P.
    Returns (baskets DataFrame, status, final balance, last bar, checkpoint equities)."""
    sym = P["sym"]
    inst = INSTRUMENTS[sym]
    pip = inst.pip
    k = jpy_per_quote(sym)
    cm = CostModel(multiplier=cost_mult)
    years = range(2005, 2027)
    sw_long = np.array([cm.swap_rate_annual(inst, 1, y) for y in years])
    sw_short = np.array([cm.swap_rate_annual(inst, -1, y) for y in years])
    hs = P["hs1"] * cost_mult
    slip = inst.slip_pips * pip * cost_mult
    stop_slip = slip + inst.stop_slip_pips * pip * cost_mult
    lot0 = float(cfg["lot"] if lot is None else lot)
    ck = np.zeros(0, np.int64) if ck_idx is None else np.asarray(ck_idx, np.int64)
    ck_eq = np.zeros(len(ck))
    cap = cap or max(1000, min(int((sig[start_i:end_i] != 0).sum()) + 10,
                               (end_i - start_i) // 3 + 10))
    while True:
        bufs = [np.zeros(cap, np.int64), np.zeros(cap, np.int64), np.zeros(cap, np.int8),
                np.zeros(cap, np.int16)] + [np.zeros(cap) for _ in range(8)] + \
               [np.zeros(cap, np.int8), np.zeros(cap), np.zeros(cap, np.bool_)]
        nbk, status, B, jend = _kernel(
            P["t"], P["o"], P["h"], P["l"], P["c"], hs, P["nights"], P["yidx"], sw_long,
            sw_short, sig, int(start_i), int(end_i), cfg["entry"] == "alt",
            float(cfg["G"]) * pip, float(cfg["m"]), int(cfg["L"]), float(cfg["Y"]) * pip,
            float(cfg["stop_k"]), lot0, int(lot_mode), lot0, bool(fresh), BAL0, TARGET, RUIN,
            float(inst.contract), k, LEVERAGE, STOP_OUT, slip, stop_slip,
            COMM_JPY_LOT_RT * cost_mult, MAX_DELAY_NS, bool(fav_first), ck, ck_eq, *bufs)
        if status != -1:
            break
        cap *= 2
    (ei, xi, dr, lv, lots, l0, pnl, gross, comm, swap, mae, maepx, reason, bal, blk) = \
        (b[:nbk] for b in bufs)
    idx = P["idx"]
    pv = pip_value_lot(sym)
    df = pd.DataFrame({
        "symbol": sym, "entry_time": idx[ei], "exit_time": idx[xi], "dir": dr,
        "levels": lv, "lots": lots, "lot0": l0, "pnl_jpy": pnl, "gross_jpy": gross,
        "comm_jpy": comm, "swap_jpy": swap, "mae_jpy": mae, "mae_pips": maepx / pip,
        "reason": pd.Categorical.from_codes(reason.astype(np.int64) - 1, REASONS),
        "balance_after": bal, "margin_blocked": blk})
    df["minutes"] = (df.exit_time - df.entry_time).dt.total_seconds() / 60.0
    df["net_pips"] = df.pnl_jpy / (df.lot0 * pv)        # "first-lot pips"
    df["gross_pips"] = df.gross_jpy / (df.lot0 * pv)
    return df, int(status), float(B), int(jend), ck_eq


# ----------------------------------------------------------------------------- stats
def bstats(df: pd.DataFrame, years: float) -> dict:
    n = len(df)
    if n == 0:
        return {"n": 0}
    x = df.net_pips.to_numpy(float)
    j = df.pnl_jpy.to_numpy(float)
    sd = x.std(ddof=1) if n > 1 else float("nan")
    win = x > 0
    so = (df.reason == "stopout").to_numpy()
    return {
        "n": n, "per_year": n / years, "win_rate": float(win.mean()),
        "avg_net_pips": float(x.mean()), "t": float(x.mean() / sd * math.sqrt(n)) if sd > 0 else float("nan"),
        "avg_gross_pips": float(df.gross_pips.mean()),
        "avg_jpy": float(j.mean()), "total_jpy": float(j.sum()),
        "avg_win_jpy": float(j[win].mean()) if win.any() else float("nan"),
        "avg_loss_jpy": float(j[~win].mean()) if (~win).any() else float("nan"),
        "worst_jpy": float(j.min()), "stopouts": int(so.sum()),
        "hardstops": int((df.reason == "hardstop").sum()),
        "stopout_per_year": float(so.sum() / years),
        "avg_levels": float(df.levels.mean()), "max_levels": int(df.levels.max()),
        "mae_p50_jpy": float(np.median(df.mae_jpy)), "mae_p99_jpy": float(np.quantile(df.mae_jpy, 0.01)),
        "mae_min_jpy": float(df.mae_jpy.min()),
        "mae_p99_pips": float(np.quantile(df.mae_pips, 0.99)), "mae_max_pips": float(df.mae_pips.max()),
        "avg_minutes": float(df.minutes.mean()), "max_days": float(df.minutes.max() / 1440.0),
        "swap_jpy_per_basket": float(df.swap_jpy.mean()),
    }


def pooled_stats(dfs: list[pd.DataFrame], years: float) -> dict:
    d = pd.concat([x for x in dfs if len(x)], ignore_index=True) if any(len(x) for x in dfs) else pd.DataFrame()
    s = bstats(d, years * max(len(dfs), 1)) if len(d) else {"n": 0}
    if len(d):
        s["per_year"] = s["n"] / years                  # baskets per year over all pairs
        s["stopout_per_year"] = s["stopouts"] / years
    return s


def cfg_name(cfg: dict) -> str:
    st = "none" if not cfg["stop_k"] else f"{cfg['stop_k']:g}G"
    return (f"G{cfg['G']:g}_m{cfg['m']:g}_L{cfg['L']}_Y{cfg['Y']:g}_stop{st}_"
            f"{cfg['entry']}_lot{cfg['lot']:g}")


def style_of(m: float) -> str:
    return next(s for s, ms in STYLES.items() if m in ms)


# ----------------------------------------------------------------------------- IS stages
def _is_pair(args):
    sym, cfgs = args
    t0 = time.time()
    P = prep(sym, IS_START, IS_END)
    n = len(P["t"])
    sigs = {}
    out = []
    for cfg in cfgs:
        if cfg["entry"] not in sigs:
            sigs[cfg["entry"]] = entry_signal(P, cfg["entry"])
        sig = sigs[cfg["entry"]]
        df1 = run(P, sig, cfg, 0, n, cost_mult=1.0)[0]
        df0 = run(P, sig, cfg, 0, n, cost_mult=0.0)[0]
        keep = ["pnl_jpy", "net_pips", "gross_pips", "reason", "levels", "mae_jpy",
                "mae_pips", "minutes", "swap_jpy"]
        out.append((df1[keep], df0[["net_pips"]]))
    print(f"  {sym}: {len(cfgs)} configs in {time.time() - t0:.0f}s", flush=True)
    return sym, out


def run_is(cfgs: list[dict], stage: str) -> pd.DataFrame:
    with ProcessPoolExecutor(WORKERS) as ex:
        res = dict(ex.map(_is_pair, [(s, cfgs) for s in PAIRS]))
    rows = []
    for i, cfg in enumerate(cfgs):
        per = {s: res[s][i][0] for s in PAIRS}
        fr = {s: res[s][i][1] for s in PAIRS}
        pool = pooled_stats(list(per.values()), IS_YEARS)
        pool["avg_frictionless_pips"] = float(pd.concat(fr.values()).net_pips.mean())
        per_pair = {}
        for s in PAIRS:
            p = bstats(per[s], IS_YEARS)
            p["avg_frictionless_pips"] = float(fr[s].net_pips.mean()) if len(fr[s]) else float("nan")
            per_pair[s] = p
        params = dict(cfg, stage=stage, name=cfg_name(cfg), style=style_of(cfg["m"]))
        LOG.log(params, {"pool": pool, "per_pair": per_pair}, period="is")
        rows.append({**params, **{f"pool_{k}": v for k, v in pool.items()},
                     "pos_pairs": sum((per_pair[s].get("avg_net_pips", -1) or -1) > 0 for s in PAIRS)})
    return pd.DataFrame(rows)


def load_log(stage: str | None = None) -> pd.DataFrame:
    if not LOG.path.exists():
        return pd.DataFrame()
    rows = []
    for line in open(LOG.path):
        r = json.loads(line)
        if r.get("period") != "is" or (stage and r["params"].get("stage") != stage):
            continue
        row = dict(r["params"])
        for kk, v in r["metrics"]["pool"].items():
            row[f"pool_{kk}"] = v
        for s, p in r["metrics"]["per_pair"].items():
            for kk, v in p.items():
                row[f"{s}_{kk}"] = v
        rows.append(row)
    df = pd.DataFrame(rows)
    if len(df):
        df["pos_pairs"] = sum((df[f"{s}_avg_net_pips"].fillna(-1) > 0).astype(int) for s in PAIRS)
        df = df.drop_duplicates(subset=["name"], keep="last")
    return df


SHOW = ["name", "pool_n", "pool_win_rate", "pool_avg_net_pips", "pool_t", "pool_avg_frictionless_pips",
        "pool_avg_jpy", "pool_worst_jpy", "pool_stopouts", "pos_pairs"]


def stage1():
    cfgs = [dict(G=G, m=m, L=L, **STAGE1_FIXED)
            for G in STAGE1["G"] for m in STAGE1["m"] for L in STAGE1["L"]]
    df = run_is(cfgs, "s1")
    print(df[SHOW].sort_values("pool_avg_net_pips", ascending=False).round(3).to_string())


def _cfg(row) -> dict:
    return {kk: (row[kk] if kk in ("entry",) else (int(row[kk]) if kk == "L" else float(row[kk])))
            for kk in CFG_KEYS}


def stage2():
    s1 = load_log("s1")
    cfgs = []
    for style, ms in STYLES.items():
        b = s1[s1.m.isin(ms)].sort_values("pool_avg_net_pips", ascending=False).iloc[0]
        print(f"stage-2 leader {style}: {b['name']} avg {b.pool_avg_net_pips:+.2f} t {b.pool_t:+.2f}")
        base = _cfg(b)
        cfgs += [dict(base, Y=Y, stop_k=sk) for Y in STAGE2["Y"] for sk in STAGE2["stop_k"]]
    df = run_is(cfgs, "s2")
    print(df[SHOW].sort_values("pool_avg_net_pips", ascending=False).round(3).to_string())


def stage3():
    s2 = load_log("s2")
    cfgs = []
    for style, ms in STYLES.items():
        b = s2[s2.m.isin(ms)].sort_values("pool_avg_net_pips", ascending=False).iloc[0]
        print(f"stage-3 base {style}: {b['name']} avg {b.pool_avg_net_pips:+.2f} t {b.pool_t:+.2f}")
        base = _cfg(b)
        cfgs += [dict(base, entry=e) for e in ("fade30", "alt")]
        cfgs += [dict(base, lot=lt) for lt in (0.03, 0.1)]
    df = run_is(cfgs, "s3")
    print(df[SHOW].sort_values("pool_avg_net_pips", ascending=False).round(3).to_string())


# ----------------------------------------------------------------------------- final
RUN_VARIANTS = [("base", 1.0, 0), ("cost1.5", 1.5, 0), ("cost2", 2.0, 0),
                ("frictionless", 0.0, 0), ("delay1", 1.0, 1), ("delay2", 1.0, 2)]
COMPACT = ["symbol", "entry_time", "net_pips", "gross_pips", "pnl_jpy", "reason", "mae_jpy",
           "mae_pips", "minutes", "levels", "swap_jpy"]
MONTH_NS = 30.4375 * 86400e9
OOS_START_GROUP = IS_END                                # rolling starts from 2015-01 = "OOS starts"


def rolling_study(P: dict, sig: np.ndarray, cfg: dict) -> pd.DataFrame:
    """Fresh 100,000 JPY account on the first bar of every month; stop at 10x, ruin or 12
    months.  eq_k = mark-to-market equity at the first bar of month k after the start."""
    t = P["t"]
    last = pd.Timestamp(int(t[-1]))
    rows = []
    for ms in pd.date_range(IS_START, last, freq="MS"):
        if ms + pd.DateOffset(months=12) > last:
            break
        s_i = int(np.searchsorted(t, ms.value))
        cks = [int(np.searchsorted(t, (ms + pd.DateOffset(months=kk)).value)) for kk in range(1, 13)]
        e_i = cks[-1]
        for pol, spec in LOT_POLICIES.items():
            df, status, B, jend, ck_eq = run(P, sig, cfg, s_i, e_i, fresh=False,
                                             lot_mode=spec["lot_mode"], lot=spec["lot"], ck_idx=cks)
            rec = {"symbol": P["sym"], "policy": pol, "start": ms,
                   "status": {0: "horizon", 1: "10x", 2: "ruin"}[status],
                   "months": (t[min(jend, len(t) - 1)] - t[s_i]) / MONTH_NS, "final": B,
                   "n_baskets": len(df), "stopouts": int((df.reason == "stopout").sum()),
                   "hardstops": int((df.reason == "hardstop").sum()),
                   "peak_balance": float(max(BAL0, df.balance_after.max())) if len(df) else BAL0}
            rec.update({f"eq_{kk}": float(v) for kk, v in enumerate(ck_eq, start=1)})
            rows.append(rec)
    return pd.DataFrame(rows)


def _final_pair(sym: str, cands: list[dict], refs: list[dict]):
    t0 = time.time()
    P = prep(sym, IS_START, OOS_END)
    n = len(P["t"])
    i_is = int(np.searchsorted(P["t"], IS_END.value))
    out, rolls = {}, []
    for cand in cands:
        cfg = cand["cfg"]
        sigs = {}
        runs = {}
        for name, cm, dl in RUN_VARIANTS:
            if dl not in sigs:
                sigs[dl] = entry_signal(P, cfg["entry"], delay=dl)
            a = run(P, sigs[dl], cfg, 0, i_is, cost_mult=cm)[0]      # IS: flat start 2005
            b = run(P, sigs[dl], cfg, i_is, n, cost_mult=cm)[0]      # OOS: flat start 2015
            df = pd.concat([a, b], ignore_index=True)
            if name != "base":
                df = df[COMPACT].copy()
                for col in ("net_pips", "gross_pips", "pnl_jpy", "mae_jpy", "mae_pips", "minutes", "swap_jpy"):
                    df[col] = df[col].astype(np.float32)
            df["symbol"] = pd.Categorical(df["symbol"], categories=PAIRS)
            runs[name] = df
        for cm in (0.0, 1.0):                           # IS only: intrabar-order bracket
            df = run(P, sigs[0], cfg, 0, i_is, cost_mult=cm, fav_first=True)[0][COMPACT].copy()
            df["symbol"] = pd.Categorical(df["symbol"], categories=PAIRS)
            runs[f"favfirst{cm:g}"] = df
        roll = rolling_study(P, sigs[0], cfg)
        roll.insert(0, "cand", cand["name"])
        rolls.append(roll)
        out[cand["name"]] = runs
    for ref in refs:                                    # account study only (reference)
        roll = rolling_study(P, entry_signal(P, ref["cfg"]["entry"]), ref["cfg"])
        roll.insert(0, "cand", ref["name"])
        rolls.append(roll)
    print(f"  {sym}: final in {time.time() - t0:.0f}s", flush=True)
    return out, pd.concat(rolls, ignore_index=True)


def _split(df):
    return df[df.entry_time < IS_END], df[df.entry_time >= IS_END]


def verdict(runs) -> dict:
    ins, oos = _split(runs["base"])
    s_is, s_oos = bstats(ins, IS_YEARS), bstats(oos, OOS_YEARS)
    o15, o2 = _split(runs["cost1.5"])[1], _split(runs["cost2"])[1]
    od1, od2 = _split(runs["delay1"])[1], _split(runs["delay2"])[1]
    yr = oos.groupby(oos.entry_time.dt.year).net_pips.sum()
    drop = oos[oos.entry_time.dt.year != yr.idxmax()] if len(yr) else oos
    checks = {
        "IS 平均ネット > 0": s_is["avg_net_pips"] > 0,
        "OOS 平均ネット > 0": s_oos["avg_net_pips"] > 0,
        "OOS t値 >= 2.0": s_oos["t"] >= 2.0,
        "OOS バスケット数 >= 200": s_oos["n"] >= 200,
        "OOS コスト1.5倍でも > 0": len(o15) > 0 and o15.net_pips.mean() > 0,
        "OOS 最良年を除いても > 0": len(drop) > 0 and drop.net_pips.mean() > 0,
    }
    return {"is": s_is, "oos": s_oos, "checks": checks, "survives": all(checks.values()),
            "oos_cost15": float(o15.net_pips.mean()), "oos_cost2": float(o2.net_pips.mean()),
            "oos_delay1": float(od1.net_pips.mean()), "oos_delay2": float(od2.net_pips.mean()),
            "oos_frictionless": float(_split(runs["frictionless"])[1].net_pips.mean()),
            "drop_best_year": float(drop.net_pips.mean()) if len(drop) else float("nan"),
            "best_year": int(yr.idxmax()) if len(yr) else None}


def roll_summary(r: pd.DataFrame) -> dict:
    ru, tx = r[r.status == "ruin"], r[r.status == "10x"]
    return {"n": len(r), "p10x": float((r.status == "10x").mean()),
            "pruin": float((r.status == "ruin").mean()),
            "med_m_ruin": float(ru.months.median()) if len(ru) else float("nan"),
            "med_m_10x": float(tx.months.median()) if len(tx) else float("nan"),
            "med_final": float(r.final.median()), "mean_final": float(r.final.mean()),
            "p_loss": float((r.final < BAL0).mean()), "p_double": float((r.final >= 2 * BAL0).mean())}


def final():
    import gc
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    parts: dict[str, dict[str, list]] = {c["name"]: {} for c in FINAL}
    rolls = []
    for sym in PAIRS:                                   # one pair in memory at a time
        out, roll = _final_pair(sym, FINAL, REFERENCE)
        rolls.append(roll)
        for nm_, runs in out.items():
            for kk, df in runs.items():
                parts[nm_].setdefault(kk, []).append(df)
        del out
        gc.collect()
    results = {}
    logged = _logged_finals()
    for cand in FINAL:
        nm_ = cand["name"]
        runs = {}
        for kk, lst in parts.pop(nm_).items():
            df = pd.concat(lst, ignore_index=True)
            df["symbol"] = pd.Categorical(df["symbol"].astype(str), categories=PAIRS)
            runs[kk] = df
        runs["base"].to_parquet(OUT_DIR / f"trades_{KEY}_{nm_}.parquet")
        v = verdict(runs)
        results[nm_] = (cand, runs, v)
        for s in PAIRS:
            if (nm_, s) in logged:
                continue
            bi, bo = _split(runs["base"][runs["base"].symbol == s])
            LOG.log(dict(cand["cfg"], name=nm_, style=cand["style"], pair=s),
                    {"is": bstats(bi, IS_YEARS), "oos": bstats(bo, OOS_YEARS)}, period="final")
    roll = pd.concat(rolls, ignore_index=True)
    roll.to_parquet(ROLLING_FILE)
    REPORT.write_text(report_text(results, roll))
    summary = {nm_: {"survives": v["survives"], "is": v["is"], "oos": v["oos"],
                     **{kk: v[kk] for kk in ("oos_cost15", "oos_cost2", "oos_delay1", "oos_delay2",
                                              "oos_frictionless", "drop_best_year", "best_year")},
                     "checks": v["checks"]}
               for nm_, (_, _, v) in results.items()}
    print(json.dumps(summary, default=float, ensure_ascii=False, indent=1))
    print(roll.groupby(["cand", "policy"]).apply(lambda g: pd.Series(roll_summary(g))).round(3).to_string())


def _logged_finals() -> set:
    if not LOG.path.exists():
        return set()
    recs = [json.loads(x) for x in open(LOG.path)]
    return {(r["params"].get("name"), r["params"].get("pair")) for r in recs if r.get("period") == "final"}


# ----------------------------------------------------------------------------- report
def fp(x, d=2):
    if x is None or (isinstance(x, float) and not np.isfinite(x)):
        return "-"
    return f"{x:+.{d}f}"


def yen(x):
    if x is None or (isinstance(x, float) and not np.isfinite(x)):
        return "-"
    return f"{x:+,.0f}"


def f1(x):
    return "-" if x is None or not np.isfinite(x) else f"{x:.1f}"


def pct(x):
    return "-" if x is None or not np.isfinite(x) else f"{x:.0%}"


def man(x):
    """JPY -> 万円 string."""
    if x is None or (isinstance(x, float) and not np.isfinite(x)):
        return "-"
    return f"{x / 1e4:,.1f}万円"


def _brow(label, df, years):
    s = bstats(df, years)
    if not s["n"]:
        return f"| {label} | 0 | - | - | - | - | - | - | - | - | - |"
    return (f"| {label} | {s['n']:,} | {s['per_year']:,.0f} | {s['win_rate']:.1%} | {fp(s['avg_net_pips'])} "
            f"| {yen(s['avg_jpy'])} | {s['t']:+.1f} | {yen(s['worst_jpy'])} | {s['stopouts']:,} "
            f"| {yen(s['mae_p99_jpy'])} | {s['max_days']:.0f} |")


BHEAD = ["| 区間・条件 | バスケット数 | 年あたり(4ペア計) | 勝率 | 平均ネット(初期ロットpips) | 平均ネット(円) "
         "| t値 | 最大損失(円) | ロスカット回数 | MAE 1%点(円) | 最長保有(日) |",
         "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]


def win_expectancy(df) -> dict:
    j = df.pnl_jpy.to_numpy()
    w, lo = j[j > 0], j[j <= 0]
    aw = float(w.mean()) if len(w) else float("nan")
    al = float(-lo.mean()) if len(lo) else float("nan")
    return {"win": len(w) / max(len(j), 1), "avg_win": aw, "avg_loss": al,
            "be": al / (aw + al) if len(w) and len(lo) else float("nan"), "exp": float(j.mean()),
            "ratio": al / aw if len(w) and len(lo) else float("nan")}


def candidate_section(cand, runs, v) -> list[str]:
    cfg = cand["cfg"]
    stop_txt = "なし" if not cfg["stop_k"] else f"{cfg['stop_k']:g}G"
    L = [f"### 候補 {cand['name']}（{STYLE_JA[cand['style']]}）", "",
         f"* ルール: {cand['rule']}",
         f"* 設定: G={cfg['G']:g} pips, m={cfg['m']:g}, L={cfg['L']}, Y={cfg['Y']:g} pips, "
         f"ハードストップ={stop_txt}, "
         f"初回エントリー={cfg['entry']}, 初期ロット={cfg['lot']:g}",
         f"* 選定理由（IS のみ）: {cand['why']}",
         f"* ペア: {', '.join(PAIRS)}（実データ。EURUSD/GBPUSD は 1ドル=110円固定で円換算）", ""] + BHEAD
    ins, oos = _split(runs["base"])
    L += [_brow("IS 2005-2014（コスト1.0）", ins, IS_YEARS),
          _brow("**OOS 2015-2020.5（コスト1.0）**", oos, OOS_YEARS)]
    for kk, lab in [("cost1.5", "OOS コスト1.5倍"), ("cost2", "OOS コスト2倍"),
                    ("frictionless", "OOS 摩擦ゼロ（スプレッド・滑り・手数料・スワップ上乗せなし）"),
                    ("delay1", "OOS 初回エントリー1分遅れ"), ("delay2", "OOS 初回エントリー2分遅れ")]:
        L.append(_brow(lab, _split(runs[kk])[1], OOS_YEARS))
    for kk, lab in [("frictionless", "IS 摩擦ゼロ"), ("cost1.5", "IS コスト1.5倍"),
                    ("delay1", "IS 1分遅れ"), ("delay2", "IS 2分遅れ")]:
        L.append(_brow(lab, _split(runs[kk])[0], IS_YEARS))
    L += ["", "生き残り判定（1バスケットのネット損益、初期ロットpips）:", ""]
    for kk, ok in v["checks"].items():
        L.append(f"* {'OK' if ok else 'NG'}: {kk}")
    L += [f"* 最良年 {v['best_year']} を除いた OOS 平均: {fp(v['drop_best_year'])} pips",
          f"* **判定: {'生き残り' if v['survives'] else '不合格'}**", "",
          "年別（コスト1.0、4ペア合算、各バスケットは10万円の新しい口座で開始）:", "",
          "| 年 | 区間 | バスケット数 | 勝率 | 平均ネット(pips) | 合計(円) | ロスカット | ハードストップ | 最大損失(円) | 摩擦ゼロ平均 |",
          "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
    base, fr = runs["base"], runs["frictionless"]
    fy = fr.groupby(fr.entry_time.dt.year).net_pips.mean()
    for y, g in base.groupby(base.entry_time.dt.year):
        L.append(f"| {y} | {'IS' if y < IS_END.year else 'OOS'} | {len(g):,} | {(g.pnl_jpy > 0).mean():.1%} "
                 f"| {fp(g.net_pips.mean())} | {yen(g.pnl_jpy.sum())} | {(g.reason == 'stopout').sum()} "
                 f"| {(g.reason == 'hardstop').sum()} | {yen(g.pnl_jpy.min())} | {fp(fy.get(y, np.nan))} |")
    L += ["", "ペア別:", "",
          "| ペア | IS 数 | IS 勝率 | IS 平均 | IS t値 | OOS 数 | OOS 勝率 | OOS 平均 | OOS t値 | OOS ロスカット | OOS 最大損失(円) | OOS 摩擦ゼロ |",
          "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for s in PAIRS:
        bi, bo = _split(base[base.symbol == s])
        fo = _split(fr[fr.symbol == s])[1]
        si, so = bstats(bi, IS_YEARS), bstats(bo, OOS_YEARS)
        L.append(f"| {s} | {si['n']:,} | {si['win_rate']:.1%} | {fp(si['avg_net_pips'])} | {si['t']:+.1f} "
                 f"| {so['n']:,} | {so['win_rate']:.1%} | {fp(so['avg_net_pips'])} | {so['t']:+.1f} "
                 f"| {so['stopouts']} | {yen(so['worst_jpy'])} | {fp(fo.net_pips.mean())} |")
    we = win_expectancy(oos)
    so = bstats(oos, OOS_YEARS)
    L += ["", f"勝率と期待値（OOS、コスト1.0）: 勝率 {we['win']:.1%}、平均利益 {we['avg_win']:,.0f}円、"
              f"平均損失 {we['avg_loss']:,.0f}円（利益の {we['ratio']:,.0f} 倍）→ 損益分岐の勝率 {we['be']:.2%}、"
              f"期待値 {we['exp']:+,.0f}円/バスケット。ポジション数の平均 {so['avg_levels']:.2f}、"
              f"保有時間の平均 {so['avg_minutes']:,.0f}分、1バスケットのスワップ平均 {so['swap_jpy_per_basket']:+.1f}円。",
          f"MAE（含み損の最大値）: 中央値 {yen(so['mae_p50_jpy'])}円、1%点 {yen(so['mae_p99_jpy'])}円、"
          f"最悪 {yen(so['mae_min_jpy'])}円。値幅では 99%点 {so['mae_p99_pips']:.0f} pips、最大 {so['mae_max_pips']:.0f} pips 逆行。", ""]
    return L


def _stage_table(df, top=None) -> list[str]:
    L = ["| 設定 | バスケット数 | 勝率 | 平均ネット(pips) | t値 | 摩擦ゼロ平均 | 平均(円) | 最大損失(円) | ロスカット | プラスのペア(4) |",
         "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    d = df.sort_values("pool_avg_net_pips", ascending=False)
    if top:
        d = d.head(top)
    for r in d.to_dict("records"):
        L.append(f"| {r['name']} | {r['pool_n']:,} | {r['pool_win_rate']:.1%} | {fp(r['pool_avg_net_pips'])} "
                 f"| {r['pool_t']:+.1f} | {fp(r['pool_avg_frictionless_pips'])} | {yen(r['pool_avg_jpy'])} "
                 f"| {yen(r['pool_worst_jpy'])} | {r['pool_stopouts']:,} | {r['pos_pairs']} |")
    return L


def winrate_buckets(allc: pd.DataFrame) -> list[str]:
    bins = [0, 0.90, 0.97, 0.99, 0.995, 1.001]
    labs = ["90%未満", "90〜97%", "97〜99%", "99〜99.5%", "99.5%以上"]
    allc = allc.assign(b=pd.cut(allc.pool_win_rate, bins, labels=labs, right=False))
    L = ["| IS 勝率（4ペア合算） | 設定数 | IS 平均ネットの平均(pips) | 最良 | 最悪 | プラスの設定 | ロスカット/年（中央値） |",
         "|---|---:|---:|---:|---:|---:|---:|"]
    for lab, g in allc.groupby("b", observed=False):
        if not len(g):
            continue
        L.append(f"| {lab} | {len(g)} | {fp(g.pool_avg_net_pips.mean())} | {fp(g.pool_avg_net_pips.max())} "
                 f"| {fp(g.pool_avg_net_pips.min())} | {(g.pool_avg_net_pips > 0).sum()} "
                 f"| {g.pool_stopout_per_year.median():.1f} |")
    return L


def _cname(cand) -> str:
    return cand["name"] + ("（参考）" if cand["name"].startswith("ref_") else "")


def roll_tables(roll: pd.DataFrame) -> list[str]:
    L = ["| 候補 | ロット | 開始時期 | 試行数 | 10倍到達 | 破産(<5千円) | 破産までの月数(中央値) | 10倍までの月数(中央値) "
         "| 12か月後の残高(中央値) | 元本割れ | 2倍以上 | 残高の平均 |",
         "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for cand in FINAL + REFERENCE:
        for pol in LOT_POLICIES:
            r = roll[(roll.cand == cand["name"]) & (roll.policy == pol)]
            for lab, g in [("IS 2005-14", r[r.start < OOS_START_GROUP]),
                           ("OOS 2015-19", r[r.start >= OOS_START_GROUP])]:
                s = roll_summary(g)
                L.append(f"| {_cname(cand)} | {LOT_JA[pol]} | {lab} | {s['n']} | {s['p10x']:.1%} | {s['pruin']:.1%} "
                         f"| {s['med_m_ruin']:.1f} | {s['med_m_10x']:.1f} | {man(s['med_final'])} | {s['p_loss']:.0%} "
                         f"| {s['p_double']:.0%} | {man(s['mean_final'])} |".replace("| nan |", "| - |"))
    return L


def roll_pair_table(roll: pd.DataFrame) -> list[str]:
    L = ["| 候補 | ロット | " + " | ".join(f"{s} 10倍 / 破産" for s in PAIRS) + " |",
         "|---|---|" + "---:|" * len(PAIRS)]
    for cand in FINAL + REFERENCE:
        for pol in LOT_POLICIES:
            r = roll[(roll.cand == cand["name"]) & (roll.policy == pol)]
            cells = []
            for s in PAIRS:
                g = r[r.symbol == s]
                cells.append(f"{(g.status == '10x').mean():.0%} / {(g.status == 'ruin').mean():.0%}")
            L.append(f"| {_cname(cand)} | {LOT_JA[pol]} | " + " | ".join(cells) + " |")
    return L


def pick_examples(roll: pd.DataFrame):
    """Three monthly paths: the fastest 10x (or best) and a typical ruin of the combination
    most likely to reach 10x, and the median path of the combination least likely to ruin."""
    agg = roll.groupby(["cand", "policy"]).apply(lambda g: pd.Series(roll_summary(g)))
    k1 = agg.sort_values(["p10x", "med_final"], ascending=False).index[0]
    k2 = agg.sort_values(["pruin", "med_final"], ascending=[True, False]).index[0]
    r1 = roll[(roll.cand == k1[0]) & (roll.policy == k1[1])].reset_index(drop=True)
    r2 = roll[(roll.cand == k2[0]) & (roll.policy == k2[1])].reset_index(drop=True)
    ex = []
    tx = r1[r1.status == "10x"]
    if len(tx):
        ex.append((f"{k1[0]} × {LOT_JA[k1[1]]}: 10倍到達", tx.sort_values("months").iloc[0]))
    else:
        ex.append((f"{k1[0]} × {LOT_JA[k1[1]]}: 最も増えた例", r1.sort_values("final").iloc[-1]))
    ru = r1[r1.status == "ruin"]
    if len(ru):
        ex.append((f"{k1[0]} × {LOT_JA[k1[1]]}: 破産（月数が中央値の例）",
                   ru.iloc[(ru.months - ru.months.median()).abs().argsort().iloc[0]]))
    ex.append((f"{k2[0]} × {LOT_JA[k2[1]]}: 最終残高が中央値の例",
               r2.iloc[(r2.final - r2.final.median()).abs().argsort().iloc[0]]))
    return (k1, k2), ex


STATUS_JA = {"10x": "10倍到達", "ruin": "破産", "horizon": "12か月満了"}


def example_table(ex) -> list[str]:
    L = ["| 経過 | " + " | ".join(f"{lab}（{e['symbol']} {e['start']:%Y-%m} 開始）" for lab, e in ex) + " |",
         "|---|" + "---:|" * len(ex), "| 開始 | " + " | ".join("10.0万円" for _ in ex) + " |"]
    for kk in range(1, 13):
        cells = []
        for _, e in ex:
            if e["status"] != "horizon" and kk > math.ceil(e["months"]):
                cells.append("（終了）")
                continue
            prev = BAL0 if kk == 1 else e[f"eq_{kk - 1}"]
            cur = e[f"eq_{kk}"]
            ret = (cur / prev - 1) if prev > 0 else float("nan")
            cells.append(f"{man(cur)} ({'-' if not np.isfinite(ret) else f'{ret:+.0%}'})")
        L.append(f"| {kk}か月後 | " + " | ".join(cells) + " |")
    L.append("| 結果 | " + " | ".join(
        f"{STATUS_JA[e['status']]}（{e['months']:.1f}か月、残高 {man(e['final'])}、バスケット {e['n_baskets']:,}、"
        f"ロスカット {e['stopouts']}、ハードストップ {e['hardstops']}、ピーク {man(e['peak_balance'])}）" for _, e in ex) + " |")
    return L


def _lookup(allc, name, col):
    r = allc[allc.name == name]
    return float(r[col].iloc[0]) if len(r) else float("nan")


def report_text(results, roll) -> str:
    s1, s2, s3 = load_log("s1"), load_log("s2"), load_log("s3")
    allc = pd.concat([s1, s2, s3], ignore_index=True)
    n_log = len(allc)
    allc = allc.drop_duplicates(subset=["name"], keep="first")   # stage 2 re-runs 3 stage-1 configs
    n_cfg = len(allc)
    n_pos = int((allc.pool_avg_net_pips > 0).sum())
    n_pos_pair = int(sum((allc[f"{s}_avg_net_pips"] > 0).sum() for s in PAIRS))
    n_fr_pos = int((allc.pool_avg_frictionless_pips > 0).sum())
    surv = sum(v["survives"] for _, _, v in results.values())
    agg = roll.groupby(["cand", "policy"]).apply(lambda g: pd.Series(roll_summary(g)))
    best_key = agg.sort_values(["p10x", "med_final"], ascending=False).index[0]
    wes = {nm_: [win_expectancy(d) for d in _split(runs["base"])] for nm_, (_, runs, _) in results.items()}
    ratios = [w["ratio"] for ws in wes.values() for w in ws]
    cand_roll = roll[roll.cand.isin([c["name"] for c in FINAL])]
    ref_roll = roll[roll.cand.isin([c["name"] for c in REFERENCE])]
    cr, rr, allroll = roll_summary(cand_roll), roll_summary(ref_roll), roll_summary(roll)
    b = agg.loc[best_key]
    fix1 = agg.xs("fix0.01", level="policy")
    fix1c = fix1.loc[[c["name"] for c in FINAL]]
    delays = {nm_: (v["oos"]["avg_net_pips"], v["oos_delay1"], v["oos_delay2"]) for nm_, (_, _, v) in results.items()}
    max_dd = max(max(abs(d1 - b0), abs(d2 - b0)) for b0, d1, d2 in delays.values())
    worse_all = all(d1 < b0 and d2 < b0 for b0, d1, d2 in delays.values())
    sign_txt = "遅らせるとすべての候補でやや悪化しますが、" if worse_all else "方向も揃わず、"
    cost_eat = {nm_: v["oos_frictionless"] - v["oos"]["avg_net_pips"] for nm_, (_, _, v) in results.items()}
    per_day = {nm_: v["oos"]["per_year"] / len(PAIRS) / 260.0 for nm_, (_, _, v) in results.items()}
    L = [f"# ナンピン・マーチン（グリッド／マーチンゲール）EA の検証 — {KEY}", "",
         "再現: `python scripts/scalp_nanpin_martingale.py`（最終評価とこのレポート）、"
         "`--stage 1` / `--stage 2` / `--stage 3`（IS 探索、試行ログ `reports/trials/scalp_nanpin_martingale.jsonl` に追記）。"
         "`--dry <dir>` は IS データだけでパイプラインを確認するモード。", "",
         "## 結論", "",
         f"* **生き残った候補: {surv} / {len(results)}**。IS（2005-2014）で試した {n_cfg} 設定（試行ログは {n_log} 行、重複を除く）のうち、4ペア合算で"
         f"1バスケットの平均ネット損益がプラスになった設定は **{n_pos} / {n_cfg}**（ペア単位でも {n_pos_pair} / {n_cfg * 4}）。"
         f"コスト前（摩擦ゼロ）でもプラスは {n_fr_pos} / {n_cfg} 設定だけです。ナンピン・マーチンはエッジを作らず、"
         "損益の出方を「小さな利益が何百回 → まれに大きな損失」に変えるだけです。",
         f"* 勝率は {allc.pool_win_rate.min():.1%}〜{allc.pool_win_rate.max():.1%}（4ペア合算）と高いのに、期待値は全設定でマイナスです。"
         f"最終候補では、1回の負けの平均が1回の勝ちの平均の {min(ratios):,.0f}〜{max(ratios):,.0f} 倍で、"
         "損益分岐の勝率が実際の勝率より上にあります（第4節）。"]
    for nm_, (cand, runs, v) in results.items():
        we_o = wes[nm_][1]
        L.append(f"* 候補 `{nm_}`（{STYLE_JA[cand['style']]}）: IS {fp(v['is']['avg_net_pips'])} → OOS "
                 f"{fp(v['oos']['avg_net_pips'])} 初期ロットpips/バスケット（OOS 勝率 {v['oos']['win_rate']:.1%}、"
                 f"損益分岐の勝率 {we_o['be']:.2%}、t={v['oos']['t']:+.1f}、{v['oos']['n']:,} バスケット、"
                 f"1ペア1日あたり約 {per_day[nm_]:.0f} バスケット）。判定: {'生き残り' if v['survives'] else '不合格'}")
    L += [f"* 10万円→100万円のローリング開始テスト（毎月最初の足で開始、最長12か月、{roll.start.min():%Y-%m}〜{roll.start.max():%Y-%m} の "
          f"{roll.start.nunique()} か月 × 4ペア × 4ロット方針）: 最終候補3つ（{cr['n']:,} 口座）は 10倍 {cr['p10x']:.1%}・"
          f"破産 {cr['pruin']:.1%}、参考の損切りなし定番設定3つ（{rr['n']:,} 口座）は 10倍 {rr['p10x']:.1%}・破産 {rr['pruin']:.1%}。"
          f"最も 10倍に届きやすかった `{best_key[0]}` × {LOT_JA[best_key[1]]} でも 10倍 {b.p10x:.1%} に対して破産 {b.pruin:.1%}"
          f"（破産までの月数の中央値 {f1(b.med_m_ruin)}）。",
          f"* 最小ロット 0.01 固定でも、最終候補は 12か月以内に {fix1c.pruin.min():.0%}〜{fix1c.pruin.max():.0%} が破産しました。"
          f"原因は2つです: (1) 1バスケットあたり約 {min(cost_eat.values()):.1f}〜{max(cost_eat.values()):.1f} 初期ロットpips のコスト"
          "（スプレッド・手数料・スワップ）を1日に数回〜数十回払い続ける出血、(2) 損切りなしの設定では、ナンピンの許容幅を超える一方向の相場でのロスカット（第5節）。",
          f"* 分単位の速さ（AI による高速判断）はほぼ効きません。OOS で初回エントリーを1〜2分遅らせた差は最大 {max_dd:.2f} 初期ロットpips/バスケットで、"
          f"{sign_txt}どの候補もマイナスのままです。差の大部分は損切り・ロスカットの回数と塩漬けバスケットによる経路依存で、エントリーの速さの効果ではありません（第6節）。初回エントリーを逆張りシグナルから単なる売り買い交互に変えても IS の成績はほぼ同じでした。"
          "この EA 型の損益を決めるのは、エントリーの精度ではなく「逆行がナンピンの許容幅を超える日」と、積み重なるコストです。", "",
          "## 1. 何を検証したか", "",
          "* データ: OANDA M1 仲値 2005-01〜2020-05-14。実データの4ペア（EURJPY, EURUSD, GBPUSD, AUDJPY）。合成クロスは使っていません。",
          "* 約定（自作バスケットシミュレーター、`scripts/scalp_nanpin_martingale.py`）: 買いは ask、売りは bid で建て、反対側で決済。"
          "スプレッドは fxlab/scalp.py と同じ Titan FX ブレード相当 × 時間帯倍率（サーバー23時 2倍、0時 5倍、1-2時 1.5倍、3-8時 1.2倍）。"
          "成行の滑り、ロスカット/損切りの追加滑り、手数料 720円/lot 往復（約定ごとに計上）、ロールオーバーごとのスワップ"
          "（政策金利差 − 年2.5%の業者上乗せ、水曜3日分。fxlab.instruments.CostModel）。",
          "* 初回エントリー: シグナル足の終値で判断し、次の M1 足の始値で成行。`fade60` = 直近60本の値動きが 10 pips 以上なら逆張り、"
          "`fade30` = 30本・5 pips 以上、`alt` = 前回と逆方向（決済直後に次のバスケット）。初回は月〜金、サーバー23時・0時（ロールオーバー）、"
          "金曜21時以降、月曜2時前は入らない。",
          "* ナンピン: 最後の約定から G pips 逆行するたびに成行で追加（ロット = 初期ロット × m^n、0.01 lot 単位に丸め）、最大 L ポジション。"
          "余剰証拠金が足りないときは追加できず、そこで追加を止める（MT5 の発注ルール）。",
          "* 決済: 全ポジションの平均建値 + Y pips で一括利確（指値扱い・滑りなし）。任意のハードストップ = 追加が止まった後、"
          "最後の建値からさらに stop_k × G pips 逆行で一括損切り。",
          "* 口座: 10万円、レバレッジ 1,000 倍（証拠金 = 円建て想定元本 / 1000）、証拠金維持率 20% でバスケット全体をロスカット、"
          "ゼロカット（残高がマイナスなら 0 に戻す）。EURUSD/GBPUSD の円換算は **1ドル=110円の固定値**（損益・証拠金・スワップすべて）。",
          "* 同じ M1 足の中では、逆行側（ナンピン追加・ロスカット・損切り）を先に、値段の順に処理し、その後に利確を判定（保守的）。"
          "足の途中でナンピンが入った場合、下がった利確ラインは、その足の終値がそこを超えているときだけ約定とする。",
          "* バスケット単位の評価（生き残り判定・第2〜4節）: **各バスケットを新しい10万円口座・初期ロット固定で開始**。"
          "ロスカットの損失は最大でほぼ10万円（ゼロカット）。「初期ロットpips」= 円損益 ÷ 初期ロットの 1 pip の価値"
          "（0.01 lot なら EURJPY/AUDJPY 10円、EURUSD/GBPUSD 11円）。",
          "* 口座単位の評価（第5節）: 毎月最初の足で10万円の口座を開始し、残高 100万円（10倍）、5,000円未満（破産）、12か月のどれかで終了。"
          "残高は複利で動くので、ロスカットまでの距離も残高とともに変わる。",
          f"* IS = 2005-2014 だけで設定を選び、最終候補3つを OOS = 2015-2020.5 で1回だけ評価。試した設定は **{n_cfg}**"
          f"（評価 {n_log} 回。ステージ2の Y=5・損切りなしの3つはステージ1と同じ設定の再評価）"
          f"（ステージ1 {len(s1)}: G{{5,10,20,30}} × m{{1.0,1.3,1.5,2.0}} × L{{4,8,12}}、Y=5、0.01 lot、損切りなし、fade60。"
          f"ステージ2 {len(s2)}: 各スタイル（等倍 m=1.0 / 弱マーチン m=1.3・1.5 / マーチン m=2.0）のステージ1最良形 × Y{{2,5,10,15}} × ハードストップ{{なし,1G,3G}}。"
          f"ステージ3 {len(s3)}: 各スタイルのステージ2最良 × 初回エントリー{{fade30, alt}}・初期ロット{{0.03, 0.1}}）。"
          "最終候補は、事前に決めた3スタイルそれぞれで IS 平均ネット（初期ロットpips）が最良の設定。",
          "* 参考設定（第5節の口座テストだけ）: ステージ1の中央付近の「損切りなし」定番形 G=20, L=8, Y=5, fade60 を m=1.0/1.5/2.0 で"
          "（`ref_grid20` / `ref_mild20` / `ref_marti20`）。成績を見て選んだものではなく、市販 EA によくある形として事前に固定。"
          "IS のバスケット成績はステージ1の表のとおり（すべてマイナス）。", "",
          "## 2. IS 探索（2005-2014、4ペア合算、各バスケット10万円・0.01 lot 開始）", "",
          "ステージ1（上位12 / 48）:", ""] + _stage_table(s1, 12) + [
          "", "ステージ2（上位12 / 36）:", ""] + _stage_table(s2, 12) + [
          "", "ステージ3（12）:", ""] + _stage_table(s3) + [
          "", f"IS 勝率と期待値（全 {n_cfg} 設定）:", ""] + winrate_buckets(allc)
    n0, n1 = "G10_m1_L4_Y5_stopnone_fade60_lot0.01", "G10_m1_L4_Y5_stop1G_fade60_lot0.01"
    L += ["", "* 勝率を上げる一番簡単な方法は、利確幅 Y を小さくし、損切りをなくすことです。そうすると、ロスカット1回の損失が大きくなるだけで、"
          "期待値は良くなりません。逆にハードストップを入れると勝率は下がり、最大損失は小さくなります（例: "
          f"`{n0}` 勝率 {_lookup(allc, n0, 'pool_win_rate'):.1%}・最大損失 {yen(_lookup(allc, n0, 'pool_worst_jpy'))}円 → "
          f"`{n1}` 勝率 {_lookup(allc, n1, 'pool_win_rate'):.1%}・最大損失 {yen(_lookup(allc, n1, 'pool_worst_jpy'))}円）。"
          "どちらでも期待値はマイナスです。",
          "* G=20/30 の m=2.0 では、L=8 と L=12 の結果が同じでした。10万円・0.01 lot では、8段目までに余剰証拠金不足かロスカットで止まるためです"
          "（パラメータ上の最大段数は、口座の大きさで実質的に決まる）。", "",
          "## 3. 最終候補（OOS は1回だけ評価）", ""]
    for nm_, (cand, runs, v) in results.items():
        L += candidate_section(cand, runs, v)
    L += ["## 4. 勝率と期待値の関係", "",
          "| 候補 | 区間 | 勝率 | 平均利益(円) | 平均損失(円) | 損失/利益 | 損益分岐の勝率 | 期待値(円/バスケット) |",
          "|---|---|---:|---:|---:|---:|---:|---:|"]
    for nm_ in results:
        for lab, we in zip(["IS", "OOS"], wes[nm_]):
            L.append(f"| {nm_} | {lab} | {we['win']:.2%} | {we['avg_win']:,.0f} | {we['avg_loss']:,.0f} | {we['ratio']:,.0f}倍 "
                     f"| {we['be']:.2%} | {we['exp']:+,.1f} |")
    L += ["", "* 期待値 = 勝率 × 平均利益 − (1 − 勝率) × 平均損失。損益分岐の勝率 = 平均損失 ÷ (平均利益 + 平均損失)。",
          "* ナンピン・マーチンは、利確を近くに・損失を遠くに置くことで勝率を押し上げます。そのぶん1回の負けが大きくなり、"
          "損益分岐の勝率も同じだけ上がります。コスト前（摩擦ゼロ）の期待値はほぼゼロ以下なので、どの形にしてもスプレッド・手数料・スワップの分だけマイナスが残ります。"
          "この形の高い勝率は、まれな大損と引き換えに得ているもので、儲かることを意味しません。", "",
          "## 5. 10万円 → 100万円 チャレンジ（ローリング開始、12か月）", "",
          "毎月最初の足で10万円の口座を開始し、10倍（100万円）・破産（5千円未満）・12か月のどれかで終了。4ペア合算"
          f"（開始月 {roll.start.min():%Y-%m}〜{roll.start.max():%Y-%m}、1ペアあたり {roll.start.nunique()} 本。"
          "2014年開始の口座は OOS 期間にまたがります）。"
          "「複利 0.03 lot/10万円」は、各バスケットの初期ロットを 0.03 × 残高/10万円（0.01 lot 単位で切り捨て）にする方式。"
          "月末残高は含み損益込みの時価。", ""] + roll_tables(roll) + [
          "", "ペア別（全開始月、10倍到達 / 破産の割合）:", ""] + roll_pair_table(roll)
    keys, ex = pick_examples(roll)
    L += ["", "月次の残高推移の例（括弧内は前月比。10倍・破産で終了した月の後は（終了））:", ""]
    L += example_table(ex)
    ruin_so = roll[roll.status == "ruin"]
    so_share = {c: float((g.stopouts > 0).mean()) for c, g in ruin_so.groupby("cand")}
    L += ["", "* 破産のうちロスカット（証拠金維持率20%）を1回以上含む割合: "
          + "、".join(f"{c} {pct(so_share.get(c, float('nan')))}" for c in [x["name"] for x in FINAL + REFERENCE]) + "。"
          "ハードストップ付きの候補（grid10, marti30）の破産の多くは、ロスカットではなく損切りとコストの積み重ねによるものです"
          "（ロットが残高に対して大きいと、損切りラインより先に証拠金維持率20%に届くのでロスカットも起きます）。"
          "損切りなしの設定の破産は、すべてロスカットを含みます。しばらく増えたり横ばいだったりしたあと、1回のロスカットで口座のほぼ全額を失う形です。",
          f"* ロットを上げると 10倍に届く確率はわずかに上がりますが、破産の確率も上がり、破産までの期間は短くなります"
          f"（全 {allroll['n']:,} 口座で 10倍 {allroll['p10x']:.1%}、破産 {allroll['pruin']:.1%}、12か月後の残高の中央値 {man(allroll['med_final'])}）。"
          f"10倍に届いた {int((roll.status == '10x').sum())} 口座は、10倍までの月数の中央値が {f1(roll[roll.status == '10x'].months.median())} か月で、"
          "ナンピンの許容幅を超える逆行が来る前に短期間で目標に届いた幸運な例です。同じ設定・同じロットの口座の大半は破産しています。", "",
          "## 6. 速さ（AI の高速判断）は効くか", "",
          "| 候補 | OOS 基準 | 1分遅れ | 2分遅れ | 摩擦ゼロ | コスト1.5倍 | コスト2倍 |",
          "|---|---:|---:|---:|---:|---:|---:|"]
    for nm_, (cand, runs, v) in results.items():
        L.append(f"| {nm_} | {fp(v['oos']['avg_net_pips'])} | {fp(v['oos_delay1'])} | {fp(v['oos_delay2'])} "
                 f"| {fp(v['oos_frictionless'])} | {fp(v['oos_cost15'])} | {fp(v['oos_cost2'])} |")
    L += ["", "（初期ロットpips/バスケット、OOS 2015-2020.5）", "",
          "遅れの内訳（損切り・ロスカットの回数と、それを除いた利確バスケットだけの平均）:", "",
          "| 候補 | 条件 | IS 平均 | OOS バスケット数 | OOS 損切り+ロスカット | OOS 平均 | OOS 損切り・ロスカットを除く平均 |",
          "|---|---|---:|---:|---:|---:|---:|"]
    for nm_, (cand, runs, v) in results.items():
        for kk, lab in [("base", "基準"), ("delay1", "1分遅れ"), ("delay2", "2分遅れ")]:
            di, do = _split(runs[kk])
            bad = do.reason.isin(["stopout", "hardstop"])
            L.append(f"| {nm_} | {lab} | {fp(di.net_pips.mean())} | {len(do):,} | {int(bad.sum()):,} | {fp(do.net_pips.mean())} "
                     f"| {fp(do.net_pips[~bad].mean())} |")
    s3_ent = s3[s3.entry.isin(["alt", "fade30"])]
    ex_d = []
    for nm_, (cand, runs, v) in results.items():
        vals = []
        for kk in ("base", "delay1", "delay2"):
            do = _split(runs[kk])[1]
            vals.append(float(do.net_pips[~do.reason.isin(["stopout", "hardstop"])].mean()))
        ex_d.append(max(abs(vals[1] - vals[0]), abs(vals[2] - vals[0])))
    L += ["", f"* 損切り・ロスカットを除いた平均（利確したバスケットの質）は、1〜2分遅れても最大 {max(ex_d):.2f} pips しか変わりません"
          f"（候補ごとの最大差: {', '.join(f'{nm_} {x:.2f}' for nm_, x in zip(results, ex_d))}）。"
          "遅れで平均が動くのは、主に損切り・ロスカットの回数と、長期の塩漬けバスケットによるバスケット数の違い（経路依存）のためです。"
          "損切りなしの mild30 では1回のロスカットが OOS 平均を約 "
          f"{10000.0 / max(len(_split(results['mild30'][1]['base'])[1]) if 'mild30' in results else 1, 1):.2f}"
          " pips/バスケット動かすので、数回の差で平均が大きく動きます。",
          f"* 初回エントリーを1〜2分遅らせた差は最大 {max_dd:.2f} pips/バスケットで、コストの差（1.5倍にすると "
          + "、".join(f"{nm_} {v['oos_cost15'] - v['oos']['avg_net_pips']:+.2f}" for nm_, (_, _, v) in results.items())
          + f"）と比べても小さく、{sign_txt}結論は変わりません。",
          "* ステージ3では、初回エントリーを「60分の逆張り」から「30分の逆張り」や「売り買い交互（alt）」に変えても、IS の成績はほぼ同じでした（"
          + "、".join(f"{r.name}: {r.pool_avg_net_pips:+.2f}" for r in s3_ent.itertuples()) + "）。"
          "エントリーをどれだけ賢く・速くしても（AI を含む）、この EA 型の結果はほとんど変わりません。",
          "* AI で高速に判断して勝率を上げられるのは、1回あたりのコスト前エッジがコスト（スプレッド＋手数料＋スワップ）を上回る場合だけです。"
          "ナンピン・マーチンは勝率を「作る」仕組みなので、判断を速くしても期待値のマイナスは変わりません。", "",
          "## 7. 注意点（シミュレーターの限界）", "",
          "* EURUSD/GBPUSD の円換算は 1ドル=110円の固定値です。実際は 2005-2020 に 76〜124円で動いたので、円建ての損益・証拠金は最大 ±30% ずれます"
          "（勝ち負けの符号は変わりません）。",
          "* 証拠金は各約定時の価格で固定、ロスカットはバスケット全体を1回で決済（Titan FX は損失の大きいポジションから1つずつ）。"
          "実際のロスカット価格は少しずれますが、ほぼ全額を失う点は同じです。",
          "* スワップは政策金利の年平均から作った近似で、実際の Titan FX のスワップとは異なります（上乗せ 年2.5%）。"
          "長く持ち越すバスケット（最長で数百日）ほど影響が大きくなります。",
          "* M1 足の中の値動きの順番は分からないため、逆行側を先に処理しています（楽観的にならない側）。"
          "足の中でナンピンが入った場合、同じ足での利確は終値で判断しているので、実際より利確が少し遅れる可能性があります（保守的）。"
          "逆に「利確が先」と楽観的に処理した場合の IS（2005-2014）: "
          + "、".join(f"{nm_} 摩擦ゼロ {fp(_split(runs['frictionless'])[0].net_pips.mean())} → {fp(runs['favfirst0'].net_pips.mean())}、"
                     f"コスト込み {fp(_split(runs['base'])[0].net_pips.mean())} → {fp(runs['favfirst1'].net_pips.mean())}"
                     for nm_, (_, runs, _) in results.items())
          + "（初期ロットpips/バスケット）。足の中の順番の仮定で動くのはコストよりずっと小さい幅で、結論は変わりません。",
          "* 最大ロット（1注文 100 lot）、ポジション数の上限、週末のスプレッド拡大、重要指標時のスリッページ急拡大、約定拒否は"
          "モデル化していません。どれも現実では結果を悪くする方向です。",
          "* OANDA の仲値 M1 足です。2005-2013 のデータにある土日の足は、エントリーには使わず、保有中の値動きとしてだけ使っています。",
          "* 1ペア＝1口座で評価しています。複数ペアを同じ口座で同時に動かすと、ロスカットは相関した大相場で同時に来るため、"
          "破産の確率はさらに上がります。"]
    return "\n".join(L) + "\n"


def _dry_run(out_dir: str):
    """Pipeline check that never touches OOS data: 'IS' = 2005-2009, 'OOS' = 2010-2014,
    outputs and the trial log copy go to out_dir."""
    global IS_END, OOS_END, IS_YEARS, OOS_YEARS, OUT_DIR, REPORT, ROLLING_FILE, OOS_START_GROUP
    import shutil
    IS_END, OOS_END = pd.Timestamp("2010-01-01"), pd.Timestamp("2015-01-01")
    IS_YEARS, OOS_YEARS = 5.0, 5.0
    OOS_START_GROUP = IS_END
    OUT_DIR = Path(out_dir)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT, ROLLING_FILE = OUT_DIR / f"{KEY}.md", OUT_DIR / f"rolling_{KEY}.parquet"
    shutil.copy(LOG.path, OUT_DIR / "trial_log_copy.jsonl")
    LOG.path = OUT_DIR / "trial_log_copy.jsonl"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", type=int, default=0)
    ap.add_argument("--dry", default=None, help="pipeline check on IS data only (output dir)")
    a = ap.parse_args()
    t0 = time.time()
    if a.dry:
        _dry_run(a.dry)
    {1: stage1, 2: stage2, 3: stage3}.get(a.stage, lambda: final())()
    print(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
