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


# ---------------------------------------------------------------- audit regressions
def test_rollover_hour_execution_waits_for_0100():
    h1 = pd.date_range("2020-01-06", "2020-01-08", freq="1h", inclusive="left")
    d1 = pd.DatetimeIndex(["2020-01-06"])
    dec = map_decisions(d1, "D1", h1, avoid_rollover=True)
    assert np.where(dec == 0)[0].tolist() == [25]      # 2020-01-07 01:00, not 00:00


def test_oco_both_levels_in_one_bar_resolved_with_fine_data():
    idx = pd.date_range("2020-01-06 02:00", periods=3, freq="1h")
    bars = pd.DataFrame({"open": [100.0, 100.0, 100.5], "high": [100.05, 101.5, 100.6],
                         "low": [99.95, 99.5, 100.4], "close": [100.0, 100.5, 100.5]}, index=idx)
    # inside bar 1: price first drops to 99.5 (short fills at 99.7), then rallies to 101.5
    fidx = pd.date_range(idx[1], periods=60, freq="1min")
    path = np.concatenate([np.linspace(100, 99.5, 20), np.linspace(99.5, 101.5, 30),
                           np.linspace(101.5, 100.5, 10)])
    fine = pd.DataFrame({"high": path + 0.01, "low": path - 0.01}, index=fidx)
    dec = _dec(idx, long_entry=[True, False, False], short_entry=[True, False, False],
               stop_dist=1.0, tp_dist=1.0, long_stop_px=100.3, short_stop_px=99.7)
    tr = simulate_symbol(dec, "H1", bars, fine_bars=fine, avoid_rollover=False)
    t = tr.iloc[0]
    assert t.dir == -1 and t.reason == "stop"          # the short filled first and was stopped
    # without fine data the engine must not pick the leg that looks better at the close
    tr2 = simulate_symbol(dec, "H1", bars, avoid_rollover=False)
    assert tr2.iloc[0].dir == -1


def test_stop_entry_fill_ignores_lows_printed_before_the_fill():
    idx = pd.date_range("2020-01-06 02:00", periods=3, freq="1h")
    bars = pd.DataFrame({"open": [100.0, 100.0, 101.0], "high": [100.05, 101.2, 101.1],
                         "low": [99.95, 99.0, 100.9], "close": [100.0, 101.0, 101.0]}, index=idx)
    fidx = pd.date_range(idx[1], periods=60, freq="1min")
    path = np.concatenate([np.linspace(100, 99.0, 20), np.linspace(99.0, 101.2, 40)])
    fine = pd.DataFrame({"high": path + 0.005, "low": path - 0.005}, index=fidx)
    dec = _dec(idx, long_entry=[True, False, False], stop_dist=0.8, long_stop_px=100.5)
    tr = simulate_symbol(dec, "H1", bars, fine_bars=fine, avoid_rollover=False)
    assert tr.iloc[0].reason != "stop"                 # the 99.0 low came before the fill
    tr_whole = simulate_symbol(dec, "H1", bars, avoid_rollover=False)
    assert tr_whole.iloc[0].reason == "stop"           # pessimistic fallback without M1


def test_open_entry_is_sized_before_intrabar_exit_of_other_symbol():
    idx = pd.date_range("2020-01-06 02:00", periods=6, freq="1h")
    bars = pd.DataFrame({"open": 150.0, "high": 150.5, "low": 149.5, "close": 150.0}, index=idx)
    a = pd.DataFrame({"entry_time": [idx[0]], "exit_time": [idx[3]], "entry_i": [0], "exit_i": [3],
                      "dir": [1], "entry_mid": [150.0], "exit_mid": [149.0], "stop_dist": [1.0],
                      "reason": ["stop"], "stop_entry": [False], "entry_at_open": [True],
                      "exit_at_open": [False]})
    b = a.copy()
    b[["entry_time", "exit_time", "entry_i", "exit_i"]] = [idx[3], idx[5], 3, 5]
    b["exit_mid"] = 150.5
    b["reason"] = "signal"
    cfg = PortfolioConfig(costs=CostModel(use_swap=False), max_open_trades=1)
    res = run_portfolio({"USDJPY": a, "EURJPY": b}, _conv(idx),
                        {"USDJPY": bars.close, "EURJPY": bars.close}, cfg)
    # A is still open at the 05:00 open (its stop fills later in that bar) -> B skipped
    assert res.trades.set_index("symbol").loc["EURJPY", "taken"] == False  # noqa: E712


