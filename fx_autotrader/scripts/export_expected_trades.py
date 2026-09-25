"""Export the backtest's trades for the EA books so an MT5 Strategy Tester run of
mt5/TitanPortfolioEA.mq5 can be compared trade by trade (same rules, different
price feed: expect most - not all - trades to line up, within a few pips).

    python scripts/export_expected_trades.py [start] [end]
      -> reports/expected_trades.csv, reports/gotobi_calendar_2026_2030.csv
"""
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import pandas as pd  # noqa: E402

from fxlab.strategies.seasonality import gotobi_set  # noqa: E402
from portfolio_candidates import candidates, trades_for  # noqa: E402

BOOKS = ["gotobi", "meanrev", "carry"]


def main(start="2018-01-01", end="2020-05-15"):
    rows = []
    for tag, (strat, syms, ex) in candidates().items():
        if tag not in BOOKS:
            continue
        for key, t in trades_for(tag, strat, syms, ex).items():
            t = t[(t.entry_time >= start) & (t.entry_time < end)]
            for r in t.itertuples():
                rows.append({"book": tag, "symbol": key.split("|")[1],
                             "entry_server_time": r.entry_time, "exit_server_time": r.exit_time,
                             "dir": "BUY" if r.dir > 0 else "SELL",
                             "entry_mid": round(r.entry_mid, 5), "exit_mid": round(r.exit_mid, 5),
                             "stop_dist": round(r.stop_dist, 5), "exit_reason": r.reason})
    df = pd.DataFrame(rows).sort_values(["entry_server_time", "book", "symbol"])
    out = ROOT / "reports" / "expected_trades.csv"
    df.to_csv(out, index=False)
    print(f"{len(df)} trades -> {out}")
    print(df.groupby("book").size().to_string())
    cal = sorted(d for d in gotobi_set(2026, 2030) if date(2026, 9, 1) <= d)
    pd.DataFrame({"gotobi_jst_date": cal}).to_csv(
        ROOT / "reports" / "gotobi_calendar_2026_2030.csv", index=False)


if __name__ == "__main__":
    main(*sys.argv[1:])
