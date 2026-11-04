"""Write the parity corpus for the drawing and flowchart features.

Runs the Python KherveTeX (../KherveTeX, or the path given) offscreen:

* the flowchart model (khervedoc/flowchart.py): a corpus of charts built
  by a small list of operations that tests/flowchart.parity.test.ts
  replays, with the JSON, TikZ, standalone document and Tidy-up layout
  Python writes for each;
* the flowchart builder's editor geometry (flowchart_builder.py: the box
  rectangles and every arrow's drawn points) and its box-text HTML;
* the drawing engine (khervedoc/paint): a corpus of scenes saved as SVG
  (svgio.save_svg) and read back, with each item's geometry.

    QT_QPA_PLATFORM=offscreen ../KherveTeX/.venv/bin/python \
        scripts/make_golden_drawing.py [path/to/KherveTeX]
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
HERE = Path(__file__).resolve().parent.parent
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
SRC = Path(ARGS[0]).resolve() if ARGS else HERE.parent / "KherveTeX"
sys.path.insert(0, str(SRC))

from PySide6.QtWidgets import QApplication  # noqa: E402

APP = QApplication.instance() or QApplication([])

from khervedoc import flowchart as F  # noqa: E402

OUT = HERE / "tests" / "golden"


# ======================================================== flowchart model
def num(v):
    """A number as [value, is_float] so the TS side knows Python's type."""
    return [v, isinstance(v, float)]


def unnum(v):
    if isinstance(v, list) and len(v) == 2 and isinstance(v[1], bool):
        return float(v[0]) if v[1] else int(v[0])
    return v


def run_ops(ops):
    fc = F.Flowchart()
    for op in ops:
        kind, args = op[0], [unnum(a) for a in op[1:]]
        if kind == "new":
            fc = F.Flowchart(**{k: unnum(v) for k, v in args[0].items()})
        elif kind == "template":
            fc = F.TEMPLATES[args[0]]()
        elif kind == "add":
            fc.add(args[0], args[1], after=args[2], label=args[3])
        elif kind == "node":
            fc.nodes.append(F.Node(*args))
        elif kind == "connect":
            fc.connect(*args)
        elif kind == "remove":
            fc.remove(args[0])
        elif kind == "edge":
            setattr(fc.edges[args[0]], args[1], args[2])
        elif kind == "nodefield":
            setattr(fc.node(args[0]), args[1], args[2])
        elif kind == "chart":
            setattr(fc, args[0], args[1])
        elif kind == "layout":
            F.auto_layout(fc)
        elif kind == "swap":
            for n in fc.nodes:
                n.x, n.y = n.y, n.x
        elif kind == "load":
            fc = F.Flowchart.from_json(args[0])
        elif kind == "roundtrip":
            fc = F.Flowchart.from_json(fc.to_json())
        else:
            raise ValueError(kind)
    return fc


