import numpy as np
import pandas as pd

from fxlab import scalp


def _bars(rows, start="2016-03-01 10:00"):
    idx = pd.date_range(start, periods=len(rows), freq="1min")
    return pd.DataFrame(rows, columns=["open", "high", "low", "close"], index=idx)


def _sig(m1, i, d, tp, sl, hold=60):
    return pd.DataFrame({"dir": [d], "tp": [tp], "sl": [sl], "hold": [hold]}, index=[m1.index[i]])


PIP = 0.0001
HS = 0.5 * 0.3 * PIP             # EURUSD half spread at 10:00 server
SLIP = 0.2 * PIP                 # market-order slippage
SSLIP = 0.3 * PIP                # additional slippage of a stop-loss fill


def test_long_take_profit_on_bid():
    m1 = _bars([[1.1, 1.1, 1.1, 1.1], [1.1, 1.1, 1.1, 1.1], [1.1, 1.1010, 1.1, 1.1]])
    tr = scalp.simulate(m1, _sig(m1, 0, 1, 5, 5), "EURUSD")
    assert len(tr) == 1 and tr.reason[0] == "tp"
    assert abs(tr.entry_px[0] - (1.1 + HS + SLIP)) < 1e-12
    assert abs(tr.gross_pips[0] - 5.0) < 1e-9
    assert abs(tr.net_pips[0] - (5.0 - scalp.commission_pips("EURUSD"))) < 1e-9


def test_stop_wins_when_both_levels_in_one_bar():
    m1 = _bars([[1.1] * 4, [1.1] * 4, [1.1, 1.1020, 1.0980, 1.1]])
    tr = scalp.simulate(m1, _sig(m1, 0, 1, 5, 5), "EURUSD")
    assert tr.reason[0] == "sl"
    assert abs(tr.gross_pips[0] - (-5.0 - 0.2 - 0.3)) < 1e-9  # market slip + stop slip


def test_short_mirror_and_time_stop():
    rows = [[1.1] * 4] * 5
    m1 = _bars(rows)
    tr = scalp.simulate(m1, _sig(m1, 0, -1, 50, 50, hold=2), "EURUSD")
    assert tr.reason[0] == "time" and tr.minutes[0] == 2.0
    # entry on the bid minus slip, exit on the ask plus slip: pays full spread + 2 slips
    assert abs(tr.gross_pips[0] - (-(0.3 + 2 * 0.2))) < 1e-9


def test_gap_through_stop_fills_at_open_and_no_overlap():
    m1 = _bars([[1.1] * 4, [1.1] * 4, [1.1] * 4, [1.0950, 1.0950, 1.0950, 1.0950], [1.1] * 4])
    sig = pd.DataFrame({"dir": [1, 1], "tp": [5, 5], "sl": [5, 5], "hold": [60, 60]},
                       index=m1.index[[0, 1]])
    tr = scalp.simulate(m1, sig, "EURUSD")
    assert len(tr) == 1                                    # second signal ignored while open
    assert tr.reason[0] == "sl" and tr.gross_pips[0] < -5.3


def test_random_entries_lose_about_the_cost():
    rng = np.random.default_rng(3)
    n = 20000
    px = 1.1 + np.cumsum(rng.normal(0, 0.00005, n))
    hi = px + np.abs(rng.normal(0, 0.00003, n))
    lo = px - np.abs(rng.normal(0, 0.00003, n))
    m1 = pd.DataFrame({"open": px, "high": np.maximum(hi, px), "low": np.minimum(lo, px),
                       "close": px}, index=pd.date_range("2016-03-01 09:00", periods=n, freq="1min"))
    sig = scalp.random_signals(m1, 2000, tp=5, sl=5, hold=30, server_hours=range(24), seed=1)
    tr = scalp.simulate(m1, sig, "EURUSD")
    st = scalp.stats(tr)
    assert st["avg_net_pips"] < 0


# ---------------------------------------------------------------- audit regressions
def test_stop_loss_pays_market_slip_plus_stop_slip_like_the_engine():
    # a triggered stop is a market order: slip_pips + the *additional* stop_slip_pips
    # (fxlab.instruments / fxlab.engine convention), on both sides and for gaps
    m1 = _bars([[1.1] * 4, [1.1] * 4, [1.1, 1.1060, 1.1, 1.1]])
    tr = scalp.simulate(m1, _sig(m1, 0, -1, 50, 5), "EURUSD")
    assert tr.reason[0] == "sl"
    assert abs(tr.exit_px[0] - (tr.entry_px[0] + 5 * PIP + SLIP + SSLIP)) < 1e-12
    assert abs(tr.gross_pips[0] - (-5.5)) < 1e-9
    m1 = _bars([[1.1] * 4, [1.1] * 4, [1.1] * 4, [1.0950] * 4, [1.1] * 4])
    tr = scalp.simulate(m1, _sig(m1, 0, 1, 5, 5), "EURUSD")
    assert tr.reason[0] == "sl"
    assert abs(tr.exit_px[0] - (1.0950 - HS - SLIP - SSLIP)) < 1e-12


