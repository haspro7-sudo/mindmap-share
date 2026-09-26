"""Regression tests for the nanpin/martingale basket kernel in scripts/scalp_nanpin_martingale.py."""
import importlib.util
from pathlib import Path

import numpy as np
import pandas as pd

from fxlab import scalp

_P = Path(__file__).resolve().parents[1] / "scripts" / "scalp_nanpin_martingale.py"
_spec = importlib.util.spec_from_file_location("scalp_nanpin_martingale", _P)
nm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(nm)

HS, SLIP, SS = 0.004, 0.003, 0.006     # EURJPY at 10:00 server: half spread, slip, stop slip


def _P_(rows, start="2016-03-01 10:00", sym="EURJPY"):
    idx = pd.date_range(start, periods=len(rows), freq="1min")
    a = np.array(rows, float)
    t = idx.as_unit("ns").asi8.astype(np.int64)
    day = t // int(86400e9)
    days = np.arange(day.min(), day.max() + 1)
    cum = np.cumsum(nm._ROLL_WEIGHT[(days + 3) % 7])[day - day.min()]
    nights = np.zeros(len(t), np.int16)
    nights[1:] = cum[1:] - cum[:-1]
    return {"sym": sym, "idx": idx, "t": t, "o": a[:, 0], "h": a[:, 1], "l": a[:, 2], "c": a[:, 3],
            "hs1": scalp.half_spread_series(idx, sym, 1.0), "nights": nights,
            "yidx": np.clip(idx.year.to_numpy() - 2005, 0, 21).astype(np.int16),
            "entry_ok": np.ones(len(t), bool)}


def _cfg(**kw):
    c = dict(G=10.0, m=1.0, L=4, Y=5.0, stop_k=0.0, entry="fade60", lot=0.01)
    c.update(kw)
    return c


def test_long_basket_average_down_and_take_profit():
    P = _P_([[130, 130, 130, 130], [130, 130, 129.85, 129.9], [129.9, 130.2, 129.9, 130.1]])
    df = nm.run(P, np.array([1, 0, 0], np.int8), _cfg(m=2.0), 0, 3)[0]
    e1 = 130 + HS + SLIP
    f2 = e1 - 0.10 + SLIP
    Q, S = 0.03, 0.01 * e1 + 0.02 * f2
    assert len(df) == 1 and df.reason[0] == "tp" and df.levels[0] == 2
    assert abs(df.gross_jpy[0] - 1e5 * (Q * (S / Q + 0.05) - S)) < 1e-6
    assert abs(df.pnl_jpy[0] - (df.gross_jpy[0] - 720 * Q)) < 1e-6


def test_stop_out_at_20pct_margin_level():
    P = _P_([[130, 130, 130, 130], [130, 130, 129.9, 129.95], [129.95, 129.95, 128.0, 128.5]])
    df = nm.run(P, np.array([1, 0, 0], np.int8), _cfg(L=1, lot=5.0), 0, 3)[0]
    e1 = 130 + HS + SLIP
    M, B0 = 5 * 1e5 * e1 / 1000, 1e5 - 5 * 720
    x_so = e1 + (0.2 * M - B0) / (1e5 * 5)
    assert abs((B0 + 5e5 * (x_so - e1)) / M - 0.2) < 1e-9
    assert df.reason[0] == "stopout"
    assert abs(df.pnl_jpy[0] - (B0 + 5e5 * (x_so - SS - e1) - 1e5)) < 1e-6


def test_gap_stop_out_zero_cut():
    P = _P_([[130, 130, 130, 130], [130, 130, 129.95, 129.95], [127.0, 127.0, 126.0, 126.5]])
    df = nm.run(P, np.array([1, 0, 0], np.int8), _cfg(L=1, lot=5.0), 0, 3)[0]
    assert df.reason[0] == "stopout" and df.balance_after[0] == 0.0 and df.pnl_jpy[0] == -1e5


def test_short_hard_stop_after_full_grid():
    P = _P_([[130, 130, 130, 130], [130, 130.12, 130, 130.1], [130.1, 130.25, 130.1, 130.2],
             [130.2, 130.5, 130.2, 130.45]])
    df = nm.run(P, np.array([-1, 0, 0, 0], np.int8), _cfg(L=3, Y=2.0, stop_k=1.0, lot=0.1), 0, 4)[0]
    e1 = 130 - HS - SLIP                       # sell at bid - slip
    f2 = e1 + 0.10 - SLIP                      # add-on sell at the level - slip
    f3 = f2 + 0.10 - SLIP
    px = f3 + 0.10 + SS                        # buy-stop 1G above the last fill, + stop slip
    assert df.reason[0] == "hardstop" and df.levels[0] == 3
    assert abs(df.gross_jpy[0] + 1e5 * (0.3 * px - 0.1 * (e1 + f2 + f3))) < 1e-6


def test_triple_swap_wednesday_rollover():
    P = _P_([[130, 130, 130, 130]] * 5, start="2016-03-02 23:57")
    df = nm.run(P, np.array([-1, 0, 0, 0, 0], np.int8), _cfg(G=50.0, L=2, Y=50.0, lot=1.0), 0, 5)[0]
    rate = nm.CostModel().swap_rate_annual(nm.INSTRUMENTS["EURJPY"], -1, 2016)
    assert abs(df.swap_jpy[0] - 1e5 * 130 * rate / 365 * 3) < 1e-6


def test_margin_blocks_add_on():
    P = _P_([[130, 130, 130, 130], [130, 130, 129.9, 129.9], [129.9, 129.9, 129.9, 129.9]])
    df = nm.run(P, np.array([1, 0, 0], np.int8), _cfg(G=1.0, m=2.0, L=12, Y=50.0, lot=1.0), 0, 3)[0]
    assert bool(df.margin_blocked[0]) and df.levels[0] == 3 and abs(df.lots[0] - 7.0) < 1e-9


def test_account_mode_alternates_and_checkpoints():
    rng = np.random.default_rng(0)
    mid = 130 + np.cumsum(rng.normal(0, 0.01, 3000))
    P = _P_(np.c_[mid, mid + 0.01, mid - 0.01, mid].tolist())
    df, status, B, _, ck = nm.run(P, np.ones(3000, np.int8), _cfg(L=3, Y=2.0, stop_k=0.0, entry="alt"),
                                  0, 2999, fresh=False, ck_idx=[500, 1000, 3100])
    assert (df.dir.to_numpy()[:6] == [1, -1, 1, -1, 1, -1]).all()
    assert status == 0 and abs(ck[-1] - B) < 1e-9 and abs(df.balance_after.iloc[-1] - B) < 1e-9
