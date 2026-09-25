"""Monte Carlo of the staged plan (gotobi book) towards 100M JPY.

Return series: daily returns of the gotobi book at 1% risk per trade (2005-2020/05,
scripts/portfolio_candidates.py).  Three return assumptions:
  full     2005-2020/05 as backtested (optimistic: includes the in-sample years)
  oos      2015-2020/05 only (out-of-sample years)
  haircut  full series with the mean halved (realistic after selection bias)
Plan rules (docs/STAGED_PLAN.md): risk 0.5% for years 0-2, 1.0% for years 2-4, 1.25%
afterwards; halve risk at a drawdown of 8x the per-trade risk, stop trading at 12x.
Taxes: offshore FX = 総合課税, paid each March out of the account.

    python scripts/staged_plan.py   -> reports/staged_plan_mc.md
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from fxlab.plan import PlanConfig, simulate  # noqa: E402

N_PATHS = 3000


def series():
    g = pd.read_parquet(ROOT / "reports" / "equity" / "candidates_daily_returns.parquet")["gotobi"]
    full = g.to_numpy()
    oos = g[g.index >= "2015-01-01"].to_numpy()
    hair = full - 0.5 * full.mean()
    return {"full": full, "oos": oos, "haircut": hair}


def plan(**kw):
    base = dict(risk_by_year=[(0, 0.5), (2, 1.0), (4, 1.25)], throttle_x=8, halt_x=12,
                years=30, ruin_level=0.0)
    base.update(kw)
    return PlanConfig(**base)


def main():
    S = series()
    lines = ["# 段階計画のモンテカルロ（gotobi 単独・税引後）", "",
             "各シナリオ 3,000 パス、20日ブロックのブートストラップ。リスクは 0〜2年目 0.5%、2〜4年目 1.0%、以降 1.25%。",
             "DD がリスクの8倍でリスク半減、12倍で取引停止（停止したパスはその後増えない）。", "",
             "| リターン想定 | 年率(1%リスク時) | 毎月の入金 | 他の所得 | 20年で1億の確率 | 30年で1億の確率 | 20年後の中央値 | 30年後の中央値 | 停止確率 | 最大DD 90%点 |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    for name, r in S.items():
        ann = r.mean() * 260
        for dep in (0, 30_000, 100_000, 300_000):
            for inc in (0, 6_000_000):
                o = simulate(r, plan(monthly_deposit=dep, other_income=inc), n_paths=N_PATHS)
                yb = o["yearly_balance_pctiles"]
                lines.append(
                    f"| {name} | {ann:.1%} | {dep/1e4:.0f}万円 | {inc/1e4:.0f}万円 | {o['p_reach_20y']:.0%} | "
                    f"{o['p_reach_target']:.0%} | {yb.p50.iloc[20]/1e4:,.0f}万円 | {yb.p50.iloc[30]/1e4:,.0f}万円 | "
                    f"{o['p_halt']:.1%} | {o['max_dd_p90']:.1%} |")
                print(lines[-1], flush=True)
    lines += ["", "入金なしの場合、30年後の中央値は運用益だけの結果です。1億円に届くかどうかは、ほぼ入金額で決まります。"]
    out = ROOT / "reports" / "staged_plan_mc.md"
    out.write_text("\n".join(lines) + "\n")
    print(f"-> {out}")


if __name__ == "__main__":
    main()