def flow_cases():
    cases = {}
    for name in F.TEMPLATES:
        cases[f"template {name}"] = [["template", name]]
        cases[f"template {name} tidy"] = [["template", name], ["layout"]]
        cases[f"template {name} swapped"] = [["template", name], ["swap"],
                                             ["chart", "direction", "LR"]]
        for scheme in F.SCHEME_NAMES + ["Presentation colours"]:
            cases[f"template {name} {scheme}"] = [
                ["template", name], ["chart", "scheme", scheme]]
    cases["empty"] = []
    cases["empty LR"] = [["new", {"direction": "LR"}]]
    chain = [["add", "terminal", "Start", None, ""],
             ["add", "process", "", "n1", ""],
             ["add", "decision", "OK?", "n2", ""],
             ["add", "process", "side", "n2", ""]]
    cases["chain sidestep"] = chain
    cases["chain no after"] = [["add", k, "", None, ""] for k in F.KINDS]
    cases["chain LR no after"] = [["new", {"direction": "LR"}]] + \
        [["add", k, "", None, ""] for k in F.KINDS]
    cases["all kinds chained"] = [["add", "terminal", "Start", None, ""]] + [
        ["add", k, f"{k} box", f"n{i + 1}", "e" if i % 2 else ""]
        for i, k in enumerate(F.KINDS)]
    heads = chain + [["edge", 0, "head", "both"], ["edge", 1, "head", "none"],
                     ["edge", 1, "dashed", True], ["edge", 2, "head", "start"]]
    cases["heads and dashes"] = heads
    sides = []
    for s in F.SIDES:
        for d in F.SIDES:
            for route in ("auto", "straight", "elbow", "curve"):
                key = f"sides {s} {d} {route}"
                cases[key] = [["add", "process", "A", None, ""],
                              ["add", "process", "B", "n1", "lbl"],
                              ["nodefield", "n2", "x", num(1.5)],
                              ["edge", 0, "src_side", s],
                              ["edge", 0, "dst_side", d],
                              ["edge", 0, "route", route]]
                sides.append(key)
    for bend in (30, -45, 0, 90, 12.5):
        cases[f"curve bend {bend}"] = [
            ["add", "process", "A", None, ""],
            ["add", "process", "B", "n1", ""],
            ["edge", 0, "route", "curve"], ["edge", 0, "bend", num(bend)]]
    cases["custom fills"] = chain + [["nodefield", "n1", "fill", "#ff0000"],
                                     ["nodefield", "n3", "fill", "#00Aa00"],
                                     ["nodefield", "n4", "kind", "unknown"]]
    for pt in (6, 9, 12, 13, 24, 10.5):
        cases[f"font {pt}"] = chain + [["chart", "font_pt", num(pt)]]
    cases["spacing"] = chain + [["chart", "col_cm", num(2)],
                                ["chart", "row_cm", num(1.25)]]
    cases["loop back TB"] = [["add", "process", "A", None, ""],
                             ["add", "process", "B", "n1", ""],
                             ["add", "process", "C", "n2", ""],
                             ["connect", "n3", "n1", "again"]]
    cases["loop back LR"] = [["new", {"direction": "LR"}]] + \
        cases["loop back TB"]
    cases["elbows"] = [["add", "decision", "D", None, ""],
                       ["node", "x1", "process", "R", num(1.0), num(1.0), ""],
                       ["node", "x2", "process", "L", num(-1.0), num(2.0), ""],
                       ["connect", "n1", "x1", "Yes"], ["connect", "x1", "x2", ""],
                       ["connect", "x2", "n1", ""]]
    cases["elbows LR"] = [["new", {"direction": "LR"}]] + cases["elbows"][0:]
    cases["remove"] = chain + [["remove", "n2"]]
    cases["int positions"] = [["node", "a", "process", "a", num(5), num(5), ""],
                              ["node", "b", "process", "b", num(0), num(0), ""],
                              ["add", "process", "", "b", ""],
                              ["add", "process", "", None, ""]]
    cases["int positions swapped"] = cases["int positions"] + [["swap"]]
    cases["layout ranks"] = [
        ["node", i, "process", i, num(5), num(5), ""] for i in "abcd"] + [
        ["connect", "a", "b", ""], ["connect", "a", "c", ""],
        ["connect", "b", "d", ""], ["connect", "c", "d", ""],
        ["connect", "d", "a", ""], ["layout"]]
    cases["layout cycle only"] = [
        ["node", i, "process", i, num(1.0), num(2.0), ""] for i in "xyz"] + [
        ["connect", "x", "y", ""], ["connect", "y", "z", ""],
        ["connect", "z", "x", ""], ["layout"]]
    cases["layout LR"] = [["template", "Algorithm (sum to n)"],
                          ["chart", "direction", "LR"], ["layout"]]
    cases["dangling edge"] = chain + [["edge", 0, "dst", "zz"]]
    cases["text escapes"] = [["add", "process", 'quote " back \\ uni é ☃ tab\t', None, ""]]
    old = json.loads(F.template_simple().to_json())
    for e in old["edges"]:
        for k in ("head", "src_side", "dst_side", "bend"):
            e.pop(k)
    old["nodes"][0]["x"] = 2
    old["font_pt"] = 12.0
    old["row_cm"] = 2
    cases["load old json"] = [["load", json.dumps(old)]]
    cases["load old json roundtrip"] = [["load", json.dumps(old)],
                                        ["roundtrip"]]
    cases["load slide"] = [["load", json.dumps({
        "nodes": [{"id": "n1", "kind": "process", "text": "a", "x": 0, "y": 0}],
        "edges": [], "scheme": "Presentation colours"})]]
    out = {}
    for name, ops in cases.items():
        fc = run_ops(ops)
        tidy = F.Flowchart.from_json(fc.to_json())
        F.auto_layout(tidy)
        out[name] = {"ops": ops, "json": fc.to_json(), "tikz": F.to_tikz(fc),
                     "standalone": F.standalone_doc(fc),
                     "tidy": tidy.to_json(),
                     "colours": {k: list(v) for k, v in F.colours(fc).items()}}
    return out