def test_gap_through_stop_on_the_time_stop_bar_is_a_stop():
    # the broker-side stop fires on the first tick of the bar, before the EA's time exit
    m1 = _bars([[1.1] * 4, [1.1] * 4, [1.1] * 4, [1.0990] * 4, [1.0990] * 4])
    tr = scalp.simulate(m1, _sig(m1, 0, 1, 50, 5, hold=2), "EURUSD")
    assert tr.exit_time[0] == m1.index[3] and tr.reason[0] == "sl"
    assert abs(tr.exit_px[0] - (1.0990 - HS - SLIP - SSLIP)) < 1e-12
    # without the gap the same bar is a plain time exit
    m1 = _bars([[1.1] * 4] * 5)
    tr = scalp.simulate(m1, _sig(m1, 0, 1, 50, 5, hold=2), "EURUSD")
    assert tr.exit_time[0] == m1.index[3] and tr.reason[0] == "time"


def test_missing_or_infinite_hold_means_no_time_stop():
    m1 = _bars([[1.1] * 4] * 10)
    for hold in [np.nan, np.inf, 0.0]:
        tr = scalp.simulate(m1, _sig(m1, 0, 1, 50, 50, hold=hold), "EURUSD")
        assert len(tr) == 1 and tr.reason[0] == "end", hold
        assert tr.exit_time[0] == m1.index[-1]


def test_dir_uses_the_sign_and_nan_means_no_trade():
    m1 = _bars([[1.1] * 4, [1.1] * 4, [1.1, 1.1010, 1.1, 1.1], [1.1] * 4, [1.1] * 4,
                [1.1, 1.1, 1.0990, 1.1], [1.1] * 4])
    sig = pd.DataFrame({"dir": [np.nan, 2.0, -3.0], "tp": 5.0, "sl": 5.0, "hold": 60.0},
                       index=m1.index[[0, 1, 4]])
    tr = scalp.simulate(m1, sig, "EURUSD")
    assert list(tr["dir"]) == [1, -1]
    assert np.allclose(tr.gross_pips, [5.0, 5.0])


def test_first_row_wins_among_signals_on_the_same_bar():
    # long and short frames concatenated: input order must decide, not an unstable sort
    n = 400
    m1 = _bars([[1.1] * 4] * n)
    bars = np.arange(0, n - 2, 10)
    longs = pd.DataFrame({"dir": 1, "tp": 50.0, "sl": 50.0, "hold": 1.0}, index=m1.index[bars])
    shorts = longs.assign(dir=-1)
    tr = scalp.simulate(m1, pd.concat([longs, shorts]), "EURUSD")
    assert len(tr) == len(bars) and (tr["dir"] == 1).all()
    tr = scalp.simulate(m1, pd.concat([shorts, longs]), "EURUSD")
    assert len(tr) == len(bars) and (tr["dir"] == -1).all()


def test_max_entry_delay_and_non_ns_index():
    idx = pd.DatetimeIndex(["2016-03-01 10:00", "2016-03-01 10:10", "2016-03-01 10:11",
                            "2016-03-01 10:12", "2016-03-01 10:13"]).as_unit("s")
    m1 = pd.DataFrame([[1.1] * 4] * 5, columns=["open", "high", "low", "close"], index=idx)
    sig = _sig(m1, 0, 1, 50, 50, hold=2)
    assert len(scalp.simulate(m1, sig, "EURUSD")) == 0                      # 10 min gap
    tr = scalp.simulate(m1, sig, "EURUSD", max_entry_delay_min=10)
    assert tr.entry_time[0] == idx[1] and tr.reason[0] == "time" and tr.minutes[0] == 2.0


def test_rollover_spread_and_commission_in_pips():
    idx = pd.DatetimeIndex(["2016-03-01 00:30", "2016-03-01 10:00", "2016-03-01 23:30"])
    hs = scalp.half_spread_series(idx, "EURUSD") / PIP
    assert np.allclose(hs, [0.15 * 5, 0.15, 0.15 * 2])
    assert abs(scalp.commission_pips("USDJPY") - 0.72) < 1e-12              # 720 JPY / 1000
    assert abs(scalp.commission_pips("EURUSD") - 720 / (10 * 110)) < 1e-12
    assert abs(scalp.commission_pips("EURGBP") - 720 / (10 * 145)) < 1e-12


