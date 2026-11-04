"""Parity corpus for the TypeScript math layout (src/math/mathlayout.ts).

Runs ../KherveTeX's mathlayout over every equation template, symbol,
chemistry preview, the mathbox test corpus and every MathInline/MathBlock in
tests/golden/documents.json, and dumps the box trees (sizes, child offsets,
glyph runs, rules, paths, caret gaps) to tests/golden/math.json.

Two corpora:
Every "exact" entry also carries mathbox's to_latex of the parsed formula
(with {} and with \\square for empty slots), pinning parser + serializer.

- "exact": Qt's glyph measurement is swapped for the font's design metrics
  (the same numbers src/math/fontData.ts holds, advances floored to 1/64 px
  as Qt does). This isolates the layout algorithm: TS must match to 1e-3 px.
- "qt": the real Qt metrics (macOS CoreText) — overall size only, at 20 and
  1000 px. Small sizes carry CoreText's rasteriser padding on glyph ink
  boxes, which no other platform reproduces; the test reports the drift.

    QT_QPA_PLATFORM=offscreen ../KherveTeX/.venv/bin/python scripts/math_golden.py [--png DIR]
"""
from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
SRC = HERE.parent / "KherveTeX"
sys.path.insert(0, str(SRC))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication  # noqa: E402

app = QApplication.instance() or QApplication([])

from fontTools.pens.boundsPen import BoundsPen  # noqa: E402
from fontTools.ttLib import TTFont  # noqa: E402

from khervedoc import chemistry, equations, mathbox as mb, mathlayout as ml  # noqa: E402
from khervedoc import symbols  # noqa: E402
from khervedoc.equation_editor import _CATEGORY_FACES, _symbol_insert_latex  # noqa: E402

EXTRA = [
    r"\hat{x}\widehat{xy}\bar{x}\overline{ab}\vec{v}\overrightarrow{AB}",
    r"\dot{x}\ddot{x}\tilde{x}\widetilde{ab}\acute{e}\grave{e}\check{c}",
    r"\breve{u}\underline{ab}\mathring{A}",
    r"\left( \frac{a}{b} \right) \left[ \frac{a}{b} \right] "
    r"\left\{ \frac{a}{b} \right\}",
    r"\left| \frac{a}{b} \right| \left\| \frac{a}{b} \right\| "
    r"\left\langle \frac{a}{b} \right\rangle",
    r"\left\lfloor \frac{a}{b} \right\rfloor \left\lceil \frac{a}{b} "
    r"\right\rceil \left. \frac{a}{b} \right/",
    r"\left( \frac{\frac{a}{b}}{\frac{c}{d}} \right)",
    r"\begin{matrix} a & b \\ c & d \end{matrix}",
    r"\begin{Bmatrix} a & b \\ c & d \end{Bmatrix}",
    r"\begin{Vmatrix} a & b \\ c & d \end{Vmatrix}",
    r"\begin{smallmatrix} a & b \\ c & d \end{smallmatrix}",
    r"\begin{gathered} a = b \\ c = d \end{gathered}",
    r"\begin{split} a &= b \\ &= c \end{split}",
    r"\sum \prod \coprod \int \iint \iiint \oint \oiint \bigcup \bigcap",
    r"\bigoplus_{i} \bigotimes^{n} \bigodot \bigvee \bigwedge \bigsqcup",
    r"\int_0^1 \oint_C \iint_D \lim_{n \to \infty} \liminf_{n} \limsup_{n}",
    r"\mathbb{RZ} \mathcal{LH} \mathscr{F} \mathfrak{gH} \mathsf{x1} "
    r"\mathtt{x1} \mathbf{x1} \boldsymbol{\alpha x} \mathit{x} \mathrm{dx}",
    r"\text{if } x \text{ and } y",
    r"f'(x) + f''(x) + x^{\prime}",
    r"\dfrac{a}{b} + \tfrac{a}{b} + \cfrac{1}{1+x} + \dbinom{n}{k} "
    r"+ \tbinom{n}{k}",
    r"\sqrt[3]{x} + \sqrt{\frac{a}{b}} + \sqrt{x^2}",
    r"\foo{a} + \ce{H2O} + \square + {}^{14}C",
    r"a \, b \: c \; d \! e \quad f \qquad g \ h ~ i",
    r"x_1^2 + x^{2}_{1} + x_{i_j} + e^{x^2}",
    r"\alpha\beta\gamma\delta\epsilon\varepsilon\vartheta\varphi\phi",
    r"\Gamma\Delta\Theta\Lambda\Xi\Pi\Sigma\Upsilon\Phi\Psi\Omega",
    r"\partial \nabla \infty \hbar \ell \aleph \emptyset",
    r"a - b, -a, a + -b, (-a), a = -b",
    r"\sin x \cos y \log_2 n \ln x \exp(x) \max_i \min \det A",
    r"\operatorname{Tr} A + \operatorname{sgn}(x)",
    r"\{ a, b \}",
    r"\langle a | b \rangle",
    r"x \in A \subseteq B \Rightarrow \forall y \exists z",
]