def test_trades_open_at_end_are_closed_at_end():
    idx = pd.date_range("2014-12-29", periods=24 * 10, freq="1h")
    bars = pd.DataFrame({"open": 150.0, "high": 150.5, "low": 149.5,
                         "close": np.linspace(150, 160, len(idx))}, index=idx)
    d1 = bars.close.resample("1D").last()
    t = pd.DataFrame({"entry_time": [idx[5]], "exit_time": [idx[-1]], "entry_i": [5],
                      "exit_i": [len(idx) - 1], "dir": [1], "entry_mid": [150.0],
                      "exit_mid": [160.0], "stop_dist": [1.0], "reason": ["signal"]})
    cfg = PortfolioConfig(costs=CostModel(use_swap=False))
    res = run_portfolio({"USDJPY": t}, _conv(idx), {"USDJPY": d1}, cfg, end="2015-01-01")
    tr = res.trades.iloc[0]
    assert tr.exit_time == pd.Timestamp("2015-01-01") and tr.reason == "end"
    assert tr.exit_mid == pytest.approx(d1[d1.index < "2015-01-01"].iloc[-1])
    assert res.equity.index[-1] < pd.Timestamp("2015-01-01")


def test_net_R_includes_commission_and_swap():
    from fxlab.metrics import trade_stats
    idx = pd.date_range("2020-01-06", periods=24 * 20, freq="1h")
    bars = pd.DataFrame({"open": 150.0, "high": 150.5, "low": 149.5, "close": 150.0}, index=idx)
    t = pd.DataFrame({"entry_time": [idx[1]], "exit_time": [idx[-1]], "entry_i": [1],
                      "exit_i": [len(idx) - 1], "dir": [-1], "entry_mid": [150.0],
                      "exit_mid": [149.99], "stop_dist": [1.0], "reason": ["signal"]})
    res = run_portfolio({"USDJPY": t}, _conv(idx), {"USDJPY": bars.close.resample("1D").last()},
                        PortfolioConfig())
    s = trade_stats(res.taken)
    assert res.taken.R.iloc[0] < 0.01 and s["avg_R"] < res.taken.R.iloc[0]
    assert s["avg_R"] == pytest.approx(res.taken.pnl_jpy.iloc[0] / res.taken.risk_jpy.iloc[0])


def test_fred_synthetic_bars_are_not_optimistic_for_stops():
    from fxlab.backtest import _bars
    from fxlab.data import synthetic_ohlc_from_closes
    from fxlab import indicators as I
    try:
        d1 = _bars("oanda", "EURUSD", "D1")
    except FileNotFoundError:
        pytest.skip("no data")
    a = I.atr(d1, 20)
    f, s = I.ema(d1.close, 20), I.ema(d1.close, 100)
    dec = pd.DataFrame({"long_entry": (f > s) & (f.shift() <= s.shift()),
                        "short_entry": (f < s) & (f.shift() >= s.shift()),
                        "stop_dist": 2 * a, "trail_dist": 3 * a}, index=d1.index)
    R = lambda tr: (tr.dir * (tr.exit_mid - tr.entry_mid) / tr.stop_dist).mean()  # noqa: E731
    true_R = R(simulate_symbol(dec, "D1", d1))
    syn_R = R(simulate_symbol(dec, "D1", synthetic_ohlc_from_closes(d1.close)))
    assert syn_R <= true_R + 0.1


def test_equity_final_equals_initial_plus_pnl_with_forced_end_close():
    idx = pd.date_range("2014-12-22", periods=24 * 12, freq="1h")
    bars = pd.DataFrame({"open": 150.0, "high": 150.5, "low": 149.5,
                         "close": np.linspace(150, 156, len(idx))}, index=idx)
    d1 = bars.close.resample("1D").last()
    t = pd.DataFrame({"entry_time": [idx[5]], "exit_time": [idx[-1]], "entry_i": [5],
                      "exit_i": [len(idx) - 1], "dir": [1], "entry_mid": [150.0],
                      "exit_mid": [156.0], "stop_dist": [1.0], "reason": ["signal"]})
    cfg = PortfolioConfig(costs=CostModel(use_swap=False))
    res = run_portfolio({"USDJPY": t}, _conv(idx), {"USDJPY": d1}, cfg, end="2015-01-01")
    assert res.equity.iloc[-1] == pytest.approx(cfg.initial_jpy + res.taken.pnl_jpy.sum())
