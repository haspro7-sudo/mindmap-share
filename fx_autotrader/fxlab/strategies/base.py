"""Strategy base class and a reference implementation.

Rules every strategy must follow (enforced by review, not by code):
  * decisions for bar t may use data of bars <= t only (the engine executes them at
    the next bar's open).  Use .shift(1) for channels that must exclude bar t.
  * parameters are constructor arguments; `params()` returns them for logging.
  * no parameter may be tuned on OOS / FRED data.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .. import indicators as I


class Strategy:
    name = "base"
    tf = "D1"

    def params(self) -> dict:
        return {k: v for k, v in vars(self).items() if not k.startswith("_")}

    def decisions(self, ctx) -> pd.DataFrame:  # pragma: no cover
        raise NotImplementedError

    def __repr__(self):
        return f"{self.name}({', '.join(f'{k}={v}' for k, v in self.params().items())})"


def empty_decisions(index) -> pd.DataFrame:
    return pd.DataFrame({
        "long_entry": False, "short_entry": False, "exit_long": False, "exit_short": False,
        "stop_dist": np.nan, "trail_dist": np.nan, "tp_dist": np.nan,
        "long_stop_px": np.nan, "short_stop_px": np.nan, "max_hold": 0}, index=index)


class DonchianTrend(Strategy):
    """Reference: classic channel breakout on close, ATR stop, opposite-channel exit."""
    name = "donchian_trend"

    def __init__(self, entry_n=55, exit_n=20, atr_n=20, stop_atr=2.0, tf="D1"):
        self.entry_n, self.exit_n, self.atr_n, self.stop_atr, self.tf = (
            entry_n, exit_n, atr_n, stop_atr, tf)

    def decisions(self, ctx):
        b = ctx.bars(self.tf)
        a = I.atr(b, self.atr_n)
        d = empty_decisions(b.index)
        d["long_entry"] = b.close > I.donchian_high(b, self.entry_n).shift(1)
        d["short_entry"] = b.close < I.donchian_low(b, self.entry_n).shift(1)
        d["exit_long"] = b.close < I.donchian_low(b, self.exit_n).shift(1)
        d["exit_short"] = b.close > I.donchian_high(b, self.exit_n).shift(1)
        d["stop_dist"] = self.stop_atr * a
        return d
