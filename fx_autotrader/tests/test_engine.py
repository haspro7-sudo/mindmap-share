import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fxlab.engine import (ConversionTable, PortfolioConfig, RiskSchedule, map_decisions,  # noqa: E402
                          run_portfolio, simulate_symbol, swap_nights)
from fxlab.instruments import CostModel  # noqa: E402


def _bars(prices, start="2020-01-06", freq="1h"):
    idx = pd.date_range(start, periods=len(prices), freq=freq)
    p = np.asarray(prices, float)
    return pd.DataFrame({"open": p, "high": p + 0.05, "low": p - 0.05, "close": p}, index=idx)


def _dec(index, **cols):
    df = pd.DataFrame(index=index)
    for k, v in cols.items():
        df[k] = v
    return df


def test_decision_executes_at_next_bar_open():
    bars = _bars(np.linspace(100, 101, 10))
    le = np.zeros(10, bool)
    le[3] = True
    dec = _dec(bars.index, long_entry=le, stop_dist=1.0)
    tr = simulate_symbol(dec, "H1", bars)
    assert len(tr) == 1
    assert tr.entry_i.iat[0] == 4
    assert tr.entry_mid.iat[0] == pytest.approx(bars.open.iat[4])


def test_d1_signal_maps_to_first_h1_bar_of_next_day():
    h1 = pd.date_range("2020-01-06", "2020-01-09", freq="1h", inclusive="left")
    d1 = pd.date_range("2020-01-06", periods=3, freq="1D")
    dec = map_decisions(d1, "D1", h1)
    assert dec[24] == 0 and dec[48] == 1
    assert (dec[:24] == -1).all()


def test_friday_d1_signal_executes_monday():
    h1 = pd.DatetimeIndex(list(pd.date_range("2020-01-10", periods=24, freq="1h")) +
                          list(pd.date_range("2020-01-13", periods=24, freq="1h")))
    d1 = pd.DatetimeIndex(["2020-01-10"])
    dec = map_decisions(d1, "D1", h1)
    assert dec[24] == 0 and (dec[:24] == -1).all()


def test_stop_hit_intrabar_and_gap():
    p = [100, 100, 100, 99.0, 98.0]
    bars = _bars(p)
    bars.loc[bars.index[3], "low"] = 98.9
    le = np.array([True, False, False, False, False])
    dec = _dec(bars.index, long_entry=le, stop_dist=0.5)
    tr = simulate_symbol(dec, "H1", bars)
    # entry at bar1 open=100, stop 99.5; bar3 opens at 99.0 (gap) -> exit at open 99.0
    assert tr.reason.iat[0] == "stop"
    assert tr.exit_mid.iat[0] == pytest.approx(99.0)


def test_stop_before_tp_when_both_touched():
    bars = _bars([100, 100, 100])
    bars.loc[bars.index[1], ["high", "low"]] = [102, 98]
    le = np.array([True, False, False])
    dec = _dec(bars.index, long_entry=le, stop_dist=1.0, tp_dist=1.0)
    # entry bar1 open 100: stop 99, tp 101 both inside bar1 -> stop
    tr = simulate_symbol(dec, "H1", bars)
    assert tr.reason.iat[0] == "stop" and tr.exit_mid.iat[0] == pytest.approx(99.0)


def test_stop_entry_order_fills_at_level_or_gap():
    bars = _bars([100, 100, 100.2, 101.5, 101.5])
    le = np.array([True, False, True, False, False])
    dec = _dec(bars.index, long_entry=le, stop_dist=1.0, long_stop_px=100.1)
    tr = simulate_symbol(dec, "H1", bars)
    # order placed for bar1 (h=100.05, no fill), bar2's decision (from bar1: False) cancels
    # new order placed from decision at bar2 close -> bar3 opens 101.5 above level -> fill at open
    assert tr.entry_i.iat[0] == 3
    assert tr.entry_mid.iat[0] == pytest.approx(101.5)