def collect() -> list[tuple[str, bool]]:
    seen: set[tuple[str, bool]] = set()
    out: list[tuple[str, bool]] = []

    def add(latex: str, display: bool) -> None:
        k = (latex, display)
        if k not in seen:
            seen.add(k)
            out.append(k)

    for _, items in equations.EQUATION_GROUPS:
        for latex, _p in items:
            add(mb.normalize_template(latex), True)
            add(latex, False)
    for _, items in symbols.SYMBOL_GROUPS:
        for latex, _g in items:
            add(_symbol_insert_latex(latex), False)
    for _l, sample in _CATEGORY_FACES:
        add(sample, False)
    for _, items in chemistry.CHEM_GROUPS:
        for body, _l in items:
            add(chemistry.ce_to_mathtext(body), True)
    sys.path.insert(0, str(SRC / "tests"))
    import test_mathbox
    for s in test_mathbox.CORPUS:
        add(s, True)
        add(s, False)
    for s in EXTRA:
        add(s, True)
        add(s, False)
    docs = json.loads((HERE / "tests/golden/documents.json").read_text())
    found: list[tuple[str, bool]] = []

    def walk(o):
        if isinstance(o, dict):
            if o.get("type") in ("MathInline", "MathBlock"):
                found.append((o["latex"], o["type"] == "MathBlock"))
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
        elif isinstance(o, str) and o[:1] == "{":
            try:
                walk(json.loads(o))
            except ValueError:
                pass

    walk(docs)
    for latex, disp in sorted(set(found)):
        add(latex, disp)
    return out


# ---------------------------------------------------------- design metrics

_font = None


def _design():
    global _font
    if _font is None:
        path = ml._find_math_font()
        f = TTFont(str(path))
        gs = f.getGlyphSet()
        cmap = f.getBestCmap()
        table = {}
        for cp, name in cmap.items():
            bp = BoundsPen(gs)
            gs[name].draw(bp)
            table[cp] = (f["hmtx"][name][0], bp.bounds)
        _font = table
    return _font


def _q(v: float) -> float:
    return math.floor(v * 64) / 64


def design_metrics(font, text):
    px = font.pixelSize()
    if font.family() == "Menlo":
        return (sum(_q(1233 / 2048 * px) for _ in text), 0.0, 0.0, 0.0)
    t = _design()
    pen = 0.0
    x0 = y0 = 1e9
    x1 = y1 = 0.0
    for ch in text:
        adv, b = t.get(ord(ch), (500, (0, 0, 0, 0)))
        if b is None:
            b = (0, 0, 0, 0)
        s = px / 1000
        x0 = min(x0, pen + b[0] * s)
        x1 = max(x1, pen + b[2] * s)
        y0 = min(y0, -b[3] * s)
        y1 = max(y1, -b[1] * s)
        pen += _q(adv * s)
    if not text:
        return (0.0, 0.0, 0.0, 0.0)
    return (pen, max(0.0, -y0), max(0.0, y1), x1)


class _MonoMetrics:
    def __init__(self, font):
        self.px = font.pixelSize()

    def horizontalAdvance(self, text):
        return sum(_q(1233 / 2048 * self.px) for _ in text)


# ------------------------------------------------------------ box dump

def r4(v: float) -> float:
    return round(float(v), 4)


