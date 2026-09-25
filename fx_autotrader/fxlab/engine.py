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
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import numba as nb
import numpy as np
import pandas as pd

from .instruments import INSTRUMENTS, CostModel, Instrument, quote_to_jpy_symbol

TF_DURATION = {"H1": pd.Timedelta(hours=1), "H4": pd.Timedelta(hours=4),
               "D1": pd.Timedelta(days=1)}

EXIT_STOP, EXIT_TP, EXIT_SIGNAL, EXIT_TIME, EXIT_REVERSE, EXIT_END = range(6)
EXIT_NAMES = ["stop", "tp", "signal", "time", "reverse", "end"]

DECISION_COLUMNS = ["long_entry", "short_entry", "exit_long", "exit_short", "stop_dist",
                    "trail_dist", "tp_dist", "long_stop_px", "short_stop_px", "max_hold"]


# --------------------------------------------------------------------------- kernel
@nb.njit(cache=True)
def _kernel(o, h, l, c, dec_idx, d_long, d_short, d_xl, d_xs, d_stop, d_trail, d_tp,
            d_lpx, d_spx, d_maxhold):
    n = o.shape[0]
    ent_i = np.empty(n, np.int64)
    ext_i = np.empty(n, np.int64)
    dirs = np.empty(n, np.int64)
    ent_px = np.empty(n, np.float64)
    ext_px = np.empty(n, np.float64)
    stop0 = np.empty(n, np.float64)
    reason = np.empty(n, np.int64)
    nt = 0

    pos = 0
    e_i = 0
    e_px = 0.0
    stop = np.nan
    tp = np.nan
    trail = 0.0
    hold = 0
    maxhold = 0
    s0 = 0.0
    hh = -np.inf
    ll = np.inf
    # pending stop-entry orders (valid until the next decision)
    p_long = np.nan
    p_short = np.nan
    p_stop = 0.0
    p_trail = 0.0
    p_tp = 0.0
    p_maxhold = 0

    for i in range(n):
        r = 0
        px = 0.0
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
                ext_px[nt] = o[i]; stop0[nt] = s0; reason[nt] = r; nt += 1
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
                # a trailing stop moved above the open closes the trade at the open
                elif pos == 1 and o[i] <= stop:
                    do_exit = True
                    r = EXIT_STOP
                elif pos == -1 and o[i] >= stop:
                    do_exit = True
                    r = EXIT_STOP
                if do_exit:
                    ent_i[nt] = e_i; ext_i[nt] = i; dirs[nt] = pos; ent_px[nt] = e_px
                    ext_px[nt] = o[i]; stop0[nt] = s0; reason[nt] = r; nt += 1
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
                    e_i = i; e_px = o[i]; s0 = sd
                    stop = e_px - pos * sd
                    tpd = d_tp[k]
                    tp = e_px + pos * tpd if (tpd == tpd and tpd > 0.0) else np.nan
                    hold = 0; maxhold = d_maxhold[k]
                    hh = o[i]; ll = o[i]
                else:
                    # stop-entry orders
                    if go_long and d_lpx[k] == d_lpx[k]:
                        p_long = d_lpx[k]
                    if go_short and d_spx[k] == d_spx[k]:
                        p_short = d_spx[k]
                    if p_long == p_long or p_short == p_short:
                        p_stop = sd
                        tdd = d_trail[k]
                        p_trail = tdd if tdd == tdd else 0.0
                        tpd = d_tp[k]
                        p_tp = tpd if tpd == tpd else 0.0
                        p_maxhold = d_maxhold[k]

        # ---- 3) pending stop-entry orders
        if pos == 0 and (p_long == p_long or p_short == p_short):
            trig_l = p_long == p_long and h[i] >= p_long
            trig_s = p_short == p_short and l[i] <= p_short
            if trig_l and trig_s:
                # both levels inside one bar: take the one closer to the open
                if abs(p_long - o[i]) <= abs(o[i] - p_short):
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
                e_i = i; s0 = p_stop
                stop = e_px - pos * p_stop
                tp = e_px + pos * p_tp if p_tp > 0.0 else np.nan
                hold = 0; maxhold = p_maxhold
                hh = e_px; ll = e_px
                p_long = np.nan
                p_short = np.nan

        # ---- 4) intrabar stop / take-profit (stop first when both are touched)
        if pos != 0:
            hit = False
            if pos == 1:
                if l[i] <= stop:
                    hit = True; r = EXIT_STOP; px = stop
                elif tp == tp and h[i] >= tp:
                    hit = True; r = EXIT_TP; px = tp
            else:
                if h[i] >= stop:
                    hit = True; r = EXIT_STOP; px = stop
                elif tp == tp and l[i] <= tp:
                    hit = True; r = EXIT_TP; px = tp
            if hit:
                ent_i[nt] = e_i; ext_i[nt] = i; dirs[nt] = pos; ent_px[nt] = e_px
                ext_px[nt] = px; stop0[nt] = s0; reason[nt] = r; nt += 1
                pos = 0
            else:
                if h[i] > hh:
                    hh = h[i]
                if l[i] < ll:
                    ll = l[i]

    if pos != 0:
        ent_i[nt] = e_i; ext_i[nt] = n - 1; dirs[nt] = pos; ent_px[nt] = e_px
        ext_px[nt] = c[n - 1]; stop0[nt] = s0; reason[nt] = EXIT_END; nt += 1

    return (ent_i[:nt], ext_i[:nt], dirs[:nt], ent_px[:nt], ext_px[:nt], stop0[:nt],
            reason[:nt])


