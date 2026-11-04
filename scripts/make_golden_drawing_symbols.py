"""Write the drawing-symbol parity corpus (tests/golden/drawing_symbols.json).

Runs the Python KherveTeX symbol libraries (khervedoc/paint/flowchart.py,
electrical, optics, maths, labware, arrows) and the chemistry geometry, and
stores what they produce. tests/paintSymbols.test.ts requires the
TypeScript port to produce the same specs.

    cd ../KherveTeX && QT_QPA_PLATFORM=offscreen .venv/bin/python \\
        ../KherveTeX-React/scripts/make_golden_drawing_symbols.py [path/to/KherveTeX]
"""
from __future__ import annotations

import importlib
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE.parent / "KherveTeX"
sys.path.insert(0, str(SRC))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import QPointF  # noqa: E402

from khervedoc.paint import chemistry  # noqa: E402
from khervedoc.paint.document import painterpath_to_cmds  # noqa: E402

# authoring.LIBRARIES, and the page scale authoring.new_scene gives
# PaintScene (symbol_page_px / symbol_min_px).
LIBRARIES = ("flowchart", "electrical", "optics", "maths", "labware", "arrows")
SYMBOL_PAGE_PX = 900
SYMBOL_MIN_PX = 90
OTHER_SIZE = (137.5, 61.25)


def placed_size(module, name):
    """The (w, h) PaintScene._place_symbol builds the symbol at."""
    w_mm, h_mm = module.size_mm(name)
    ref = getattr(module, "REFERENCE_MM", 4800.0)
    scale = (SYMBOL_PAGE_PX or 1) / ref
    w = w_mm * scale
    h = h_mm * scale
    if 0 < max(w, h) < SYMBOL_MIN_PX:
        k = SYMBOL_MIN_PX / max(w, h)
        w, h = w * k, h * k
    return w, h


def symbols():
    out = {}
    for lib in LIBRARIES:
        mod = importlib.import_module(f"khervedoc.paint.{lib}")
        cases = []
        for name in mod.SIZES:
            for w, h in (placed_size(mod, name), OTHER_SIZE):
                cases.append({"name": name, "w": w, "h": h,
                              "specs": mod.build_specs(name, w, h)})
        out[lib] = {
            "reference_mm": mod.REFERENCE_MM,
            "sizes": {k: list(v) for k, v in mod.SIZES.items()},
            "labels": getattr(mod, "LABELS", {}),
            "categories": [[t, list(n)] for t, n in getattr(mod, "CATEGORIES", None) or []]
            if hasattr(mod, "CATEGORIES") else None,
            "cases": cases,
        }
    return out


def _pt(p: QPointF):
    return {"x": p.x(), "y": p.y()}


def chem():
    points = [
        ((10.0, 20.0), (60.0, 20.0)),
        ((0.0, 0.0), (37.3, -21.9)),
        ((100.5, 40.25), (80.0, 95.0)),
        ((5.0, 5.0), (5.4, 5.3)),          # shorter than 1 px: empty path
        ((-12.0, 3.0), (-12.0, 140.0)),
    ]
    gaps = [6.0, 0.4, 13.7]
    bonds, wedges = [], []
    for (a, b) in points:
        p1, p2 = QPointF(*a), QPointF(*b)
        for gap in gaps:
            for kind in ("single", "double", "triple", "hash", "hbond", "zigzag"):
                path = chemistry.bond_path(kind, p1, p2, gap)
                bonds.append({"kind": kind, "p1": list(a), "p2": list(b), "gap": gap,
                              "cmds": painterpath_to_cmds(path)})
            wedges.append({"p1": list(a), "p2": list(b), "gap": gap,
                           "poly": [_pt(q) for q in chemistry.wedge_polygon(p1, p2, gap)]})
    rings = []
    for kind in ("benzene", "cyclohexane", "cyclopentane", "unknown"):
        for c, r in (((50.0, 50.0), 30.0), ((-7.5, 210.25), 17.3)):
            rings.append({"kind": kind, "center": list(c), "r": r,
                          "poly": [_pt(q) for q in chemistry.ring_polygon(kind, QPointF(*c), r)],
                          "aromatic": chemistry.is_aromatic(kind)})
    return {"atoms": chemistry.ATOMS, "ring_sides": chemistry._RING_SIDES,
            "bonds": bonds, "wedges": wedges, "rings": rings}


def main():
    corpus = {"page_px": SYMBOL_PAGE_PX, "min_px": SYMBOL_MIN_PX,
              "other_size": list(OTHER_SIZE), "symbols": symbols(),
              "chemistry": chem()}
    dest = HERE / "tests" / "golden" / "drawing_symbols.json"
    dest.write_text(json.dumps(corpus, indent=1, ensure_ascii=False) + "\n",
                    encoding="utf-8")
    n = sum(len(m["cases"]) for m in corpus["symbols"].values())
    print(f"wrote {dest} ({n} symbol cases, "
          f"{len(corpus['chemistry']['bonds'])} bonds)")


if __name__ == "__main__":
    main()
