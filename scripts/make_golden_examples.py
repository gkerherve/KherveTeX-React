"""Write tests/golden/examples.json: every gallery example's document.json
as the Python app builds it, for tests/examples.parity.test.ts.

The planners and the calendar are built for "today", so they are dumped for
a set of fixed dates (month ends, ISO week 53, a leap day, weeks spanning
two months or two years) with datetime.date.today patched.

    python3 scripts/make_golden_examples.py [path/to/KherveTeX]
"""
from __future__ import annotations

import datetime as dt
import json
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE.parent / "KherveTeX"
sys.path.insert(0, str(SRC))

from khervedoc import examples, model  # noqa: E402
from khervedoc.example_docs import planning  # noqa: E402

BASE_DATE = dt.date(2026, 11, 4)
DATES = [dt.date(*d) for d in (
    (2026, 11, 4), (2024, 2, 29), (2025, 12, 31), (2026, 1, 1), (2027, 1, 3),
    (2026, 3, 1), (2026, 6, 30), (2020, 12, 31), (2021, 1, 4), (2026, 2, 1),
    (2015, 2, 1), (2032, 9, 30), (2026, 8, 31), (2026, 5, 4),
)]
DATED = ("daily_journal", "weekly_journal", "monthly_journal", "calendar")


def with_today(day: dt.date):
    class _Date(dt.date):
        @classmethod
        def today(cls):
            return cls(day.year, day.month, day.day)

    shim = types.SimpleNamespace(date=_Date, timedelta=dt.timedelta)
    planning._dt = shim


def main() -> None:
    import os
    os.chdir(tempfile.mkdtemp(prefix="ktex-golden-ex-"))
    with_today(BASE_DATE)
    gallery = []
    for category, label, factory, blurb in examples.GALLERY:
        gallery.append({"category": category, "label": label, "factory": factory.__name__,
                        "description": blurb, "document_json": model.to_json(factory())})
    dated = {}
    for day in DATES:
        with_today(day)
        dated[day.isoformat()] = {name: model.to_json(getattr(planning, name)())
                                  for name in DATED}
    out = {
        "base_date": BASE_DATE.isoformat(),
        "categories": list(examples.GALLERY_CATEGORIES),
        "gallery": gallery,
        "journal_examples": [label for label, _f in examples.JOURNAL_EXAMPLES],
        "dated": dated,
        "calendar_latex_no_today": planning._calendar_latex(2026, 11),
        "a_cases": {repr(args): planning._a(*args) for args in (
            (17.8, 0.7, None), (17.4, None, *[1.1] * 7), (17.0, 1.4, 2.8, None, 5.4),
            (10.0, None, None), (5.0, 1.0, 2.0), (17.0, None, 4.6, 4.6))},
    }
    path = HERE / "tests" / "golden" / "examples.json"
    path.write_text(json.dumps(out, indent=1, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    print(f"{len(gallery)} examples, {len(DATES)} dates -> {path}")


if __name__ == "__main__":
    main()