# --------------------------------------------------------------------- per symbol
def map_decisions(signal_index: pd.DatetimeIndex, tf: str,
                  exec_index: pd.DatetimeIndex) -> np.ndarray:
    """dec_idx[i] = k  when signal bar k has closed by the open of execution bar i."""
    closes = (signal_index + TF_DURATION[tf]).values
    pos = np.searchsorted(exec_index.values, closes, side="left")
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


def simulate_symbol(decisions: pd.DataFrame, tf: str, exec_bars: pd.DataFrame) -> pd.DataFrame:
    """Run the kernel for one symbol; returns trades in price terms."""
    dec = map_decisions(decisions.index, tf, exec_bars.index)
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
    )
    ei, xi, d, epx, xpx, s0, r = _kernel(*args)
    idx = exec_bars.index
    return pd.DataFrame({
        "entry_time": idx[ei], "exit_time": idx[xi], "entry_i": ei, "exit_i": xi,
        "dir": d, "entry_mid": epx, "exit_mid": xpx, "stop_dist": s0,
        "reason": [EXIT_NAMES[x] for x in r],
    })


# ---------------------------------------------------------------------- portfolio
@dataclass
class RiskSchedule:
    """Fraction of balance risked per trade, possibly depending on account state.

    ``stages`` is a list of (balance_threshold_jpy, risk_fraction) sorted by
    threshold; the last threshold <= balance applies.  ``dd_throttle`` is a list of
    (drawdown_from_peak, multiplier) - when the balance is below its peak by at
    least the drawdown, risk is multiplied (e.g. halved).
    """
    base_risk: float = 0.01
    stages: list[tuple[float, float]] = field(default_factory=list)
    dd_throttle: list[tuple[float, float]] = field(default_factory=list)

    def risk(self, balance: float, peak: float) -> float:
        r = self.base_risk
        for thr, rf in self.stages:
            if balance >= thr:
                r = rf
        dd = 1.0 - balance / peak if peak > 0 else 0.0
        mult = 1.0
        for d, m in self.dd_throttle:
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


