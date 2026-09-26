"""Scalping x the 10x challenge: what trading many times a day does to P(10x).

Per-trade net R comes from fxlab.scalp simulations (Titan Blade costs):
  * random entries on EURUSD 2015-2020 with several TP/SL shapes (no edge, pure cost)
  * the gotobi book (reference: the only verified edge, ~6 trades/month)
  * optional extra trade files (scalp.simulate output with an R column) given on the
    command line, e.g. surviving scalping candidates

Each path starts at 100,000 JPY, risks a fraction f of equity per trade (R=-1 loses f),
stops at 10x (success) or below 5,000 JPY (ruin); zero-cut floors the balance at 0.

    python scripts/scalp_10x_mc.py [reports/scalping/trades_x.parquet ...]
        -> reports/scalping/scalp_10x_mc.md
"""
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from fxlab import scalp  # noqa: E402

_spec = importlib.util.spec_from_file_location("challenge_10x", ROOT / "scripts" / "challenge_10x.py")
C = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(C)

OUT = ROOT / "reports" / "scalping" / "scalp_10x_mc.md"
SHAPES = [(1, 20), (2, 10), (5, 5), (10, 2)]
TRADES_PER_DAY = [1, 5, 20]
RISKS = [0.01, 0.02, 0.05, 0.1, 0.2]
MONTHS = 3
DAYS_PER_MONTH = 21


def random_R(tp, sl):
    m1 = scalp.load("EURUSD", start="2015-01-01")
    sig = scalp.random_signals(m1, 30000, tp=tp, sl=sl, hold=240, seed=tp * 100 + sl)
    tr = scalp.simulate(m1, sig, "EURUSD")
    return tr["R"].to_numpy(), float((tr.net_pips > 0).mean())


def run(r, f, n_trades, n_paths=20000, block=10, seed=7):
    rng = np.random.default_rng(seed)
    starts = rng.integers(0, len(r) - block, size=(n_paths, int(np.ceil(n_trades / block))))
    hit, final = C._sim(np.asarray(r, float), starts, block, n_trades, float(f))
    return (hit >= 0).mean(), (final < C.RUIN).mean(), float(np.median(final))


def main(extra):
    sources = {}
    for tp, sl in SHAPES:
        r, win = random_R(tp, sl)
        sources[f"random TP{tp}/SL{sl} (win {win:.0%}, {r.mean():+.3f}R)"] = (r, TRADES_PER_DAY)
    g = pd.read_parquet(C.TRADES).R_net.to_numpy()
    sources[f"gotobi reference ({g.mean():+.3f}R)"] = (g, [6 / DAYS_PER_MONTH])
    for p in extra:
        t = pd.read_parquet(p)
        r = t["R"].to_numpy()
        per_day = len(t) / max(1, t.entry_time.dt.normalize().nunique())
        sources[f"{Path(p).stem} ({r.mean():+.3f}R, {per_day:.1f}/day)"] = (r, [per_day])

    lines = ["# スキャルピングと10倍チャレンジ（モンテカルロ）", "",
             f"10万円から開始、期間 {MONTHS} か月、20,000パス。1回のリスク f（損切りで残高の f を失う）。"
             "10倍で終了、5,000円未満で破産。取引コストは Titan FX ブレード口座相当（fxlab/scalp.py）。", "",
             "| 取引の中身 | 1日の回数 | リスク/回 | 10倍到達 | 破産 | 最終残高の中央値 |",
             "|---|---|---|---|---|---|"]
    for name, (r, freqs) in sources.items():
        for per_day in freqs:
            n_trades = max(1, int(round(per_day * DAYS_PER_MONTH * MONTHS)))
            for f in RISKS + ([0.3, 0.5] if "gotobi" in name else []):
                p10, pr, med = run(r, f, n_trades)
                lines.append(f"| {name} | {per_day:g} | {f:.0%} | {p10:.1%} | {pr:.1%} | {med / 1e4:,.1f}万円 |")
    lines.append("")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main(sys.argv[1:])
