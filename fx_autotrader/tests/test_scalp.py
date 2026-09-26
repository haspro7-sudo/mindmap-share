import numpy as np
import pandas as pd

from fxlab import scalp


def _bars(rows, start="2016-03-01 10:00"):
    idx = pd.date_range(start, periods=len(rows), freq="1min")
    return pd.DataFrame(rows, columns=["open", "high", "low", "close"], index=idx)


def _sig(m1, i, d, tp, sl, hold=60):
    return pd.DataFrame({"dir": [d], "tp": [tp], "sl": [sl], "hold": [hold]}, index=[m1.index[i]])


HS = 0.5 * 0.3 * 0.0001          # EURUSD half spread at 10:00 server
SLIP = 0.2 * 0.0001


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
    assert abs(tr.gross_pips[0] - (-5.0 - 0.3)) < 1e-9       # stop slip 0.3 pip


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
