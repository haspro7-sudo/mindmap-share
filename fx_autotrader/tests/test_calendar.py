import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fxlab.strategies.seasonality import gotobi_set, jp_business_day, jp_public_holidays  # noqa: E402

# official Cabinet Office lists (国民の祝日・休日)
JP_2025 = {date(2025, 1, 1), date(2025, 1, 13), date(2025, 2, 11), date(2025, 2, 23),
           date(2025, 2, 24), date(2025, 3, 20), date(2025, 4, 29), date(2025, 5, 3),
           date(2025, 5, 4), date(2025, 5, 5), date(2025, 5, 6), date(2025, 7, 21),
           date(2025, 8, 11), date(2025, 9, 15), date(2025, 9, 23), date(2025, 10, 13),
           date(2025, 11, 3), date(2025, 11, 23), date(2025, 11, 24)}
JP_2026 = {date(2026, 1, 1), date(2026, 1, 12), date(2026, 2, 11), date(2026, 2, 23),
           date(2026, 3, 20), date(2026, 4, 29), date(2026, 5, 3), date(2026, 5, 4),
           date(2026, 5, 5), date(2026, 5, 6), date(2026, 7, 20), date(2026, 8, 11),
           date(2026, 9, 21), date(2026, 9, 22), date(2026, 9, 23), date(2026, 10, 12),
           date(2026, 11, 3), date(2026, 11, 23)}


def test_japanese_holidays_2025_2026():
    assert set(jp_public_holidays(2025)) == JP_2025
    assert set(jp_public_holidays(2026)) == JP_2026


def test_gotobi_examples():
    g = gotobi_set()
    assert date(2026, 10, 5) in g            # Monday the 5th
    assert date(2026, 9, 25) in g
    assert date(2026, 9, 30) in g            # month end
    assert date(2026, 1, 5) in g             # Jan 5 (after the Jan 1-3 bank holidays)
    assert date(2026, 5, 1) in g             # May 5 holiday -> back to Fri May 1
    assert date(2026, 5, 5) not in g
    assert not jp_business_day(date(2026, 12, 31))