# ================================================ flowchart builder bits
def builder_geometry(charts):
    """Box rectangles and drawn arrow points of the builder's editor."""
    from khervedoc import flowchart_builder as FB
    out = {}
    for name, entry in charts.items():
        fc = F.Flowchart.from_json(entry["json"])
        items = {}
        nodes = {}
        for n in fc.nodes:
            fill, text = F.colours(fc).get(n.kind, ("#FFFFFF", "#000000"))
            it = FB.NodeItem(n, fill, text)
            items[n.id] = it
            r = it.rect
            nodes[n.id] = {"pos": [it.pos().x(), it.pos().y()],
                           "rect": [r.x(), r.y(), r.width(), r.height()]}
        edges = []
        for e in fc.edges:
            a, b = items.get(e.src), items.get(e.dst)
            if not (a and b):
                edges.append(None)
                continue
            ei = FB.EdgeItem(e, a, b, fc.direction)
            edges.append([[p.x(), p.y()] for p in ei._pts])
        out[name] = {"nodes": nodes, "edges": edges}
    return out


def builder_html():
    from khervedoc import flowchart_builder as FB
    samples = ["Start", "$i \\le n$? 50\\% -- <ok>", "$x^2$", "$a_{ij}$",
               "Read $n$", "$i \\leftarrow 1$, $s \\leftarrow 0$",
               "$s \\leftarrow s + i$", "a --- b \\& c \\_ d \\# e~f",
               "\\(\\alpha + \\beta\\)", "cost \\$5 and $\\to$",
               "$x_{1}^{2} \\cdot y$", "$\\Gamma \\, \\Delta \\; \\ne$",
               "$\\unknownmacro x$", "{braces} $\\{x\\}$", "a & b < c > d"]
    return {s: FB._pretty_inline_html(s) for s in samples}


def builder_symbols():
    from khervedoc import flowchart_builder as FB
    return FB._symbol_map()


def flowchart_files(tmp: Path):
    import pymupdf
    from khervedoc import flowchart_builder as FB
    out = {}
    for w in (283.0, 2000.0, 100.0, 200.0, 425.1968):
        doc = pymupdf.open()
        doc.new_page(width=w, height=200)
        data = doc.tobytes()
        doc.close()
        out[str(w)] = FB.natural_width(data)
    return out


# ===================================================== the drawing engine
def _pen(color="#ff1a1a1a", width=2.0, dash=None, none=False):
    d = {"color": color, "width": width}
    if none:
        d["none"] = True
    elif dash:
        d["dash"] = dash
    return d


def _common(x=0.0, y=0.0, rot=0.0, op=1.0, z=0.0, scale=1.0, **kw):
    d = {"pos": {"x": x, "y": y}, "opacity": op, "rotation": rot, "z": z,
         "scale": scale}
    d.update(kw)
    return d


