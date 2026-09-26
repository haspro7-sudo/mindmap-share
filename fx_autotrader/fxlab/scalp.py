"""M1 scalping simulator: fixed take-profit / stop-loss / time-stop trades on bid/ask.

OANDA M1 bars are mid prices.  Each bar gets a half spread from the Titan FX Zero Blade
table (fxlab.instruments) times an hour-of-day multiplier (rollover and the Asian session
are wider), so every order is simulated on the side it would really fill on:

  long   entry = ask(open) + slip          TP/SL are set relative to the fill, on the bid
  short  entry = bid(open) - slip          TP/SL are set relative to the fill, on the ask

  * the decision is made on the close of the signal bar; entry is the next bar's open
    (skipped when that bar opens more than `max_entry_delay_min` after the signal bar's
    open, e.g. after a weekend)
  * stop-loss beats take-profit when both are inside the same bar (conservative)
  * a bar that opens beyond a level fills at that open (gap); at a bar open the broker-side
    SL/TP are checked before the time stop (they trigger on the first tick)
  * take-profit (limit) fills pay no slippage; market exits (time stop) pay `slip_pips`;
    a triggered stop-loss is a market order and pays `slip_pips` + the additional
    `stop_slip_pips` (same convention as fxlab.engine / fxlab.instruments)
  * time stop: market exit at the open of the first bar at or after entry + hold
    (hold NaN, inf or <= 0 = no time stop, like max_hold=0 in fxlab.engine)
  * commission: Blade JPY account 720 JPY per lot round turn, converted to pips
  * one position at a time per symbol; signals while a trade is open are ignored, and of
    several signals on the same bar the first row (input order) is used

Crypto (BTCUSD, Bitstamp M1 data) uses proportional costs: spread, slippage and commission
in basis points of price, plus financing per server-day rollover held (Instrument fields
cost_in_bps / carry_bps_per_day); the FX hour-of-day spread multipliers are not applied.

Everything is in pips (1 pip = 1 USD for BTCUSD); R = net pips / stop pips.  `cost_mult` scales spread, slippage
and commission together (use 2.0 for the cost stress test).

Data caveat: only the raw OANDA pairs (fxlab.data.RAW_PAIRS: EURUSD, GBPUSD, AUDUSD, USDCAD,
EURJPY, AUDJPY) have true M1 highs/lows.  Synthetic crosses (USDJPY, GBPJPY, EURGBP, ...)
combine the extremes of two legs, so their M1 ranges are inflated and random TP/SL entries
lose ~0.25-0.55 pips/trade more than the cost model on them; judge scalps on raw pairs.

    m1 = load("EURUSD")
    sig = pd.DataFrame({"dir": ..., "tp": ..., "sl": ..., "hold": ...}, index=signal_bar_times)
    tr = simulate(m1, sig, "EURUSD")
    print(stats(tr)); print(by_period(tr))
"""
from __future__ import annotations

import math

import numba as nb
import numpy as np
import pandas as pd

from . import data as D
from .instruments import INSTRUMENTS

IS_END = pd.Timestamp("2015-01-01")          # in-sample 2005-2014, out-of-sample 2015-2020-05

# Spread multiplier by server hour (server = New York + 7h, so 00:00 is the NY 17:00 rollover)
SPREAD_MULT_BY_SERVER_HOUR = np.ones(24)
SPREAD_MULT_BY_SERVER_HOUR[0] = 5.0          # rollover: Blade spreads jump for ~1 hour
SPREAD_MULT_BY_SERVER_HOUR[23] = 2.0         # last hour before rollover, thin book
SPREAD_MULT_BY_SERVER_HOUR[1:3] = 1.5        # early Asia
SPREAD_MULT_BY_SERVER_HOUR[3:9] = 1.2        # Tokyo session

# Rough JPY value of one unit of each quote currency (for the commission in pips)
_JPY_PER = {"JPY": 1.0, "USD": 110.0, "EUR": 125.0, "GBP": 145.0, "AUD": 80.0, "CAD": 85.0}
COMMISSION_JPY_RT = 720.0


