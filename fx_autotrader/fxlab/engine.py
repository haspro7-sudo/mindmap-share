"""Backtest engine.

Two layers:

1. ``simulate_symbol``  (numba kernel) - walks execution bars (normally H1) for
   one symbol and turns a strategy's decisions into a list of trades in *price*
   terms (mid prices, no costs).  Decisions are computed on completed signal-
   timeframe bars and only become visible at the open of the first execution bar
   after that signal bar has closed, so the strategy cannot see the future.

2. ``run_portfolio``  - replays every symbol's trades in time order against one
   JPY account: costs (spread, slippage, commission, swap), risk-based position
   sizing in 0.01-lot steps, portfolio risk limits, margin, and the staged risk
   schedule.  Produces the trade ledger and a daily mark-to-market equity curve.

Strategy decision frame (indexed by signal-bar open time, one row per bar):
    long_entry, short_entry        bool   open a position (market at next open,
                                          or stop-entry order if *_stop_px set)
    exit_long, exit_short          bool   close at next open
    stop_dist                      float  initial stop distance (price units, >0)
    trail_dist                     float  chandelier trail distance (0/NaN = none)
    tp_dist                        float  take-profit distance (0/NaN = none)
    long_stop_px, short_stop_px    float  stop-entry price (NaN = market order)
    max_hold                       int    time stop in signal bars (0 = none)

Execution rules (identical in mt5/TitanStagedEA.mq5):
  * a decision is executed at the open of the first execution bar after its signal
    bar closed; if that bar opens in the rollover hour (server 00:00-00:59, incl.
    the Monday open) execution waits for the 01:00 bar (wide spreads, gold closed).
  * at a decision the order is: trailing-stop update -> exits (signal / reverse /
    time / trail beyond price) -> entries.  An entry may open on the same bar a
    position was closed (stop-and-reverse, or re-entry when the entry signal holds).
  * stop-entry orders live until the next decision; if both sides of an OCO pair
    trigger inside one execution bar, M1 data decides which printed first (or, with
    no M1 data, the side that is worse at the bar close is assumed).
  * after an intrabar stop-entry fill, the stop is only tested against prices that
    printed after the fill (M1 data); without M1 data the whole bar is used.
  * when a stop and a take-profit are both inside one bar, the stop is assumed first.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import numba as nb
import numpy as np
import pandas as pd

from .instruments import INSTRUMENTS, CostModel, Instrument, quote_to_jpy_symbol

TF_DURATION = {"M1": pd.Timedelta(minutes=1), "H1": pd.Timedelta(hours=1),
               "H4": pd.Timedelta(hours=4), "D1": pd.Timedelta(days=1)}

EXIT_STOP, EXIT_TP, EXIT_SIGNAL, EXIT_TIME, EXIT_REVERSE, EXIT_END = range(6)
EXIT_NAMES = ["stop", "tp", "signal", "time", "reverse", "end"]

DECISION_COLUMNS = ["long_entry", "short_entry", "exit_long", "exit_short", "stop_dist",
                    "trail_dist", "tp_dist", "long_stop_px", "short_stop_px", "max_hold"]

_EMPTY_I = np.empty(0, np.int64)
_EMPTY_F = np.empty(0, np.float64)


# --------------------------------------------------------------------------- kernel
@nb.njit(cache=True)
def _kernel(o, h, l, c, dec_idx, d_long, d_short, d_xl, d_xs, d_stop, d_trail, d_tp,
            d_lpx, d_spx, d_maxhold, fs, fe, fh, fl):
    n = o.shape[0]
    has_fine = fs.shape[0] == n
    ent_i = np.empty(n, np.int64)
    ext_i = np.empty(n, np.int64)
    dirs = np.empty(n, np.int64)
    ent_px = np.empty(n, np.float64)
    ext_px = np.empty(n, np.float64)
    stop0 = np.empty(n, np.float64)
    reason = np.empty(n, np.int64)
    stop_entry = np.empty(n, np.int64)   # 1 = filled by a stop-entry order
    ent_open = np.empty(n, np.int64)     # 1 = entry filled at the bar open
    ext_open = np.empty(n, np.int64)     # 1 = exit filled at the bar open
    nt = 0

    pos = 0
    e_i = 0
    e_px = 0.0
    e_stop = 0
    e_open = 1
    stop = np.nan
    tp = np.nan
    hold = 0
    maxhold = 0
    s0 = 0.0
    hh = -np.inf
    ll = np.inf
    p_long = np.nan
    p_short = np.nan
    p_stop = 0.0
    p_tp = 0.0
    p_maxhold = 0

    for i in range(n):
        r = 0
        px = 0.0
        bar_lo = l[i]
        bar_hi = h[i]
        # ---- 1) gap through stop / tp at the open
        if pos != 0:
            hit = False
            if pos == 1 and o[i] <= stop:
                hit = True
                r = EXIT_STOP
            elif pos == -1 and o[i] >= stop:
                hit = True
                r = EXIT_STOP
            elif pos == 1 and tp == tp and o[i] >= tp:
                hit = True
                r = EXIT_TP
            elif pos == -1 and tp == tp and o[i] <= tp:
                hit = True
                r = EXIT_TP
            if hit:
                ent_i[nt] = e_i; ext_i[nt] = i; dirs[nt] = pos; ent_px[nt] = e_px
                ext_px[nt] = o[i]; stop0[nt] = s0; reason[nt] = r
                stop_entry[nt] = e_stop; ent_open[nt] = e_open; ext_open[nt] = 1; nt += 1
                pos = 0

        # ---- 2) decision at the open
        k = dec_idx[i]
        if k >= 0:
            p_long = np.nan
            p_short = np.nan
            if pos != 0:
                hold += 1
                td = d_trail[k]
                if td == td and td > 0.0:
                    if pos == 1:
                        ns = hh - td
                        if ns > stop:
                            stop = ns
                    else:
                        ns = ll + td
                        if ns < stop:
                            stop = ns
                do_exit = False
                r = EXIT_SIGNAL
                if pos == 1 and d_xl[k]:
                    do_exit = True
                elif pos == -1 and d_xs[k]:
                    do_exit = True
                elif pos == 1 and d_short[k] and d_spx[k] != d_spx[k]:
                    do_exit = True
                    r = EXIT_REVERSE
                elif pos == -1 and d_long[k] and d_lpx[k] != d_lpx[k]:
                    do_exit = True
                    r = EXIT_REVERSE
                elif maxhold > 0 and hold >= maxhold:
                    do_exit = True
                    r = EXIT_TIME
                elif pos == 1 and o[i] <= stop:
                    do_exit = True
                    r = EXIT_STOP
                elif pos == -1 and o[i] >= stop:
                    do_exit = True
                    r = EXIT_STOP
                if do_exit:
                    ent_i[nt] = e_i; ext_i[nt] = i; dirs[nt] = pos; ent_px[nt] = e_px
                    ext_px[nt] = o[i]; stop0[nt] = s0; reason[nt] = r
                    stop_entry[nt] = e_stop; ent_open[nt] = e_open; ext_open[nt] = 1; nt += 1
                    pos = 0
            if pos == 0:
                sd = d_stop[k]
                ok = sd == sd and sd > 0.0
                go_long = d_long[k] and ok
                go_short = d_short[k] and ok
                mkt_long = go_long and d_lpx[k] != d_lpx[k]
                mkt_short = go_short and d_spx[k] != d_spx[k]
                if mkt_long and not go_short:
                    pos = 1
                elif mkt_short and not go_long:
                    pos = -1
                if pos != 0:
                    e_i = i; e_px = o[i]; s0 = sd; e_stop = 0; e_open = 1
                    stop = e_px - pos * sd
                    tpd = d_tp[k]
                    tp = e_px + pos * tpd if (tpd == tpd and tpd > 0.0) else np.nan
                    hold = 0; maxhold = d_maxhold[k]
                    hh = o[i]; ll = o[i]
                else:
                    if go_long and d_lpx[k] == d_lpx[k]:
                        p_long = d_lpx[k]
                    if go_short and d_spx[k] == d_spx[k]:
                        p_short = d_spx[k]
                    if p_long == p_long or p_short == p_short:
                        p_stop = sd
                        tpd = d_tp[k]
                        p_tp = tpd if tpd == tpd else 0.0
                        p_maxhold = d_maxhold[k]

        # ---- 3) pending stop-entry orders
        if pos == 0 and (p_long == p_long or p_short == p_short):
            trig_l = p_long == p_long and h[i] >= p_long
            trig_s = p_short == p_short and l[i] <= p_short
            fill_j = -1
            at_open = False
            if trig_l or trig_s:
                if trig_l and o[i] >= p_long:          # gapped through the buy-stop
                    trig_s = False
                    at_open = True
                elif trig_s and o[i] <= p_short:       # gapped through the sell-stop
                    trig_l = False
                    at_open = True
                else:
                    if has_fine and fs[i] >= 0:
                        for j in range(fs[i], fe[i]):
                            tl = trig_l and fh[j] >= p_long
                            tsh = trig_s and fl[j] <= p_short
                            if tl or tsh:
                                fill_j = j
                                if tl and tsh:
                                    if (c[i] - p_long) <= (p_short - c[i]):
                                        trig_s = False
                                    else:
                                        trig_l = False
                                elif tl:
                                    trig_s = False
                                else:
                                    trig_l = False
                                break
                    if trig_l and trig_s:
                        # order unknown: keep the leg that is worse at the bar close
                        if (c[i] - p_long) <= (p_short - c[i]):
                            trig_s = False
                        else:
                            trig_l = False
            if trig_l:
                pos = 1
                e_px = max(o[i], p_long)
            elif trig_s:
                pos = -1
                e_px = min(o[i], p_short)
            if pos != 0:
                e_i = i; s0 = p_stop; e_stop = 1
                e_open = 1 if at_open else 0
                stop = e_px - pos * p_stop
                tp = e_px + pos * p_tp if p_tp > 0.0 else np.nan
                hold = 0; maxhold = p_maxhold
                hh = e_px; ll = e_px
                p_long = np.nan
                p_short = np.nan
                if not at_open and fill_j >= 0:
                    # only prices printed from the fill minute onwards can hit the stop
                    bar_lo = fl[fill_j]
                    bar_hi = fh[fill_j]
                    for j in range(fill_j + 1, fe[i]):
                        if fl[j] < bar_lo:
                            bar_lo = fl[j]
                        if fh[j] > bar_hi:
                            bar_hi = fh[j]

        # ---- 4) intrabar stop / take-profit (stop first when both are touched)
        if pos != 0:
            hit = False
            if pos == 1:
                if bar_lo <= stop:
                    hit = True; r = EXIT_STOP; px = stop
                elif tp == tp and bar_hi >= tp:
                    hit = True; r = EXIT_TP; px = tp
            else:
                if bar_hi >= stop:
                    hit = True; r = EXIT_STOP; px = stop
                elif tp == tp and bar_lo <= tp:
                    hit = True; r = EXIT_TP; px = tp
            if hit:
                ent_i[nt] = e_i; ext_i[nt] = i; dirs[nt] = pos; ent_px[nt] = e_px
                ext_px[nt] = px; stop0[nt] = s0; reason[nt] = r
                stop_entry[nt] = e_stop; ent_open[nt] = e_open; ext_open[nt] = 0; nt += 1
                pos = 0
            else:
                if bar_hi > hh:
                    hh = bar_hi
                if bar_lo < ll:
                    ll = bar_lo

    if pos != 0:
        ent_i[nt] = e_i; ext_i[nt] = n - 1; dirs[nt] = pos; ent_px[nt] = e_px
        ext_px[nt] = c[n - 1]; stop0[nt] = s0; reason[nt] = EXIT_END
        stop_entry[nt] = e_stop; ent_open[nt] = e_open; ext_open[nt] = 0; nt += 1

    return (ent_i[:nt], ext_i[:nt], dirs[:nt], ent_px[:nt], ext_px[:nt], stop0[:nt],
            reason[:nt], stop_entry[:nt], ent_open[:nt], ext_open[:nt])


# --------------------------------------------------------------------- per symbol
def map_decisions(signal_index: pd.DatetimeIndex, tf: str, exec_index: pd.DatetimeIndex,
                  avoid_rollover: bool = False) -> np.ndarray:
    """dec_idx[i] = k  when signal bar k has closed by the open of execution bar i.

    avoid_rollover: an execution bar opening in the server 00:00 hour is replaced by
    the first bar at/after 01:00 of that day (used for intraday execution bars).
    """
    ev = exec_index.values
    closes = (signal_index + TF_DURATION[tf]).values
    pos = np.searchsorted(ev, closes, side="left")
    if avoid_rollover and len(ev):
        ok0 = pos < len(ev)
        t = pd.DatetimeIndex(ev[np.minimum(pos, len(ev) - 1)])
        in_roll = ok0 & (t.hour == 0)
        tgt = (t.normalize() + pd.Timedelta(hours=1)).values
        pos = np.where(in_roll, np.searchsorted(ev, tgt, side="left"), pos)
    dec = np.full(len(exec_index), -1, dtype=np.int64)
    ok = pos < len(exec_index)
    # later signal bars overwrite earlier ones mapped to the same execution bar
    dec[pos[ok]] = np.arange(len(signal_index))[ok]
    return dec


def _col(df, name, default, dtype):
    if name in df:
        return df[name].to_numpy(dtype=dtype, na_value=default) if dtype is not bool \
            else df[name].fillna(False).to_numpy(dtype=bool)
    return np.full(len(df), default, dtype=dtype)


def _infer_duration(index: pd.DatetimeIndex) -> pd.Timedelta:
    if len(index) < 3:
        return pd.Timedelta(hours=1)
    return pd.Series(index[1:] - index[:-1]).mode().iloc[0]


def simulate_symbol(decisions: pd.DataFrame, tf: str, exec_bars: pd.DataFrame,
                    fine_bars: pd.DataFrame | None = None,
                    avoid_rollover: bool | None = None) -> pd.DataFrame:
    """Run the kernel for one symbol; returns trades in price terms.

    fine_bars: optional finer bars (e.g. M1, same server-time clock) used to resolve
    the order of events inside an execution bar for stop-entry orders.
    avoid_rollover: default True when execution bars are intraday (H1/H4/M1).
    """
    dur = _infer_duration(exec_bars.index)
    if avoid_rollover is None:
        avoid_rollover = dur < pd.Timedelta(days=1)
    dec = map_decisions(decisions.index, tf, exec_bars.index, avoid_rollover)
    fs, fe, fh, fl = _EMPTY_I, _EMPTY_I, _EMPTY_F, _EMPTY_F
    uses_stop_orders = (
        ("long_stop_px" in decisions and decisions["long_stop_px"].notna().any()) or
        ("short_stop_px" in decisions and decisions["short_stop_px"].notna().any()))
    if fine_bars is not None and uses_stop_orders and len(fine_bars):
        fi = fine_bars.index.values
        starts = exec_bars.index.values
        fs = np.searchsorted(fi, starts, side="left").astype(np.int64)
        fe = np.searchsorted(fi, (exec_bars.index + dur).values, side="left").astype(np.int64)
        fs = np.where(fe > fs, fs, -1).astype(np.int64)
        fh = fine_bars["high"].to_numpy(np.float64)
        fl = fine_bars["low"].to_numpy(np.float64)
    args = (
        exec_bars["open"].to_numpy(np.float64), exec_bars["high"].to_numpy(np.float64),
        exec_bars["low"].to_numpy(np.float64), exec_bars["close"].to_numpy(np.float64), dec,
        _col(decisions, "long_entry", False, bool), _col(decisions, "short_entry", False, bool),
        _col(decisions, "exit_long", False, bool), _col(decisions, "exit_short", False, bool),
        _col(decisions, "stop_dist", np.nan, np.float64),
        _col(decisions, "trail_dist", np.nan, np.float64),
        _col(decisions, "tp_dist", np.nan, np.float64),
        _col(decisions, "long_stop_px", np.nan, np.float64),
        _col(decisions, "short_stop_px", np.nan, np.float64),
        _col(decisions, "max_hold", 0, np.int64),
        fs, fe, fh, fl,
    )
    ei, xi, d, epx, xpx, s0, r, se, eo, xo = _kernel(*args)
    idx = exec_bars.index
    return pd.DataFrame({
        "entry_time": idx[ei], "exit_time": idx[xi], "entry_i": ei, "exit_i": xi,
        "dir": d, "entry_mid": epx, "exit_mid": xpx, "stop_dist": s0,
        "reason": [EXIT_NAMES[x] for x in r],
        "stop_entry": se.astype(bool), "entry_at_open": eo.astype(bool),
        "exit_at_open": xo.astype(bool),
    })


# ---------------------------------------------------------------------- portfolio
@dataclass
class RiskSchedule:
    """Fraction of balance risked per trade, possibly depending on account state.

    ``stages``: (balance_threshold_jpy, risk_fraction) - the highest threshold <=
    balance applies (base_risk below the lowest).  ``dd_throttle``: (drawdown_from_
    peak, multiplier) - the deepest drawdown level reached applies.
    """
    base_risk: float = 0.01
    stages: list[tuple[float, float]] = field(default_factory=list)
    dd_throttle: list[tuple[float, float]] = field(default_factory=list)

    def risk(self, balance: float, peak: float) -> float:
        r = self.base_risk
        for thr, rf in sorted(self.stages):
            if balance >= thr:
                r = rf
        dd = 1.0 - balance / peak if peak > 0 else 0.0
        mult = 1.0
        for d, m in sorted(self.dd_throttle):
            if dd >= d:
                mult = m
        return r * mult


@dataclass
class PortfolioConfig:
    initial_jpy: float = 500_000.0
    risk: RiskSchedule = field(default_factory=RiskSchedule)
    costs: CostModel = field(default_factory=CostModel)
    leverage: float = 500.0
    max_margin_usage: float = 0.5        # of equity
    max_open_trades: int = 10
    max_open_risk: float = 0.08          # sum of initial risk of open trades / balance
    max_trades_per_symbol: int = 1
    withdrawals: Callable | None = None  # f(balance, peak, date) -> jpy to withdraw (tax etc.)
    book_risk: dict = field(default_factory=dict)  # "tag" -> risk multiplier for "tag|SYMBOL" books


class ConversionTable:
    """Quote-currency -> JPY conversion looked up as-of a timestamp."""

    def __init__(self, closes: dict[str, pd.Series]):
        self.series = {k: v.sort_index() for k, v in closes.items()}
        derived = {}
        if "USDJPY" in closes and "USDCHF" in closes:
            derived["CHFJPY"] = (closes["USDJPY"] / closes["USDCHF"]).dropna()
        if "NZDUSD" in closes and "USDJPY" in closes:
            derived["NZDJPY"] = (closes["NZDUSD"] * closes["USDJPY"]).dropna()
        self.series.update(derived)

    def rate(self, quote: str, times: pd.DatetimeIndex | pd.Series) -> np.ndarray:
        sym = quote_to_jpy_symbol(quote)
        t = pd.DatetimeIndex(times)
        if sym is None:
            return np.ones(len(t))
        s = self.series[sym]
        pos = np.searchsorted(s.index.values, t.values, side="right") - 1
        pos = np.clip(pos, 0, len(s) - 1)
        return s.to_numpy()[pos]


_ROLL_WEIGHT = np.array([0, 1, 1, 3, 1, 1, 0])  # weight of rollover *into* Mon..Sun


def swap_nights(entry: pd.Timestamp, exit_: pd.Timestamp) -> int:
    d0, d1 = entry.normalize(), exit_.normalize()
    ndays = (d1 - d0).days
    if ndays <= 0:
        return 0
    weeks, rem = divmod(ndays, 7)
    total = weeks * 7
    wd = d0.dayofweek
    for j in range(1, rem + 1):
        total += _ROLL_WEIGHT[(wd + j) % 7]
    return int(total)


def _flag(df, name, default):
    if name in df:
        return df[name].fillna(default).to_numpy(bool)
    return np.full(len(df), default, dtype=bool)


def run_portfolio(trades: dict[str, pd.DataFrame], conv: ConversionTable,
                  daily_close: dict[str, pd.Series], cfg: PortfolioConfig,
                  start=None, end=None) -> "PortfolioResult":
    """Replay per-symbol trades against one JPY account.

    ``trades`` keys are symbols, or "book|SYMBOL" to run several strategies on the
    same symbol side by side (the per-symbol limit then applies per book).
    Trades are selected by entry time in [start, end); trades still open at `end`
    are closed at the last daily close before `end` so no later prices are used.
    """
    rows = []
    for key, t in trades.items():
        if t is None or len(t) == 0:
            continue
        t = t.copy()
        t["book"] = key
        t["symbol"] = key.split("|")[-1]
        rows.append(t)
    if not rows:
        return PortfolioResult.empty(cfg, start, end)
    allt = pd.concat(rows, ignore_index=True)
    if start is not None:
        allt = allt[allt.entry_time >= pd.Timestamp(start)]
    if end is not None:
        te = pd.Timestamp(end)
        allt = allt[allt.entry_time < te].copy()
        late = (allt.exit_time > te).to_numpy()
        if late.any():
            for sym in allt.symbol[late].unique():
                dc = daily_close[sym]
                before = dc[dc.index < te]
                mm = late & (allt.symbol == sym).to_numpy()
                allt.loc[mm, "exit_mid"] = before.iloc[-1]
            allt.loc[late, "exit_time"] = te
            allt.loc[late, "reason"] = "end"
            if "exit_at_open" in allt:
                allt.loc[late, "exit_at_open"] = False
    allt = allt.reset_index(drop=True)
    costs = cfg.costs

    # price-level cost adjustments (independent of size)
    inst = [INSTRUMENTS[s] for s in allt.symbol]
    hs = np.array([costs.half_spread_plus_slip(x) for x in inst])
    stop_slip = np.array([costs.stop_slip(x) for x in inst])
    d = allt.dir.to_numpy()
    se = _flag(allt, "stop_entry", False)
    entry_extra = np.where(se, stop_slip, 0.0)
    entry_eff = allt.entry_mid.to_numpy() + d * (hs + entry_extra)
    exit_extra = np.where(allt.reason.to_numpy() == "stop", stop_slip, 0.0)
    exit_eff = allt.exit_mid.to_numpy() - d * (hs + exit_extra)
    allt["entry_eff"] = entry_eff
    allt["exit_eff"] = exit_eff
    # price R after spread/slippage only (commission and swap are in R_net)
    allt["R"] = d * (exit_eff - entry_eff) / allt.stop_dist.to_numpy()

    q_entry = np.empty(len(allt))
    q_exit = np.empty(len(allt))
    for quote in set(x.quote for x in inst):
        m = np.array([x.quote == quote for x in inst])
        q_entry[m] = conv.rate(quote, allt.entry_time[m])
        q_exit[m] = conv.rate(quote, allt.exit_time[m])

    # Event order inside one bar timestamp:
    #   0 exits at the open, 1 entries at the open, 2 intrabar exits of older trades,
    #   3 intrabar (stop-entry) fills, 4 intrabar exits of trades opened in that bar.
    ent_open = _flag(allt, "entry_at_open", True)
    ext_open = _flag(allt, "exit_at_open", False)
    same_bar = allt.exit_time.values == allt.entry_time.values
    exit_rank = np.where(ext_open & ~same_bar, 0,
                         np.where(same_bar & ~ent_open, 4, 2))
    entry_rank = np.where(ent_open, 1, 3)
    ev_t = np.concatenate([allt.entry_time.values, allt.exit_time.values])
    ev_rank = np.concatenate([entry_rank, exit_rank])
    ev_is_entry = np.concatenate([np.ones(len(allt), bool), np.zeros(len(allt), bool)])
    ev_id = np.concatenate([np.arange(len(allt)), np.arange(len(allt))])
    order = np.lexsort((ev_id, ev_rank, ev_t))

    balance = cfg.initial_jpy
    peak = balance
    withdrawn = 0.0
    lots = np.zeros(len(allt))
    pnl = np.zeros(len(allt))
    swap_jpy = np.zeros(len(allt))
    comm_jpy = np.zeros(len(allt))
    risk_jpy = np.zeros(len(allt))
    taken = np.zeros(len(allt), bool)
    skip_reason = np.array([""] * len(allt), dtype=object)
    open_ids: set[int] = set()
    margin_open = {}
    per_book = {}
    wd_t, wd_v = [], []
    books = allt.book.to_numpy()

    for j in order:
        tid = ev_id[j]
        if ev_is_entry[j]:
            ins = inst[tid]
            bk = books[tid]
            if balance <= 0:
                skip_reason[tid] = "ruined"; continue
            if len(open_ids) >= cfg.max_open_trades:
                skip_reason[tid] = "max_open"; continue
            if per_book.get(bk, 0) >= cfg.max_trades_per_symbol:
                skip_reason[tid] = "symbol_busy"; continue
            rf = cfg.risk.risk(balance, peak)
            if cfg.book_risk and "|" in bk:
                rf *= cfg.book_risk.get(bk.split("|")[0], 1.0)
            open_risk = sum(risk_jpy[k] for k in open_ids)
            budget = min(balance * rf, balance * cfg.max_open_risk - open_risk)
            if budget <= 0:
                skip_reason[tid] = "risk_cap"; continue
            capped = budget < balance * rf
            per_unit = (allt.stop_dist.iat[tid] + 2 * hs[tid] + entry_extra[tid]) * q_entry[tid]
            units = budget / per_unit
            lt = np.floor(units / ins.contract / ins.lot_step + 1e-9) * ins.lot_step
            notional_per_lot = ins.contract * allt.entry_mid.iat[tid] * q_entry[tid]
            margin_free = balance * cfg.max_margin_usage - sum(margin_open.values())
            lt = min(lt, np.floor(max(margin_free, 0.0) * cfg.leverage / notional_per_lot
                                  / ins.lot_step) * ins.lot_step)
            lt = min(lt, ins.max_lot * 10)  # split into <=10 orders of max_lot
            if lt < ins.min_lot - 1e-12:
                skip_reason[tid] = "risk_cap" if capped else "below_min_lot"; continue
            lots[tid] = lt
            taken[tid] = True
            risk_jpy[tid] = lt * ins.contract * per_unit
            margin_open[tid] = lt * notional_per_lot / cfg.leverage
            open_ids.add(tid)
            per_book[bk] = per_book.get(bk, 0) + 1
        else:
            if not taken[tid]:
                continue
            ins = inst[tid]
            units = lots[tid] * ins.contract
            gross = units * d[tid] * (exit_eff[tid] - entry_eff[tid]) * q_exit[tid]
            cm = lots[tid] * costs.commission_for(ins)
            sw = 0.0
            if costs.use_swap:
                et, xt = allt.entry_time.iat[tid], allt.exit_time.iat[tid]
                nights = swap_nights(et, xt)
                if nights:
                    rate = costs.swap_rate_annual(ins, int(d[tid]), et.year)
                    sw = units * allt.entry_mid.iat[tid] * rate / 365.0 * nights * q_exit[tid]
            pnl[tid] = gross - cm + sw
            swap_jpy[tid] = sw
            comm_jpy[tid] = cm
            balance += pnl[tid]
            open_ids.discard(tid)
            margin_open.pop(tid, None)
            per_book[books[tid]] -= 1
            if cfg.withdrawals is not None:
                w = cfg.withdrawals(balance, peak, allt.exit_time.iat[tid])
                if w > 0:
                    balance -= w
                    withdrawn += w
                    wd_t.append(allt.exit_time.iat[tid])
                    wd_v.append(w)
            peak = max(peak, balance)

    allt["lots"] = lots
    allt["taken"] = taken
    allt["skip_reason"] = skip_reason
    allt["pnl_jpy"] = pnl
    allt["swap_jpy"] = swap_jpy
    allt["commission_jpy"] = comm_jpy
    allt["risk_jpy"] = risk_jpy
    with np.errstate(divide="ignore", invalid="ignore"):
        allt["R_net"] = np.where(taken & (risk_jpy > 0), pnl / risk_jpy, np.nan)
    allt["q_entry"] = q_entry
    allt["q_exit"] = q_exit
    withdrawals = pd.Series(wd_v, index=pd.DatetimeIndex(wd_t), dtype=float)
    equity = _daily_equity(allt[allt.taken], daily_close, conv, cfg, start, end, withdrawals)
    return PortfolioResult(allt, equity, cfg, withdrawn, withdrawals)


def _daily_equity(tk: pd.DataFrame, daily_close: dict[str, pd.Series], conv: ConversionTable,
                  cfg: PortfolioConfig, start, end, withdrawals: pd.Series | None = None
                  ) -> pd.Series:
    """Daily (server-date) mark-to-market equity = realized balance + open P&L."""
    t0 = pd.Timestamp(start) if start is not None else (
        tk.entry_time.min() if len(tk) else pd.Timestamp("2005-01-01"))
    t1 = pd.Timestamp(end) if end is not None else t0 + pd.Timedelta(days=1)
    last_bar = max((s.index[-1] for s in daily_close.values() if len(s)), default=None)
    if last_bar is not None:
        t1 = min(t1, last_bar)
    if len(tk):
        t1 = max(t1, tk.exit_time.max())
    days = pd.bdate_range(t0.normalize(), t1.normalize())
    if end is not None:
        days = days[days < pd.Timestamp(end)]
    realized = np.zeros(len(days))
    unreal = np.zeros(len(days))
    if len(tk) and len(days):
        xi = np.clip(np.searchsorted(days.values, tk.exit_time.dt.normalize().values,
                                     side="left"), 0, len(days) - 1)
        np.add.at(realized, xi, tk.pnl_jpy.to_numpy())
        for sym, g in tk.groupby("symbol"):
            ins = INSTRUMENTS[sym]
            cl = daily_close[sym].reindex(days, method="ffill").to_numpy()
            q = conv.rate(ins.quote, days + pd.Timedelta(hours=23, minutes=59))
            e0 = np.searchsorted(days.values, g.entry_time.dt.normalize().values, side="left")
            # open P&L is marked up to (not including) the day the trade is realized,
            # so a trade closed at/after the last day is never counted twice
            e1 = np.clip(np.searchsorted(days.values, g.exit_time.dt.normalize().values,
                                         side="left"), 0, len(days) - 1)
            for a, b, dr, px, lt in zip(e0, e1, g.dir.to_numpy(), g.entry_eff.to_numpy(),
                                        g.lots.to_numpy()):
                if b > a:
                    unreal[a:b] += lt * ins.contract * dr * (cl[a:b] - px) * q[a:b]
    if withdrawals is not None and len(withdrawals) and len(days):
        wi = np.searchsorted(days.values, withdrawals.index.normalize().values, side="left")
        np.add.at(realized, np.clip(wi, 0, len(days) - 1), -withdrawals.to_numpy())
    eq = cfg.initial_jpy + np.cumsum(realized) + unreal
    return pd.Series(eq, index=days, name="equity")


@dataclass
class PortfolioResult:
    trades: pd.DataFrame
    equity: pd.Series
    cfg: PortfolioConfig
    withdrawn: float = 0.0
    withdrawals: pd.Series | None = None

    @staticmethod
    def empty(cfg, start, end):
        t0 = pd.Timestamp(start or "2005-01-01")
        t1 = pd.Timestamp(end or "2005-01-02")
        days = pd.bdate_range(t0, t1)
        return PortfolioResult(pd.DataFrame(), pd.Series(cfg.initial_jpy, index=days), cfg)

    @property
    def taken(self) -> pd.DataFrame:
        return self.trades[self.trades.taken] if len(self.trades) else self.trades