def paint_scenes():
    """Scenes as .kpaint item dicts: both sides build them with
    item_from_dict and save them as SVG."""
    from khervedoc.paint import canvas as C
    from PySide6.QtCore import QRectF
    grad = lambda kind, c1="#ffffffff", c2="#ff1a6dd8", angle=90.0: {  # noqa
        "gradient": {"kind": kind, "c1": c1, "c2": c2, "angle": angle}}
    scenes = {}
    scenes["populate"] = [
        {"type": "roundrect", "pen": _pen(), "brush": grad("linear"),
         "radius": 10, "x": 10, "y": 20, "w": 120, "h": 60, **_common()},
        {"type": "arrow", "pen": _pen("#ffd8000c", 3, "dash"), "x1": 140,
         "y1": 50, "x2": 260, "y2": 50, "head": "double", **_common(z=1)},
        {"type": "polygon", "pen": _pen(), "brush": None, "kind": "hexagon",
         "points": [[p.x(), p.y()] for p in C.polygon_for_kind(
             "hexagon", QRectF(280, 10, 90, 80))], **_common(z=2)},
        {"type": "dimension", "pen": _pen(), "x1": 10, "y1": 120, "x2": 130,
         "y2": 120, "capStyle": "arrows", "extension": False, "dash": False,
         "unit": "mm", "decimals": 1, "prefix": "", "suffix": "",
         **_common(z=3)},
        {"type": "text", "text": "Label", "color": "#ff1a1a1a",
         "family": "Helvetica", "size": 14, "bold": False, "italic": False,
         **_common(30, 150, z=4)},
    ]
    shapes = []
    z = 0
    for kind in C.POLYGON_KINDS:
        r = QRectF(10 + 40 * (z % 8), 10 + 50 * (z // 8), 37.5, 41.25)
        shapes.append({"type": "polygon", "pen": _pen(), "brush": None,
                       "kind": kind, "points": [[p.x(), p.y()] for p in
                                                C.polygon_for_kind(kind, r)],
                       **_common(z=z)})
        z += 1
    for kind in C.ARC_KINDS:
        for fh in (False, True):
            for fv in (False, True):
                shapes.append({"type": "arc", "kind": kind, "pen": _pen(),
                               "brush": {"color": "#ff4aa3ff"},
                               "x": 13.7 * z, "y": 200.25, "w": 61.3,
                               "h": 33.3, "flipH": fh, "flipV": fv,
                               **_common(z=z)})
                z += 1
    scenes["shapes"] = shapes
    scenes["styles"] = [
        {"type": "rect", "pen": _pen("#80102030", 1.5, "dot"),
         "brush": {"color": "#40ff0000"}, "x": 5, "y": 6, "w": 70, "h": 40,
         **_common()},
        {"type": "ellipse", "pen": _pen("#ff000000", 4, "dashdot"),
         "brush": grad("radial", "#ff4aa3ff", "#ffffffff"),
         "x": 100, "y": 10, "w": 80, "h": 50, **_common(z=1)},
        {"type": "ellipse", "pen": _pen(none=True),
         "brush": grad("sun", "#ff5b8fd9", "#ffffffff"),
         "x": 200, "y": 10, "w": 60, "h": 60, **_common(z=2)},
        {"type": "rect", "pen": _pen(), "brush": grad("linear", angle=33.3),
         "x": 300, "y": 10, "w": 60, "h": 40, **_common(z=3)},
        {"type": "rect", "pen": _pen(), "brush": grad("linear", angle=-120),
         "x": 300, "y": 60, "w": 60, "h": 40, **_common(z=4)},
        {"type": "line", "pen": _pen("#ff0a8f3c", 0.5), "x1": 0, "y1": 0,
         "x2": 33.333333, "y2": 1e-5, **_common(z=5)},
        {"type": "line", "pen": _pen(), "x1": 10, "y1": 300, "x2": 200,
         "y2": 300, "bend": [105, 250], **_common(z=6)},
        {"type": "arrow", "pen": _pen(), "x1": 10, "y1": 350, "x2": 200,
         "y2": 350, "bend": [105, 400], "head": "stealth", **_common(z=7)},
        {"type": "arrow", "pen": _pen(), "x1": 10, "y1": 380, "x2": 200,
         "y2": 390, "head": "open", **_common(z=8)},
        {"type": "dimension", "pen": _pen("#ff222222", 1), "x1": 0, "y1": 450,
         "x2": 300, "y2": 470, "capStyle": "ticks", "extension": True,
         "dash": True, "unit": "cm", "decimals": 2, "prefix": "L = ",
         "suffix": " (approx)", **_common(z=9)},
        {"type": "path", "pen": _pen(), "brush": None,
         "cmds": [["M", 1, 2], ["L", 30.5, 40.25], ["C", 50, 60, 70, 80, 90, 1],
                  ["L", 1, 2]], **_common(z=10)},
        {"type": "text", "text": "Bold <&> \"q\"\nline 2", "color": "#ff1a6dd8",
         "family": "Georgia", "size": 18, "bold": True, "italic": True,
         **_common(400, 300, z=11)},
        {"type": "text", "text": "", "color": "#ff000000",
         "family": "Helvetica", "size": 9, "bold": False, "italic": False,
         **_common(400, 350, z=12)},
    ]
    scenes["labels"] = [
        {"type": "rect", "pen": _pen(), "brush": None, "x": 10, "y": 10,
         "w": 100, "h": 50, "label": "A & B", "labelColor": "#ffd8000c",
         "labelFamily": "Helvetica", "labelSize": 12, "labelBold": True,
         "labelItalic": True, **_common()},
        {"type": "ellipse", "pen": _pen(), "brush": {"color": "#ffffffff"},
         "x": 130, "y": 10, "w": 90, "h": 60, "label": "Hello",
         "labelColor": "#ff1a1a1a", "labelFamily": "Helvetica",
         "labelSize": 14, "labelBold": False, "labelItalic": False,
         **_common(5, 7, z=1)},
        {"type": "polygon", "pen": _pen(), "brush": None, "kind": "diamond",
         "points": [[300, 10], [340, 40], [300, 70], [260, 40]],
         "label": "Q?", "labelColor": "#ff000000", "labelFamily": "Arial",
         "labelSize": 10, "labelBold": False, "labelItalic": False,
         **_common(z=2)},
        {"type": "roundrect", "pen": _pen(), "brush": None, "radius": 30,
         "x": 10, "y": 100, "w": 120, "h": 40, "label": "round",
         "labelColor": "#ff1a1a1a", "labelFamily": "Helvetica",
         "labelSize": 14, "labelBold": False, "labelItalic": False,
         **_common(z=3)},
    ]
    scenes["transforms"] = [
        {"type": "rect", "pen": _pen(), "brush": None, "x": 10, "y": 10,
         "w": 100, "h": 50, **_common(20, 30, 30)},
        {"type": "rect", "pen": _pen(), "brush": None, "x": 10, "y": 10,
         "w": 100, "h": 50, **_common(-5.5, 0, 0, 0.5, z=1)},
        {"type": "ellipse", "pen": _pen(), "brush": None, "x": 100, "y": 100,
         "w": 80, "h": 40, **_common(10, 10, 45, 1.0, z=2, scale=1.5)},
        {"type": "polygon", "pen": _pen(), "brush": None, "kind": "triangle",
         "points": [[0, 0], [50, 0], [25, 40]], **_common(300, 200, -90, z=3)},
        {"type": "group", "children": [
            {"type": "rect", "pen": _pen(), "brush": None, "x": 0, "y": 0,
             "w": 30, "h": 30, **_common(5, 5)},
            {"type": "line", "pen": _pen(), "x1": 0, "y1": 0, "x2": 30,
             "y2": 30, **_common(5, 5, z=1)},
            {"type": "group", "children": [
                {"type": "ellipse", "pen": _pen(), "brush": None, "x": 40,
                 "y": 40, "w": 20, "h": 20, **_common()}],
             # (a scaled or rotated child of a group crashes svgio:
             # itemTransform returns a tuple in PySide6)
             **_common(2, 3, 0, 1.0, z=2)},
        ], **_common(100, 300, 0, 0.75, z=4, symbol="flowchart:process")},
        {"type": "group", "children": [
            {"type": "rect", "pen": _pen(), "brush": None, "x": 0, "y": 0,
             "w": 40, "h": 20, **_common()}],
         "matrix": [1.5, 0, 0, 0.5, -10, 5], **_common(400, 400, z=5)},
    ]
    return scenes


def paint_geometry():
    from khervedoc.paint import canvas as C
    from khervedoc.paint.document import painterpath_to_cmds
    from PySide6.QtCore import QRectF
    out = {"polygons": {}, "arcs": {}}
    for r in ((0, 0, 100, 50), (12.5, -3.25, 37.5, 81.1), (5, 5, 0, 10)):
        rect = QRectF(*r)
        for kind in list(C.POLYGON_KINDS) + ["polygon"]:
            out["polygons"][f"{kind} {r}"] = [
                [p.x(), p.y()] for p in C.polygon_for_kind(kind, rect)]
        for kind in C.ARC_KINDS:
            for fh in (False, True):
                for fv in (False, True):
                    out["arcs"][f"{kind} {r} {fh} {fv}"] = painterpath_to_cmds(
                        C.arc_path(kind, rect, fh, fv))
    from PySide6.QtGui import QPainterPath
    shapes = {}
    for r in ((0, 0, 100, 50), (3.5, 5.5, 17, 13), (10, 20, 120, 60)):
        p = QPainterPath()
        p.addEllipse(QRectF(*r))
        shapes[f"ellipse {r}"] = painterpath_to_cmds(p)
        for rad in (4, 10, 12, 30, 100):
            p = QPainterPath()
            rr = min(rad, r[2] / 2, r[3] / 2)
            p.addRoundedRect(QRectF(*r), rr, rr)
            shapes[f"roundrect {r} {rad}"] = painterpath_to_cmds(p)
    for (sa, sw) in ((0, 270), (180, -180), (30, 100), (45, -300), (0, 360),
                     (90, 45)):
        p = QPainterPath()
        p.arcMoveTo(QRectF(5, 5, 14, 14), sa)
        p.arcTo(QRectF(5, 5, 14, 14), sa, sw)
        shapes[f"arc {sa} {sw}"] = painterpath_to_cmds(p)
    out["paths"] = shapes
    return out


def paint_corpus():
    from khervedoc.paint import document, export, svgio
    from khervedoc.paint.authoring import new_scene
    from khervedoc.paint.canvas import TextItem
    out = {"scenes": {}, "geometry": paint_geometry()}
    with tempfile.TemporaryDirectory() as td:
        for name, items in paint_scenes().items():
            for grid in ((5.0, True, False, True), (1.0, False, True, False)):
                scene = new_scene()
                scene.grid_mm, scene.show_grid, scene.snap_enabled, \
                    scene.infinite = grid
                for d in items:
                    scene.addItem(document.item_from_dict(d))
                path = Path(td) / f"{name}.svg"
                export.save_svg(scene, path)
                svg = path.read_text(encoding="utf-8")
                back = new_scene()
                export.load_svg(back, path)
                has_text = any(isinstance(i, TextItem)
                               for i in scene.items())
                rect = export.content_rect(scene)
                key = f"{name} grid={grid[0]}"
                out["scenes"][key] = {
                    "items": items,
                    "grid": list(grid),
                    "svg": svg,
                    "reloaded": [document.item_to_dict(i)
                                 for i in back.vector_items()],
                    "reloaded_svg": _resave(back, Path(td) / "again.svg"),
                    "content_rect": None if has_text else
                    [rect.x(), rect.y(), rect.width(), rect.height()],
                    "bounds": [None if isinstance(i, TextItem) else
                               _rect(i.sceneBoundingRect())
                               for i in scene.vector_items()],
                }
    return out


def _rect(r):
    return [r.x(), r.y(), r.width(), r.height()]


def _resave(scene, path):
    from khervedoc.paint import export
    export.save_svg(scene, path)
    return path.read_text(encoding="utf-8")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    charts = flow_cases()
    with tempfile.TemporaryDirectory() as td:
        widths = flowchart_files(Path(td))
    flow = {"charts": charts, "geometry": builder_geometry(charts),
            "html": builder_html(), "natural_width": widths,
            "kinds": {k: list(v) for k, v in F.KINDS.items()},
            "schemes": {k: {kk: list(vv) for kk, vv in v.items()}
                        for k, v in F.SCHEMES.items()}}
    (OUT / "flowchart.json").write_text(
        json.dumps(flow, indent=1, ensure_ascii=False) + "\n",
        encoding="utf-8")
    (HERE / "src" / "drawing" / "flowSymbols.json").write_text(
        json.dumps(builder_symbols(), indent=0, ensure_ascii=False) + "\n",
        encoding="utf-8")
    if "--flowchart-only" not in sys.argv:
        (OUT / "drawing.json").write_text(
            json.dumps(paint_corpus(), indent=1, ensure_ascii=False) + "\n",
            encoding="utf-8")
    print("wrote", OUT / "flowchart.json")


if __name__ == "__main__":
    main()