def commission_pips(symbol: str) -> float:
    """Fixed per-trade commission in pips (FX/CFD).  Crypto commission is proportional to
    price and is applied inside simulate()."""
    inst = INSTRUMENTS[symbol]
    if inst.cost_in_bps:
        return 0.0
    jpy = inst.commission_jpy_rt if inst.commission_jpy_rt is not None else COMMISSION_JPY_RT
    return jpy / (inst.pip * inst.contract * _JPY_PER[inst.quote])


def load(symbol: str, start=None, end=None) -> pd.DataFrame:
    """OANDA M1 mid bars on the server-time clock (naive index, NY+7h)."""
    m1 = D.load_m1(symbol)
    df = m1.set_axis(D.to_server_time(m1.index))
    df = df[~df.index.duplicated(keep="first")]
    if start is not None:
        df = df[df.index >= pd.Timestamp(start)]
    if end is not None:
        df = df[df.index < pd.Timestamp(end)]
    return df


def local_time(server_index: pd.DatetimeIndex, tz: str = "Asia/Tokyo") -> pd.DatetimeIndex:
    """Convert a naive server-time index to naive local time in `tz` (JST by default)."""
    ny = (server_index - D.SERVER_OFFSET).tz_localize(
        "America/New_York", ambiguous="NaT", nonexistent="shift_forward")
    return ny.tz_convert(tz).tz_localize(None)


@nb.njit(cache=True)
def _kernel(t, o, h, l, hs, sig_bar, sig_dir, tp, sl, hold_ns, slip, stop_slip, max_delay_ns):
    # prices are mid; per bar: hs = half spread, slip = market-order slippage, stop_slip =
    # total slippage of a stop-loss fill (price units)
    n = o.shape[0]
    m = sig_bar.shape[0]
    e_i = np.full(m, -1)
    x_i = np.full(m, -1)
    e_px = np.zeros(m)
    x_px = np.zeros(m)
    reason = np.zeros(m, np.int8)            # 1 TP, 2 SL, 3 time, 4 end of data
    busy = -1
    k = 0
    for s in range(m):
        b = sig_bar[s]
        i = b + 1
        if i >= n or i <= busy:
            continue
        if t[i] - t[b] > max_delay_ns:
            continue
        d = sig_dir[s]
        if d == 0:
            continue
        if d > 0:
            ent = o[i] + hs[i] + slip[i]
            tpx = ent + tp[s]
            slx = ent - sl[s]
        else:
            ent = o[i] - hs[i] - slip[i]
            tpx = ent - tp[s]
            slx = ent + sl[s]
        t_end = t[i] + hold_ns[s]
        j = i
        done = False
        while j < n:
            # exit side quotes: long exits on the bid, short exits on the ask
            if d > 0:
                qo, qh, ql = o[j] - hs[j], h[j] - hs[j], l[j] - hs[j]
            else:
                qo, qh, ql = o[j] + hs[j], h[j] + hs[j], l[j] + hs[j]
            if j > i:
                # at the open: broker-side SL/TP fire on the first tick, before the time stop
                if (d > 0 and qo <= slx) or (d < 0 and qo >= slx):
                    x_px[k], reason[k] = (qo - stop_slip[j] if d > 0 else qo + stop_slip[j]), 2
                    done = True
                elif (d > 0 and qo >= tpx) or (d < 0 and qo <= tpx):
                    x_px[k], reason[k] = qo, 1
                    done = True
                elif t[j] >= t_end:
                    px = qo - slip[j] if d > 0 else qo + slip[j]
                    x_px[k], reason[k] = px, 3
                    done = True
            if not done:
                if (d > 0 and ql <= slx) or (d < 0 and qh >= slx):
                    x_px[k], reason[k] = (slx - stop_slip[j] if d > 0 else slx + stop_slip[j]), 2
                    done = True
                elif (d > 0 and qh >= tpx) or (d < 0 and ql <= tpx):
                    x_px[k], reason[k] = tpx, 1
                    done = True
            if done:
                break
            j += 1
        if not done:
            j = n - 1
            x_px[k] = (l[j] + h[j]) * 0.5 - d * hs[j]
            reason[k] = 4
        e_i[k], x_i[k], e_px[k] = i, j, ent
        sig_dir[k] = d                       # compact in place (s >= k always)
        tp[k], sl[k] = tp[s], sl[s]
        busy = j
        k += 1
    return e_i[:k], x_i[:k], e_px[:k], x_px[:k], reason[:k], sig_dir[:k], tp[:k], sl[:k]