def test_trailing_stop_only_tightens():
    p = [100, 100, 101, 102, 103, 102.5, 101.0, 100.0]
    bars = _bars(p)
    le = np.zeros(len(p), bool)
    le[0] = True
    dec = _dec(bars.index, long_entry=le, stop_dist=5.0, trail_dist=1.0)
    tr = simulate_symbol(dec, "H1", bars)
    t = tr.iloc[0]
    assert t.reason == "stop"
    # highest high 103.05 -> trailing stop 102.05, first violated at bar 6 open 101.0 (gap)
    assert t.exit_mid == pytest.approx(101.0)


def test_swap_nights_weekly_total_is_seven():
    assert swap_nights(pd.Timestamp("2020-01-06 10:00"), pd.Timestamp("2020-01-13 10:00")) == 7
    # Wed -> Thu rollover is triple
    assert swap_nights(pd.Timestamp("2020-01-08 10:00"), pd.Timestamp("2020-01-09 10:00")) == 3
    assert swap_nights(pd.Timestamp("2020-01-06 10:00"), pd.Timestamp("2020-01-06 20:00")) == 0


def _conv(index):
    s = pd.Series(100.0, index=index)
    return ConversionTable({"USDJPY": s, "GBPJPY": s, "AUDJPY": s, "CADJPY": s, "EURJPY": s})


def test_position_sizing_risks_target_fraction():
    bars = _bars(np.full(50, 150.0))
    trades = pd.DataFrame({
        "entry_time": [bars.index[1]], "exit_time": [bars.index[10]], "entry_i": [1],
        "exit_i": [10], "dir": [1], "entry_mid": [150.0], "exit_mid": [149.0],
        "stop_dist": [1.0], "reason": ["stop"]})
    cfg = PortfolioConfig(initial_jpy=1_000_000, risk=RiskSchedule(base_risk=0.01),
                          costs=CostModel(use_swap=False))
    res = run_portfolio({"USDJPY": trades}, _conv(bars.index), {"USDJPY": bars.close}, cfg)
    t = res.trades.iloc[0]
    # risk budget 10,000 JPY over (1.0 + costs) JPY per unit -> 0.09 lots (9,000 units)
    assert t.lots == pytest.approx(0.09)
    assert -11_000 < t.pnl_jpy < -9_000


def test_random_entries_lose_roughly_the_costs():
    rng = np.random.default_rng(0)
    n = 20000
    steps = rng.normal(0, 0.05, n)
    p = 150 + np.cumsum(steps)
    bars = pd.DataFrame({"open": p, "close": p + rng.normal(0, 0.01, n)},
                        index=pd.date_range("2010-01-04", periods=n, freq="1h"))
    bars["high"] = bars[["open", "close"]].max(axis=1) + 0.02
    bars["low"] = bars[["open", "close"]].min(axis=1) - 0.02
    le = rng.random(n) < 0.02
    se = (~le) & (rng.random(n) < 0.02)
    dec = _dec(bars.index, long_entry=le, short_entry=se, stop_dist=0.3, tp_dist=0.3)
    tr = simulate_symbol(dec, "H1", bars)
    R_mid = (tr.dir * (tr.exit_mid - tr.entry_mid) / tr.stop_dist)
    assert len(tr) > 200
    assert abs(R_mid.mean()) < 0.1  # no edge before costs


def test_same_bar_entry_and_exit_releases_symbol():
    idx = pd.date_range("2020-01-06", periods=10, freq="1h")
    bars = pd.DataFrame({"open": 150.0, "high": 150.5, "low": 149.5, "close": 150.0}, index=idx)
    trades = pd.DataFrame({
        "entry_time": [idx[1], idx[3]], "exit_time": [idx[1], idx[5]], "entry_i": [1, 3],
        "exit_i": [1, 5], "dir": [1, 1], "entry_mid": [150.0, 150.0],
        "exit_mid": [149.6, 150.4], "stop_dist": [0.4, 0.4], "reason": ["stop", "signal"]})
    cfg = PortfolioConfig(costs=CostModel(use_swap=False))
    res = run_portfolio({"USDJPY": trades}, _conv(idx), {"USDJPY": bars.close}, cfg)
    assert res.trades.taken.all()
