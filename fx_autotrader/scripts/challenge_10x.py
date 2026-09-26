"""10万円 -> 100万円 (10x) short-term challenge with high leverage (loss of the stake accepted).

Question: if each trade risks a fraction f of the current balance (up to 100% = the
stop-loss equals the whole account; Titan FX zero-cut floors the balance at 0), what is
the probability of reaching 10x within a horizon, and what does the rest of the
distribution look like?

Trade outcomes: the gotobi book's per-trade net R (commission, spread, slippage, swap
included; 2005-2020, 1,090 trades, stop 0.5 x D1 ATR14 ~ 45 pips).  Scenarios:
  full      as backtested 2005-2020 (mean +0.081R)
  oos       2015-2020 only (mean +0.050R)
  haircut   full distribution with the mean halved (+0.040R)
  no_edge   full distribution shifted to mean -0.03R (costs only, no edge):
            what any high-leverage method without an edge looks like
Trades are resampled in blocks of 10 consecutive trades.  The challenge stops at 10x
(success, the EA closes and stops) or when the balance falls below 5,000 JPY (ruin).
Leverage check: at f=100% the notional is ~330x the balance, inside Titan FX's 1,000x.

    python scripts/challenge_10x.py  ->  reports/challenge_10x.md
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import numba as nb  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

TRADES = ROOT / "reports" / "trades" / "gotobi_1pct_2005_2020.parquet"
START, TARGET, RUIN = 100_000.0, 1_000_000.0, 5_000.0
TRADES_PER_MONTH = 71 / 12


@nb.njit(cache=True)
def _sim(r, starts, block, n_trades, f):
    n = starts.shape[0]
    hit = np.full(n, -1)
    final = np.zeros(n)
    for p in range(n):
        eq = START
        for t in range(n_trades):
            x = r[starts[p, t // block] + (t % block)]
            eq = eq * (1.0 + f * x)
            if eq < 0.0:
                eq = 0.0                    # zero-cut
            if eq >= TARGET:
                hit[p] = t
                break
            if eq < RUIN:
                break
        final[p] = eq
    return hit, final


def simulate(r, f, months, n_paths=20000, block=10, seed=1):
    rng = np.random.default_rng(seed)
    n_trades = int(round(months * TRADES_PER_MONTH))
    starts = rng.integers(0, len(r) - block, size=(n_paths, int(np.ceil(n_trades / block))))
    hit, final = _sim(np.asarray(r, float), starts, block, n_trades, float(f))
    ok = hit >= 0
    return {
        "p10x": ok.mean(),
        "p_ruin": (final < RUIN).mean(),
        "p_loss_half": (final < START * 0.5).mean(),
        "median_final": np.median(final),
        "mean_final": final.mean(),
        "months_to_10x_median": np.median(hit[ok]) / TRADES_PER_MONTH if ok.any() else np.nan,
    }


def scenarios():
    t = pd.read_parquet(TRADES)
    r = t.R_net.to_numpy()
    full = r
    oos = t[t.entry_time >= "2015-01-01"].R_net.to_numpy()
    return {"full": full, "oos": oos, "haircut": full - 0.5 * full.mean(),
            "no_edge": full - full.mean() - 0.03}


def main():
    S = scenarios()
    fracs = [0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1.0]
    lines = ["# 10万円→100万円（10倍）チャレンジのモンテカルロ", "",
             "gotobi の1トレードごとの純損益（R）を使用。20,000パス。10倍到達で終了、5,000円未満で破産扱い。", ""]
    for months in (3, 6, 12, 24):
        lines += [f"## 期間 {months} か月（約{int(round(months * TRADES_PER_MONTH))}トレード）", "",
                  "| 1回のリスク（残高比） | 想定 | 10倍到達 | 破産（5千円未満） | 半分以下 | 最終残高の中央値 | 最終残高の平均 |",
                  "|---|---|---|---|---|---|---|"]
        for f in fracs:
            for name in ("full", "oos", "haircut", "no_edge"):
                o = simulate(S[name], f, months)
                lines.append(f"| {f:.0%} | {name} | {o['p10x']:.1%} | {o['p_ruin']:.1%} | {o['p_loss_half']:.1%} | "
                             f"{o['median_final']/1e4:,.1f}万円 | {o['mean_final']/1e4:,.1f}万円 |")
        lines.append("")
    out = ROOT / "reports" / "challenge_10x.md"
    out.write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