def _bps_price(inst, prices) -> np.ndarray:
    if prices is None:
        raise ValueError(f"{inst.symbol} has proportional (bps) costs: pass prices")
    return np.asarray(prices, float) * 1e-4


def half_spread_series(index: pd.DatetimeIndex, symbol: str, cost_mult: float = 1.0,
                       prices=None) -> np.ndarray:
    """Half spread per bar in price units.  Crypto (cost_in_bps) instruments need the bar
    prices (e.g. m1['open']) because their spread is a fraction of price."""
    inst = INSTRUMENTS[symbol]
    mult = SPREAD_MULT_BY_SERVER_HOUR[index.hour.to_numpy()] if inst.hour_spread_mult \
        else np.ones(len(index))
    unit = _bps_price(inst, prices) if inst.cost_in_bps else inst.pip
    return 0.5 * inst.spread_pips * unit * mult * cost_mult


def simulate(m1: pd.DataFrame, signals: pd.DataFrame, symbol: str, cost_mult: float = 1.0,
             max_entry_delay_min: float = 5.0) -> pd.DataFrame:
    """signals: index = signal bar open time (must exist in m1.index; decision on its close),
    columns dir (+1/-1; only the sign is used, NaN/0 = no trade), tp (pips; NaN/<=0 = none),
    sl (pips, > 0), hold (minutes; NaN/inf/<=0 = no time stop)."""
    inst = INSTRUMENTS[symbol]
    pip = inst.pip
    dirs = np.sign(signals["dir"].astype(float).fillna(0.0).to_numpy())
    sig = signals.assign(dir=dirs)[dirs != 0].sort_index(kind="stable")
    pos = m1.index.get_indexer(sig.index)
    if (pos < 0).any():
        raise ValueError(f"{(pos < 0).sum()} signal times are not bars of m1")
    t = m1.index.as_unit("ns").asi8.astype(np.int64)      # pandas may store us resolution
    o = m1["open"].to_numpy(float)
    hs = half_spread_series(m1.index, symbol, cost_mult, prices=o)
    tp = sig["tp"].to_numpy(float) * pip
    tp = np.where(np.isfinite(tp) & (tp > 0), tp, 1e9)
    sl = sig["sl"].to_numpy(float) * pip
    if not (np.isfinite(sl) & (sl > 0)).all():
        raise ValueError("every signal needs a positive stop-loss")
    hold_min = sig["hold"].to_numpy(float)
    has_hold = np.isfinite(hold_min) & (hold_min > 0)
    no_hold = 2.0 ** 62                                    # ns (~146 years) = no time stop
    hold = np.minimum(np.where(has_hold, hold_min * 60e9, no_hold), no_hold).astype(np.int64)
    unit = _bps_price(inst, o) if inst.cost_in_bps else np.full(len(o), pip)
    slip = inst.slip_pips * unit * cost_mult
    stop_slip = slip + inst.stop_slip_pips * unit * cost_mult  # stop = market order + extra
    e_i, x_i, e_px, x_px, reason, d, tp_, sl_ = _kernel(
        t, o, m1["high"].to_numpy(float), m1["low"].to_numpy(float),
        hs, pos.astype(np.int64), sig["dir"].to_numpy(np.int64).copy(), tp.copy(), sl.copy(),
        hold, slip, stop_slip, int(max_entry_delay_min * 60e9))
    gross = d * (x_px - e_px) / pip
    if inst.cost_in_bps:
        # commission on notional, and financing per server-day rollover crossed
        nights = (m1.index[x_i].normalize() - m1.index[e_i].normalize()).days.to_numpy()
        comm = (inst.commission_bps_rt + inst.carry_bps_per_day * nights) * 1e-4 * e_px / pip
        comm = comm * cost_mult
    else:
        comm = commission_pips(symbol) * cost_mult
    net = gross - comm
    out = pd.DataFrame({
        "symbol": symbol,
        "entry_time": m1.index[e_i], "exit_time": m1.index[x_i], "dir": d,
        "entry_px": e_px, "exit_px": x_px,
        "tp_pips": tp_ / pip, "sl_pips": sl_ / pip,
        "gross_pips": gross, "net_pips": net,
        "R": net / (sl_ / pip),
        "reason": pd.Categorical.from_codes(reason - 1, ["tp", "sl", "time", "end"]),
    })
    out["minutes"] = (out.exit_time - out.entry_time).dt.total_seconds() / 60.0
    return out


