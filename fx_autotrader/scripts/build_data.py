"""Build M1 parquet cache and H1/H4/D1 server-time bars for every pair.

    python scripts/build_data.py            # all pairs
    python scripts/build_data.py USDJPY     # selected pairs
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd  # noqa: E402

from fxlab import data as D  # noqa: E402

TFS = {"H1": "1h", "H4": "4h", "D1": "1D"}


def main(pairs):
    for pair in pairs:
        m1 = D.load_m1(pair)
        for tf, rule in TFS.items():
            bars = D.resample_ohlc(m1, rule)
            out = D.bars_path(pair, tf)
            out.parent.mkdir(parents=True, exist_ok=True)
            bars.astype("float64").to_parquet(out, compression="zstd")
        print(f"{pair}: M1 {len(m1):>9,}  {m1.index[0]:%Y-%m-%d} .. {m1.index[-1]:%Y-%m-%d}"
              f"  D1 {len(bars):,}")


if __name__ == "__main__":
    main(sys.argv[1:] or D.ALL_PAIRS)