def run_portfolio(trades: dict[str, pd.DataFrame], conv: ConversionTable,
                  daily_close: dict[str, pd.Series], cfg: PortfolioConfig,
                  start=None, end=None) -> "PortfolioResult":
    """Replay per-symbol trades against one JPY account."""
    rows = []
    for sym, t in trades.items():
        if t is None or len(t) == 0:
            continue
        t = t.copy()
        t["symbol"] = sym
        rows.append(t)
    if not rows:
        return PortfolioResult.empty(cfg, start, end)
    allt = pd.concat(rows, ignore_index=True)
    if start is not None:
        allt = allt[allt.entry_time >= pd.Timestamp(start)]
    if end is not None:
        allt = allt[allt.entry_time < pd.Timestamp(end)]
    allt = allt.reset_index(drop=True)
    costs = cfg.costs

    # price-level cost adjustments (independent of size)
    inst = [INSTRUMENTS[s] for s in allt.symbol]
    hs = np.array([costs.half_spread_plus_slip(x) for x in inst])
    stop_slip = np.array([costs.stop_extra_slip_pips * x.pip * costs.multiplier for x in inst])
    d = allt.dir.to_numpy()
    entry_eff = allt.entry_mid.to_numpy() + d * hs
    extra = np.where(allt.reason.to_numpy() == "stop", stop_slip, 0.0)
    exit_eff = allt.exit_mid.to_numpy() - d * (hs + extra)
    allt["entry_eff"] = entry_eff
    allt["exit_eff"] = exit_eff
    allt["R"] = d * (exit_eff - entry_eff) / allt.stop_dist.to_numpy()

    q_entry = np.empty(len(allt))
    q_exit = np.empty(len(allt))
    for quote in set(x.quote for x in inst):
        m = np.array([x.quote == quote for x in inst])
        q_entry[m] = conv.rate(quote, allt.entry_time[m])
        q_exit[m] = conv.rate(quote, allt.exit_time[m])

    # events at identical timestamps: exits of older trades, then entries, then exits of
    # trades opened in that same bar (entry must always precede its own exit)
    same_bar = (allt.exit_time.values == allt.entry_time.values)
    ev_t = np.concatenate([allt.entry_time.values, allt.exit_time.values])
    ev_kind = np.concatenate([np.ones(len(allt), int), np.where(same_bar, 2, 0)])
    ev_id = np.concatenate([np.arange(len(allt)), np.arange(len(allt))])
    order = np.lexsort((ev_id, ev_kind, ev_t))

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
    per_symbol = {}
    wd_t, wd_v = [], []

    for j in order:
        tid = ev_id[j]
        if ev_kind[j] == 1:  # entry
            sym = allt.symbol.iat[tid]
            ins = inst[tid]
            if len(open_ids) >= cfg.max_open_trades:
                skip_reason[tid] = "max_open"; continue
            if per_symbol.get(sym, 0) >= cfg.max_trades_per_symbol:
                skip_reason[tid] = "symbol_busy"; continue
            rf = cfg.risk.risk(balance, peak)
            open_risk = sum(risk_jpy[k] for k in open_ids)
            budget = min(balance * rf, balance * cfg.max_open_risk - open_risk)
            if budget <= 0:
                skip_reason[tid] = "risk_cap"; continue
            per_unit = (allt.stop_dist.iat[tid] + 2 * hs[tid]) * q_entry[tid]
            units = budget / per_unit
            lt = np.floor(units / ins.contract / ins.lot_step + 1e-9) * ins.lot_step
            # margin
            notional_per_lot = ins.contract * allt.entry_mid.iat[tid] * q_entry[tid]
            margin_free = balance * cfg.max_margin_usage - sum(margin_open.values())
            lt = min(lt, np.floor(margin_free * cfg.leverage / notional_per_lot / ins.lot_step)
                     * ins.lot_step)
            lt = min(lt, ins.max_lot * 10)  # split into <=10 orders of max_lot
            if lt < ins.min_lot - 1e-12:
                skip_reason[tid] = "below_min_lot"; continue
            lots[tid] = lt
            taken[tid] = True
            risk_jpy[tid] = lt * ins.contract * per_unit
            margin_open[tid] = lt * notional_per_lot / cfg.leverage
            open_ids.add(tid)
            per_symbol[sym] = per_symbol.get(sym, 0) + 1
        else:  # exit
            if not taken[tid]:
                continue
            ins = inst[tid]
            units = lots[tid] * ins.contract
            gross = units * d[tid] * (exit_eff[tid] - entry_eff[tid]) * q_exit[tid]
            cm = lots[tid] * costs.commission_jpy_per_lot_rt * costs.multiplier \
                if ins.commission else 0.0
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
            per_symbol[allt.symbol.iat[tid]] -= 1
            if cfg.withdrawals is not None:
                w = cfg.withdrawals(balance, peak, allt.exit_time.iat[tid])
                if w > 0:
                    balance -= w
                    withdrawn += w
                    wd_t.append(allt.exit_time.iat[tid])
                    wd_v.append(w)
            peak = max(peak, balance)
            if balance <= 0:
                break

    allt["lots"] = lots
    allt["taken"] = taken
    allt["skip_reason"] = skip_reason
    allt["pnl_jpy"] = pnl
    allt["swap_jpy"] = swap_jpy
    allt["commission_jpy"] = comm_jpy
    allt["risk_jpy"] = risk_jpy
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
    if len(tk):
        t1 = max(t1, tk.exit_time.max())
    days = pd.bdate_range(t0.normalize(), t1.normalize())
    realized = np.zeros(len(days))
    unreal = np.zeros(len(days))
    if len(tk):
        xi = np.searchsorted(days.values, tk.exit_time.dt.normalize().values, side="left")
        np.add.at(realized, np.clip(xi, 0, len(days) - 1), tk.pnl_jpy.to_numpy())
        for sym, g in tk.groupby("symbol"):
            ins = INSTRUMENTS[sym]
            cl = daily_close[sym].reindex(days, method="ffill").to_numpy()
            q = conv.rate(ins.quote, days + pd.Timedelta(hours=23, minutes=59))
            e0 = np.searchsorted(days.values, g.entry_time.dt.normalize().values, side="left")
            e1 = np.searchsorted(days.values, g.exit_time.dt.normalize().values, side="left")
            for a, b, dr, px, lt in zip(e0, e1, g.dir.to_numpy(), g.entry_eff.to_numpy(),
                                        g.lots.to_numpy()):
                if b > a:
                    unreal[a:b] += lt * ins.contract * dr * (cl[a:b] - px) * q[a:b]
    if withdrawals is not None and len(withdrawals):
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
