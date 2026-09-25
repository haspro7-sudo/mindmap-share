"""Read the CSV log written by mt5/TitanPortfolioEA.mq5 and report the stage gates and
kill criteria of docs/STAGED_PLAN.md for the gotobi book.

    python scripts/monitor_ea_log.py TitanPortfolioEA_26092600.csv
    python scripts/monitor_ea_log.py TitanPortfolioEA_26092600_tester.csv --compare
          (--compare: match gotobi entries with reports/expected_trades.csv)

The log lives in <MT5 data folder>/MQL5/Files (live/demo) or in the tester agent's
MQL5/Files folder (Strategy Tester).
"""
import argparse
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]


def kv(detail: str) -> dict:
    return dict(re.findall(r"(\w+)=([-+\w.:]+)", detail))


def load(path) -> pd.DataFrame:
    rows = []
    for line in open(path, encoding="utf-8", errors="replace"):
        parts = line.rstrip("\n").split(",", 3)
        if len(parts) < 4:
            continue
        t, what, sym, detail = parts
        try:
            ts = pd.Timestamp(t.replace(".", "-"))
        except ValueError:
            continue
        rows.append({"time": ts, "what": what, "sym": sym, "detail": detail})
    return pd.DataFrame(rows)


def gotobi_report(df: pd.DataFrame) -> None:
    mech = df[df.what == "GTB_MECH"].copy()
    if len(mech):
        mech["move"] = mech.detail.map(lambda d: float(kv(d)["sell_move_pips"]))
        m = mech.move
        print(f"[P5] 09:55->10:05 sell-direction move: n={len(m)}  mean={m.mean():+.2f} pips  "
              f"last60={m.tail(60).mean():+.2f}  last120={m.tail(120).mean():+.2f}  (expected ~ +2)")
        if len(m) >= 60 and m.tail(60).mean() < 0.5:
            print("   -> PAUSE: 60-day mean below +0.5 pip")
        if len(m) >= 120 and m.tail(120).mean() < 0.0:
            print("   -> DROP: 120-day mean below 0")
    opens = df[(df.what == "OPEN") & df.detail.str.startswith("GTB")].copy()
    if len(opens):
        o = opens.detail.map(kv)
        opens["fill"] = o.map(lambda x: float(x.get("fill", "nan")))
        opens["bid"] = o.map(lambda x: float(x["bid"]))
        opens["ask"] = o.map(lambda x: float(x["ask"]))
        opens["risk"] = o.map(lambda x: float(x["risk"]))
        opens["spread_pips"] = (opens.ask - opens.bid) / 0.01
        opens["date"] = opens.time.dt.date
        if len(mech):
            mech["date"] = mech.time.dt.date
            mech["mid0955"] = mech.detail.map(lambda d: float(kv(d)["mid0955"]))
            opens = opens.merge(mech[["date", "mid0955"]], on="date", how="left")
            opens["adverse_pips"] = (opens.mid0955 - opens.fill) / 0.01      # a sell filled below the 09:55 mid
        last = opens.tail(20)
        print(f"[P6] gotobi entries: n={len(opens)}  spread at send median={opens.spread_pips.median():.2f} pips  "
              f"last20 adverse vs 09:55 mid={last.get('adverse_pips', pd.Series(dtype=float)).mean():+.2f} pips (limit 0.7)")
    skips = df[(df.what == "SKIP") & (df.sym.str.startswith("USDJPY"))]
    if len(skips):
        print(f"      gotobi skips logged: {len(skips)} (spread / limits)")
    exits = df[(df.what == "EXIT") & df.detail.str.startswith("GTB")].copy()
    if len(exits) and len(opens):
        e = exits.detail.map(kv)
        exits["net"] = e.map(lambda x: float(x["net"]))
        exits["date"] = exits.time.dt.date
        j = exits.merge(opens[["date", "risk"]], on="date", how="left")
        j["R"] = j.net / j.risk
        R = j.R.dropna()
        cum = R.cumsum()
        dd = (cum.cummax() - cum).max() if len(cum) else 0.0
        print(f"[P3/P4] closed gotobi trades: n={len(R)}  mean R={R.mean():+.3f}  cum R={R.sum():+.2f}  "
              f"max R-drawdown={dd:.2f}  last142 sum={R.tail(142).sum():+.2f}")
        if R.sum() <= -8:
            print("   -> PAUSE: cumulative -8R")
        if dd >= 10:
            print("   -> PAUSE: book drawdown >= 10R")
    for what in ("HALT", "NOTIFY", "CLOCK", "ERR_OPEN", "ERR_CLOSE", "WARN"):
        n = int((df.what == what).sum())
        if n:
            print(f"   {what}: {n} line(s) - read them")


def compare(df: pd.DataFrame) -> None:
    exp = pd.read_csv(ROOT / "reports" / "expected_trades.csv", parse_dates=["entry_server_time"])
    exp = exp[exp.book == "gotobi"].copy()
    opens = df[(df.what == "OPEN") & df.detail.str.startswith("GTB")].copy()
    if not len(opens):
        print("no GTB OPEN lines in the log")
        return
    lo, hi = opens.time.min().normalize(), opens.time.max().normalize() + pd.Timedelta(days=1)
    exp = exp[(exp.entry_server_time >= lo) & (exp.entry_server_time < hi)]
    exp["date"] = exp.entry_server_time.dt.date
    opens["date"] = opens.time.dt.date
    opens["fill"] = opens.detail.map(lambda d: float(kv(d).get("fill", "nan")))
    m = exp.merge(opens[["date", "time", "fill"]], on="date", how="outer", indicator=True)
    both = m[m._merge == "both"]
    only_py = m[m._merge == "left_only"]
    only_ea = m[m._merge == "right_only"]
    diff = (both.fill - both.entry_mid).abs() / 0.01
    print(f"gotobi entries  python={len(exp)}  EA={len(opens)}  matched days={len(both)}  "
          f"only python={len(only_py)}  only EA={len(only_ea)}")
    if len(both):
        print(f"entry price |EA fill - python mid|: median {diff.median():.2f} pips, "
              f"within 1 pip {np.mean(diff <= 1.0):.0%} (target >= 95%)")
        tdiff = (both.time - both.entry_server_time).dt.total_seconds().abs()
        print(f"entry time difference: median {tdiff.median():.0f} s, max {tdiff.max():.0f} s")
    if len(only_py):
        print("days only in python:", ", ".join(str(d) for d in only_py.date.head(20)))
    if len(only_ea):
        print("days only in EA:", ", ".join(str(d) for d in only_ea.date.head(20)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("log")
    ap.add_argument("--compare", action="store_true")
    a = ap.parse_args()
    df = load(a.log)
    if not len(df):
        sys.exit("empty log")
    print(f"{a.log}: {len(df)} lines {df.time.min()} .. {df.time.max()}")
    gotobi_report(df)
    if a.compare:
        compare(df)


if __name__ == "__main__":
    main()