def dump(box: ml.Box) -> dict:
    d = {"w": r4(box.w), "a": r4(box.asc), "d": r4(box.desc)}
    if box.em:
        d["em"] = r4(box.em)
    if box.italic:
        d["it"] = 1
    if box.charlike:
        d["ch"] = 1
    if box.ink_r is not None:
        d["ir"] = r4(box.ink_r)
    if box.row is not None:
        d["g"] = [r4(g) for g in box.gaps]
    ops = []
    for op in box.ops:
        k = op[0]
        if k == "t":
            ops.append(["t", r4(op[1]), r4(op[2]), op[3].pixelSize(), op[4]])
        elif k == "rule":
            ops.append(["rule"] + [r4(v) for v in op[1:5]])
        elif k in ("stroke", "fill"):
            r = op[1].controlPointRect()
            ops.append([k, r4(r.x()), r4(r.y()), r4(r.width()),
                        r4(r.height()), r4(op[2]), op[1].elementCount()])
        elif k == "ph":
            ops.append(["ph"] + [r4(v) for v in op[1:5]])
        elif k == "chip":
            ops.append(["chip"] + [r4(v) for v in op[1:5]]
                       + [op[5], op[6].pixelSize(), op[7]])
    if ops:
        d["o"] = ops
    if box.kids:
        d["k"] = [[r4(dx), r4(dy), dump(b)] for dx, dy, b in box.kids]
    return d


def main() -> None:
    corpus = collect()
    real_gm, real_fm = ml.glyph_metrics, ml.QFontMetricsF
    qt = []
    sizes = (20.0, 1000.0)
    for latex, disp in corpus:
        row = mb.parse_latex(latex)
        e = {"latex": latex, "display": disp}
        for px in sizes:
            b = ml.Layout(px, disp).layout(row)
            e[str(int(px))] = [r4(b.w), r4(b.asc), r4(b.desc)]
        qt.append(e)
    ml.glyph_metrics = design_metrics
    ml.QFontMetricsF = _MonoMetrics
    exact = []
    for latex, disp in corpus:
        px = 32.0 if disp else 20.0
        row = mb.parse_latex(latex)
        b = ml.Layout(px, disp).layout(row)
        exact.append({"latex": latex, "display": disp, "px": px,
                      "tex": mb.to_latex(row),
                      "texph": mb.to_latex(row, mb.PLACEHOLDER),
                      "box": dump(b)})
    ml.glyph_metrics, ml.QFontMetricsF = real_gm, real_fm
    out = HERE / "tests/golden/math.json"
    out.write_text(json.dumps({"exact": exact, "qt": qt},
                              ensure_ascii=False, separators=(",", ":")))
    print(f"{len(corpus)} formulas -> {out} "
          f"({out.stat().st_size // 1024} KiB)")
    if "--png" in sys.argv:
        d = Path(sys.argv[sys.argv.index("--png") + 1])
        d.mkdir(parents=True, exist_ok=True)
        from PySide6.QtCore import Qt
        from PySide6.QtGui import QColor, QImage, QPainter
        for i, (latex, disp) in enumerate(DEV_SAMPLES):
            img = ml.render_image(mb.parse_latex(latex), 24, disp, 2.0)
            bg = QImage(img.size(), QImage.Format_ARGB32)
            bg.setDevicePixelRatio(img.devicePixelRatio())
            bg.fill(QColor("white"))
            p = QPainter(bg)
            p.drawImage(0, 0, img)
            p.end()
            bg.save(str(d / f"py_{i:02d}.png"))
        print(f"{len(DEV_SAMPLES)} PNGs -> {d}")


DEV_SAMPLES = [
    (r"x^2 + \frac{1}{y}", True),
    (r"\sum_{i=1}^{n} \binom{n}{k} x^k", True),
    (r"\int_{-\infty}^{\infty} e^{-x^2} \, dx = \sqrt{\pi}", True),
    (r"\left( \frac{\frac{a}{b}}{c} \right) \left\{ x \right\}", True),
    (r"\begin{pmatrix} a & b \\ c & d \end{pmatrix}", True),
    (r"\begin{cases} x & \text{if } x > 0 \\ -x & \text{otherwise} \end{cases}",
     True),
    (r"\hat{x}\bar{y}\vec{v}\tilde{n}\dot{a}\ddot{b}", True),
    (r"\sqrt[3]{x^2+1} + \mathbb{R} + \mathcal{L}", True),
    (r"\lim_{x \to 0} \frac{\sin x}{x} = 1", False),
    (r"\frac{\square}{\square} + \foo{a}", True),
]


if __name__ == "__main__":
    main()