def stats(tr: pd.DataFrame) -> dict:
    n = len(tr)
    if n == 0:
        return {"n": 0}
    net = tr["net_pips"].to_numpy()
    sd = net.std(ddof=1) if n > 1 else float("nan")
    wins, losses = net[net > 0].sum(), -net[net < 0].sum()
    years = max((tr.entry_time.max() - tr.entry_time.min()).days / 365.25, 1e-9)
    return {
        "n": n,
        "trades_per_year": n / years,
        "win_rate": float((net > 0).mean()),
        "avg_net_pips": float(net.mean()),
        "avg_gross_pips": float(tr["gross_pips"].mean()),
        "avg_R": float(tr["R"].mean()),
        "profit_factor": float(wins / losses) if losses > 0 else float("inf"),
        "t_stat": float(net.mean() / sd * math.sqrt(n)) if sd and sd > 0 else float("nan"),
        "total_net_pips": float(net.sum()),
        "avg_minutes": float(tr["minutes"].mean()),
    }


def by_period(tr: pd.DataFrame) -> pd.DataFrame:
    ins = tr[tr.entry_time < IS_END]
    oos = tr[tr.entry_time >= IS_END]
    return pd.DataFrame({"is_2005_2014": stats(ins), "oos_2015_2020": stats(oos),
                         "all": stats(tr)}).T


def by_year(tr: pd.DataFrame) -> pd.DataFrame:
    g = tr.groupby(tr.entry_time.dt.year)
    return pd.DataFrame({"n": g.size(), "win_rate": g.net_pips.apply(lambda x: (x > 0).mean()),
                         "avg_net_pips": g.net_pips.mean(), "total_net_pips": g.net_pips.sum()})


def random_signals(m1: pd.DataFrame, n: int, tp: float, sl: float, hold: float,
                   server_hours=range(9, 22), seed: int = 0) -> pd.DataFrame:
    """Random-time, random-direction entries: the no-edge baseline for any TP/SL shape."""
    rng = np.random.default_rng(seed)
    ok = np.flatnonzero(np.isin(m1.index.hour, list(server_hours)))
    pick = np.sort(rng.choice(ok[:-1], size=min(n, len(ok) - 1), replace=False))
    return pd.DataFrame({"dir": rng.choice([-1, 1], size=len(pick)), "tp": tp, "sl": sl,
                         "hold": hold}, index=m1.index[pick])


def resample(m1: pd.DataFrame, rule: str) -> pd.DataFrame:
    """Higher-timeframe OHLC bars (e.g. '15min', '1h', '4h', '1D') from server-time M1 bars,
    labelled by bar open time.  Column `last_m1` is the time of the bar's last M1 bar: use
    it as the signal index for scalp.simulate so a decision on the bar's close is filled
    at the next M1 open (no look-ahead)."""
    g = m1.groupby(pd.Grouper(freq=rule, label="left", closed="left"))
    out = pd.DataFrame({"open": g["open"].first(), "high": g["high"].max(),
                        "low": g["low"].min(), "close": g["close"].last()})
    if "volume" in m1:
        out["volume"] = g["volume"].sum()
    last = pd.Series(m1.index, index=m1.index).groupby(pd.Grouper(freq=rule, label="left",
                                                                     closed="left")).last()
    out["last_m1"] = last
    return out.dropna(subset=["open"])


def signals_at_close(bars: pd.DataFrame, frame: pd.DataFrame) -> pd.DataFrame:
    """Re-index a signal frame keyed by higher-timeframe bar open time (dir/tp/sl/hold
    columns) onto the bars' last M1 bar, ready for simulate()."""
    idx = bars.loc[frame.index, "last_m1"]
    return frame.set_axis(pd.DatetimeIndex(idx.to_numpy()))