def test_stats_on_known_trades():
    tr = pd.DataFrame({"net_pips": [2.0, -1.0, 3.0, -2.0], "gross_pips": [3.0, 0.0, 4.0, -1.0],
                       "R": [0.4, -0.2, 0.6, -0.4], "minutes": [1.0, 2.0, 3.0, 4.0],
                       "entry_time": pd.to_datetime(["2016-01-01", "2016-07-01", "2016-10-01",
                                                     "2017-01-01"])})
    st = scalp.stats(tr)
    net = np.array([2.0, -1.0, 3.0, -2.0])
    assert st["n"] == 4 and st["win_rate"] == 0.5
    assert abs(st["profit_factor"] - 5.0 / 3.0) < 1e-12
    assert abs(st["t_stat"] - net.mean() / net.std(ddof=1) * 2.0) < 1e-12
    assert abs(st["avg_net_pips"] - 0.5) < 1e-12 and st["total_net_pips"] == 2.0


def _reference(m1, sig, symbol):
    """Bar-by-bar reference with the documented rules (independent of the numba kernel)."""
    inst = scalp.INSTRUMENTS[symbol]
    pip, slip = inst.pip, inst.slip_pips * inst.pip
    sslip = slip + inst.stop_slip_pips * pip
    hs = scalp.half_spread_series(m1.index, symbol)
    o, h, lo = m1.open.to_numpy(), m1.high.to_numpy(), m1.low.to_numpy()
    t = m1.index.as_unit("ns").asi8
    first = {}
    for ts, row in sig.iterrows():
        first.setdefault(m1.index.get_loc(ts), row)
    out, pos = [], None
    for j in range(len(m1)):
        if pos is not None:
            d, i, ent, tpx, slx, t_end = pos
            qo, qh, ql = o[j] - d * hs[j], h[j] - d * hs[j], lo[j] - d * hs[j]
            ex = None
            if j > i and d * (qo - slx) <= 0:
                ex = ("sl", qo - d * sslip)
            elif j > i and d * (qo - tpx) >= 0:
                ex = ("tp", qo)
            elif j > i and t[j] >= t_end:
                ex = ("time", qo - d * slip)
            elif (ql <= slx) if d > 0 else (qh >= slx):
                ex = ("sl", slx - d * sslip)
            elif (qh >= tpx) if d > 0 else (ql <= tpx):
                ex = ("tp", tpx)
            if ex:
                out.append((i, j, d, ent, ex[1], ex[0]))
                pos = None
        if pos is None and j in first and j + 1 < len(m1) and t[j + 1] - t[j] <= 5 * 60e9:
            r, i = first[j], j + 1
            d = int(r["dir"])
            ent = o[i] + d * (hs[i] + slip)
            tp = r["tp"] * pip if r["tp"] > 0 else 1e9
            pos = (d, i, ent, ent + d * tp, ent - d * r["sl"] * pip, t[i] + r["hold"] * 60e9)
    if pos is not None:
        d, i, ent = pos[:3]
        n = len(m1) - 1
        out.append((i, n, d, ent, (lo[n] + h[n]) / 2 - d * hs[n], "end"))
    return out


def test_kernel_matches_bar_by_bar_reference():
    rng = np.random.default_rng(5)
    for _ in range(15):
        n = 1500
        step = rng.choice([1, 1, 1, 1, 2, 3, 9, 3000], size=n)      # missing minutes, weekends
        idx = pd.DatetimeIndex(pd.Timestamp("2016-03-01 08:00")
                               + pd.to_timedelta(np.cumsum(step), unit="min"))
        o = 1.1 + np.cumsum(rng.normal(0, 8e-5, n) * np.where(rng.random(n) < 0.03, 15, 1))
        c = o + rng.normal(0, 6e-5, n)
        m1 = pd.DataFrame({"open": o, "high": np.maximum(o, c) + np.abs(rng.normal(0, 5e-5, n)),
                           "low": np.minimum(o, c) - np.abs(rng.normal(0, 5e-5, n)),
                           "close": c}, index=idx)
        k = 300
        sig = pd.DataFrame({"dir": rng.choice([-1, 1], size=k),
                            "tp": rng.choice([0.0, 1, 3, 5, 12], size=k),
                            "sl": rng.choice([1.0, 3, 5, 12], size=k),
                            "hold": rng.choice([1.0, 2, 5, 30, 600], size=k)},
                           index=idx[np.sort(rng.choice(n, size=k))])      # with duplicates
        tr = scalp.simulate(m1, sig, "EURUSD")
        ref = _reference(m1, sig, "EURUSD")
        assert len(tr) == len(ref)
        ei, xi, d, epx, xpx, why = map(np.array, zip(*ref))
        assert (m1.index.get_indexer(tr.entry_time) == ei).all()
        assert (m1.index.get_indexer(tr.exit_time) == xi).all()
        assert (tr["dir"].to_numpy() == d).all() and (tr.reason.astype(str).to_numpy() == why).all()
        assert np.allclose(tr.entry_px, epx, atol=1e-12) and np.allclose(tr.exit_px, xpx, atol=1e-12)
