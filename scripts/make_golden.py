"""Write the parity corpus the TypeScript port is tested against.

Runs the Python KherveTeX (../KherveTeX, or the path given) over every
gallery example, every offered document class and a set of meta variants,
and stores what Python produces: document.json, the LaTeX, the Typst, and
what the .tex importer reads back from that LaTeX. tests/parity.test.ts
requires the TypeScript code to produce exactly the same bytes.

    python3 scripts/make_golden.py [path/to/KherveTeX]
"""
from __future__ import annotations

import copy
import json
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE.parent / "KherveTeX"
sys.path.insert(0, str(SRC))

from khervedoc import model  # noqa: E402
from khervedoc.examples import GALLERY  # noqa: E402
from khervedoc.importers import import_md, import_tex  # noqa: E402
from khervedoc.serializer import (  # noqa: E402
    serialize_chapter_body, serialize_document, serialize_project_master,
)
from khervedoc.typst_serializer import serialize_document as to_typst  # noqa: E402

TEMPLATE_CHOICES = [
    "article", "report", "book", "letter", "beamer", "memoir",
    "scrartcl", "scrreprt", "scrbook", "scrlttr2",
    "elsarticle", "IEEEtran", "revtex4-2", "achemso", "amsart",
    "llncs", "acmart", "sn-jnl", "mnras",
    "tufte-handout", "tufte-book", "mimosis",
    "hepthesis", "suftesi", "toptesi", "disser",
    "amsbook", "elegantbook", "apa7", "moderncv", "europasscv",
    "tikzposter", "a0poster", "exam", "standalone",
]

OUT = HERE / "tests" / "golden"


def slug(s: str) -> str:
    return "".join(c if c.isalnum() else "-" for c in s.lower()).strip("-")


def safe(fn, *a):
    try:
        return fn(*a)
    except Exception as e:  # a crash is part of the behaviour to match
        return f"!ERROR {type(e).__name__}"


def case(cases: dict, name: str, doc: model.Document, importer=True) -> None:
    doc_json = model.to_json(doc)
    tex = safe(serialize_document, doc)
    entry = {
        "document_json": doc_json,
        "tex": tex,
        "typst": safe(to_typst, doc),
        "chapter_body": safe(serialize_chapter_body, doc),
    }
    if importer and not tex.startswith("!ERROR"):
        imported = safe(import_tex, tex)
        entry["imported_json"] = (imported if isinstance(imported, str)
                                  else model.to_json(imported))
    cases[name] = entry


def meta_variants(base: model.Document):
    m = base.meta
    yield "margins", dict(margin_top_cm=2.0, margin_bottom_cm=3.0,
                          margin_left_cm=1.75, margin_right_cm=2.0)
    for ls in (1.15, 1.5, 2.0, 3.0):
        yield f"spacing-{ls}", dict(line_spacing=ls)
    for cols in (2, 3):
        yield f"cols-{cols}", dict(column_count=cols)
    yield "noindent", dict(paragraph_indent=False)
    for fam in ("times", "palatino", "helvetica", "courier", "charter", "libertine"):
        yield f"font-{fam}", dict(body_font_family=fam)
    for pt in (10, 11):
        yield f"pt-{pt}", dict(body_font_pt=pt)
    for size in ("Letter", "Legal"):
        yield f"page-{size}", dict(page_size=size)
    yield "classopts", dict(class_options="a4paper,draft")
    yield "refs", dict(ref_library="/tmp/lib", bib_style="unsrtnat")
    yield "refs-plain", dict(ref_library="/tmp/lib", bib_style="ieeetr")
    del m


def typst_edge_cases(cases: dict) -> None:
    """Documents that reach the Typst serializer's less common paths."""
    M = model
    T = M.Text

    def doc(children, **meta):
        return M.Document(children=children, meta=M.DocMeta(**meta))

    maths = [
        r"\frac{a}{b} + \tfrac{1}{2} - \dfrac{\sqrt{x}}{y}",
        r"\sqrt[3]{x} + \sqrt[n+1]{\frac{a}{b}}",
        r"\left( x \right) \left[ y \right] \left\{ z \right\} \left| w \right|",
        r"\left\langle a \right\rangle \left\lceil b \right\rceil \left\lfloor c \right\rfloor",
        r"\left. f \right\| \left\| v \right\|",
        r"\left\foo x \right",
        r"\text{if } x \mathrm{d}x \operatorname{sgn} \textrm{ok}",
        r"\mathbf{v} \boldsymbol{\alpha} \bm{x} \mathit{y} \mathbb{R} \mathcal{F} \mathscr{L} \mathfrak{g}",
        r"\hat{x}\widehat{xy}\tilde{a}\widetilde{b}\bar{c}\overline{d}\underline{e}",
        r"\dot{x}\ddot{y}\vec{v}\acute{a}\grave{b}\breve{c}\check{d}\cancel{e}",
        r"\binom{n}{k} \overset{!}{=} \frac x y",
        r"a \, b \; c \! d \{ e \} f \| g \ h \% i \# j",
        r"\alpha\beta\Gamma SE ab \sin x \cos\theta",
        r"a &= b \\ c &= d \\",
        r"x\\",
        "x\\",
        r"\unknowncmd{x} \foo \hspace{1cm} \vspace{2pt} \quad\qquad",
        r"\frac{a",
        r"\frac{a}",
        r"{",
        r"\sum_{i=1}^{n} \prod_k \int_0^\infty \iint \iiint \oint",
        r"\leq \geq \neq \approx \sim \simeq \cong \equiv \propto \pm \mp",
        r"\to \rightarrow \Rightarrow \iff \implies \mapsto \leftrightarrow",
        r"\lim_{x \to 0} \limsup \liminf \max \min \sup \inf \log \ln \exp",
        r"\partial \nabla \infty \hbar \ell \Re \Im \prime \emptyset \setminus",
        "\u03b1\u03b2 x\u00e9 \U0001d465y \u00e9a",
        r"\left",
        r"\right)",
        r"\constructor \toString \__proto__",
        "",
    ]
    inl = [M.MathInline(latex=m) for m in maths]
    blocks = [M.MathBlock(latex=m, numbered=(i % 2 == 0), label=(f"eq:{i}" if i % 3 == 0 else None))
              for i, m in enumerate(maths)]
    case(cases, "typst-math", doc([M.Paragraph(children=[x]) for x in inl] + blocks), importer=False)
    case(cases, "typst-math-envs", doc([
        M.MathBlock(latex="  \\begin{align*}\na &= b \\\\\nc &= d\n\\end{align*}  "),
        M.MathBlock(latex="\\begin{equation}x=1\\end{equation} trailing", numbered=True, label="eq:t"),
        M.MathBlock(latex="x \\begin{align}y\\end{align}"),
        M.MathBlock(latex="\\begin{gather}\n  a \\\\ b\n"),
        M.MathBlock(latex="\\begin{cases} a & b \\end{cases}"),
    ]), importer=False)
    case(cases, "typst-math-sqrt-unclosed", doc([M.Paragraph(children=[M.MathInline(latex=r"\sqrt[3{x}")])]),
         importer=False)

    case(cases, "typst-inlines", doc([
        M.Paragraph(children=[
            T(text="plain #*_`@$\\<>[]~ text "),
            T(text="all", marks=["code", "strikethrough", "superscript", "subscript",
                                 "smallcaps", "underline", "italic", "bold"]),
            T(text="b", marks=["bold"]), T(text="i", marks=["italic"]),
            M.Link(url="https://e.com/a_b", children=[T(text="link", marks=["bold"])]),
            M.Link(url="https://e.com", children=[]),
            M.Footnote(children=[T(text="note "), M.MathInline(latex=r"\alpha")]),
            M.Citation(keys=["a", "b_c"], style="citep"), M.Citation(keys=[]),
            M.CrossRef(label="sec:x", kind="eqref"), M.InlineRaw(latex=r"\LaTeX{}"),
            M.Highlight(children=[T(text="hl")], color="green"),
            M.Highlight(children=[T(text="hl2")], color="mauve"),
            M.Highlight(children=[T(text="hl3")], color="constructor"),
            M.Comment(children=[T(text="c")], note="close */ here */", author="A"),
        ], alignment=al) for al in ("left", "center", "right", "justify", "weird")
    ] + [M.Paragraph(children=[])]), importer=False)

    case(cases, "typst-sections", doc([
        M.Section(level=lv, children=[T(text=f"S{lv}")], numbered=num, label=lab)
        for lv in (0, 1, 2, 3, 4) for num in (True, False) for lab in (None, "", "sec:a")
    ]), importer=False)

    case(cases, "typst-lists-theorems", doc([
        M.List(ordered=False, items=[M.ListItem(children=[T(text="one")]), M.ListItem(children=[])]),
        M.List(ordered=True, items=[M.ListItem(children=[T(text="first", marks=["italic"])])]),
        M.List(ordered=True, items=[]),
        M.Theorem(kind="theorem", title="", children=[T(text="t")]),
        M.Theorem(kind="lemma", title="Zorn", children=[T(text="l")]),
        M.Theorem(kind="lemma", title="", children=[T(text="cont")], start=False),
        M.Theorem(kind="proof", title="Sketch", children=[T(text="p")]),
        M.Theorem(kind="proof", title="", children=[T(text="p2")]),
        M.Theorem(kind="claim", title="", children=[T(text="c")]),
        M.Theorem(kind="my-claim 2nd o'neil", title="x", children=[T(text="c")]),
        M.Theorem(kind="CONJECTURE", title="", children=[T(text="c")]),
        M.Theorem(kind="constructor", title="", children=[T(text="c")]),
        M.Theorem(kind="", title="", children=[]),
    ]), importer=False)

    case(cases, "typst-tables", doc([
        M.Table(rows=[], caption="Empty"),
        M.Table(rows=[["A", "B", "C"], ["1"], ["x", "y", "z", "w"]], caption="Ragged #1", label="tab:r"),
        M.Table(rows=[["H1", "H2", "H3"], ["a", "b", "c"], ["d", "e", "f"]], header=True,
                merges=[[0, 0, 1, 2], [1, 1, 2, 2]], shading={"0,0": "#FF0000", "2,0": "#00ff00", "1,1": ""}),
        M.Table(rows=[["H1", "H2", "H3"], ["a", "b", "c"]], header=True, repeat_header=True,
                merges=[[0, 1, 1, 2]], caption="Rep", label="tab:rep"),
        M.Table(rows=[["", "H2"], ["a", ""]], header=True, repeat_header=True),
        M.Table(rows=[["a", "b"], ["c", "d"]], merges=[[0, 0, 2, 1], [0, 0, 1, 2], [5, 5, 2, 2], [0, 1, 0, 0]]),
        M.Table(rows=[[]], caption=""),
        M.Table(rows=[["only"]], header=True, repeat_header=True, merges=[[0, 0, 3, 3]]),
    ]), importer=False)
    case(cases, "greek-text", doc([
        M.Title(children=[M.Text(text="Kα and δ")]),
        M.Paragraph(children=[M.Text(text="Cu Kα (λ = 1.5 Å), 5 μm, a ≈ b ≤ c, 𝛿 and Δ, h′ ✓", marks=[])]),
        M.Paragraph(children=[M.MathInline(latex="α+x")]),
        M.Figure(path="a.png", caption="σ map", label=None),
    ]), importer=False)
    case(cases, "no-greek", doc([M.Paragraph(children=[M.Text(text="Plain ° ± × µ text", marks=[])])]), importer=False)
    case(cases, "floating-figures", doc([
        M.Paragraph(children=[M.Text(text="Text", marks=[])]),
        M.Figure(path="images/a.png", caption="A", label=None),
        M.Table(rows=[["a", "b"]], caption="T"),
    ], packages=["amsmath", "graphicx"]), importer=False)
    case(cases, "pinned-by-extras", doc([M.Figure(path="images/a.png", caption="A", label=None)],
                                        packages=["graphicx"], preamble_extras="\\usepackage{float}"), importer=False)
    case(cases, "floating-no-figures", doc([M.Paragraph(children=[M.Text(text="x", marks=[])])],
                                           packages=["amsmath"]), importer=False)
    case(cases, "picture-tables", doc([
        M.Table(rows=[["\\includegraphics[width=\\linewidth]{images/a.png}", "Step one \\par \\begin{itemize} \\item x \\end{itemize}"],
                      ["", "Step 100% two"]],
                alignment="m{0.36\\textwidth}m{0.54\\textwidth}", style="grid"),
        M.Table(rows=[["a", "\\includegraphics[width=\\linewidth]{images/b.png}"]], caption="With caption",
                label="tab:pic", alignment="m{0.45\\textwidth}m{0.45\\textwidth}", style="plain"),
        M.Table(rows=[["H", "I"], ["\\includegraphics{c.png}", "d"]], header=True, repeat_header=True,
                style="booktabs"),
        M.Table(rows=[["no", "picture"]], alignment="b{2cm}l"),
    ]), importer=False)
    case(cases, "typst-table-bad-merge", doc([M.Table(rows=[["a"]], merges=[[0, 0, 1]])]), importer=False)

    case(cases, "typst-figures", doc([
        M.Figure(path="images/cat.png", caption="A cat #1", label="fig:cat", width=w, align=al, source=src)
        for w, al, src in (
            ("0.8\\textwidth", "center", ""), ("0.35\\textwidth", "left", "drawing"),
            ("0.333\\textwidth", "right", "flowchart"), ("1.0\\textwidth", "center", "drawing"),
            ("5cm", "right", ""), (".5\\textwidth", "left", ""), ("2.\\textwidth", "center", ""),
            ("0.07\\textwidth", "center", ""), ("0.29\\textwidth", "center", ""),
            ("0.8\\linewidth", "center", ""), ("", "center", ""), ("12345678901234567890123\\textwidth", "center", ""),
        )
    ] + [
        M.Figure(path="images\\sub\\d.PNG", caption="", source="drawing"),
        M.Figure(path="x.png", caption="", label="", align="left"),
    ]), importer=False)
    for w in ("1.2.3\\textwidth", ".\\textwidth"):
        case(cases, f"typst-figure-badwidth-{slug(w)}", doc([M.Figure(path="a.png", width=w)]), importer=False)

    case(cases, "typst-front-matter", doc([
        M.Paragraph(children=[T(text="before")]),
        M.Title(children=[T(text="Real ", marks=["bold"]), T(text="Title_1")]),
        M.Title(children=[T(text="Second title")]),
        M.Author(children=[T(text="")]),
        M.Author(children=[T(text="A. Author")]),
        M.Affiliation(children=[T(text="Uni #1")]),
        M.Correspondence(children=[T(text="a@b.c")]),
        M.Abstract(children=[T(text="Para 1")]),
        M.Abstract(children=[]),
        M.Abstract(children=[T(text="Para 2")]),
        M.Keywords(children=[T(text="AI")]),
        M.Keywords(children=[]),
        M.Keywords(children=[T(text="ML")]),
        M.Paragraph(children=[T(text="mid")]),
        M.Abstract(children=[]),
        M.Keywords(children=[]),
        M.Frame(children=[T(text="Slide 1")]),
        M.RawLatex(text="\\usepackage{foo} /* x */"),
        M.RawLatex(text="ends\n"),
        M.RawLatex(text=""),
        M.Affiliation(children=[T(text="Late affil")]),
    ], title="Meta title", author="Meta author"), importer=False)
    case(cases, "typst-meta-fallback", doc([M.Paragraph(children=[T(text="x")])],
                                           title="  Spaced #title_  ", author="\tB*b\n"), importer=False)
    case(cases, "typst-meta-empty", doc([], title="", author=""), importer=False)
    case(cases, "typst-meta-title-only", doc([M.Author(children=[T(text="Only author")])], title=""),
         importer=False)
    for name, meta in (
        ("a5", dict(page_size="A5")), ("b5", dict(page_size="B5")), ("odd-page", dict(page_size="Tabloid")),
        ("odd-font", dict(body_font_family="comic")), ("default-font", dict(body_font_family="default")),
        ("cols-4", dict(column_count=4)), ("cols-1", dict(column_count=1)),
        ("spacing-tie", dict(line_spacing=2.5)), ("spacing-tie2", dict(line_spacing=1.7307692307692306)),
        ("spacing-near", dict(line_spacing=1.005)), ("spacing-small", dict(line_spacing=0.5)),
        ("spacing-big", dict(line_spacing=12.25)),
        ("margins-odd", dict(margin_top_cm=0.1, margin_bottom_cm=1e-07, margin_left_cm=12.345678901234567,
                             margin_right_cm=1e22)),
        ("pt-9", dict(body_font_pt=9)),
    ):
        case(cases, f"typst-meta-{name}", doc([M.Paragraph(children=[T(text="x")])], **meta), importer=False)


# Importer corpus: .tex snippets (the Python importer tests' sources plus
# edge cases), Markdown sources and body fragments, each with what Python
# reads back. tests/importer.parity.test.ts checks them.
IMPORTER_TEX = {
    "packages-geometry": "\\documentclass{report}\n\\usepackage[a4paper]{geometry}\n\\usepackage{amsmath}\n\\usepackage{hyperref}\n\\begin{document}\nhello\n\\end{document}\n",
    "letterpaper": "\\documentclass{article}\n\\usepackage[letterpaper]{geometry}\n\\begin{document}body\\end{document}",
    "legal-mm-pt": "\\documentclass{article}\n\\usepackage[legalpaper,left=25mm,right=72pt,top=1.5cm,bottom=0.125in]{geometry}\n\\begin{document}body\\end{document}",
    "title-author": "\\documentclass{article}\n\\title{Hello World}\n\\author{Me}\n\\begin{document}\\maketitle body\\end{document}",
    "rich-title": "\\documentclass[11pt,a4paper]{article}\n\\title{KhervePDF: A PDF Viewer\\\\with Built-In Git Version History}\n\\author{Gwilherm Kerherve\\thanks{ORCID: 0000, \\texttt{g@x.org}}\\\\\n\\small Department of Materials, Imperial College London}\n\\begin{document}\\maketitle body\\end{document}",
    "accents": "\\documentclass{article}\n\\title{Caf\\'{e} chemistry}\n\\author{Gwilherm Kerherv\\'e}\n\\begin{document}\\maketitle Schr\\\"odinger's cat, na\\\"{\\i}ve, \\^o \\`a \\~n \\=a \\.z \\'{}x\\end{document}",
    "thanks-break": "\\documentclass{article}\n\\author{Ann Author\\thanks{line one\\\\line two}}\n\\begin{document}\\maketitle body\\end{document}",
    "sections": "\\documentclass{article}\\begin{document}\n\\section{Intro}\n\\subsection{Background}\n\\subsubsection*{Detail}\n\\paragraph{P} text\n\\subparagraph {SP} more\n\\section{With \\textbf{bold} \\emph{it}}\n\\end{document}",
    "marks": "\\documentclass{article}\\begin{document}\nThis is \\textbf{bold} and \\textit{italic} and \\texttt{code\\_x}. \\textbf{\\textit{both} and} \\underline{u} \\textsc{sc} \\textsubscript{2} \\textsuperscript{3} \\sout{gone} \\emph{\\$5}\n\\end{document}",
    "inline-math": "\\documentclass{article}\\begin{document}E = $mc^2$ done and $unclosed\\end{document}",
    "display-math": "\\documentclass{article}\\begin{document}\n\\begin{equation}\nx = 1\n\\end{equation}\n\\begin{align}\nx &= 1 \\\\\ny &= 2\n\\end{align}\n\\begin{gather*}\na + b = c\n\\end{gather*}\n\\[ E = mc^2 \\]\n$$ a^2 $$\n\\begin{multline}\n\\alpha + \\beta \\\\ + \\gamma = \\delta\n\\end{multline}\n\\end{document}",
    "lists": "\\documentclass{article}\\begin{document}\n\\begin{itemize}\n\\item first\n\\item second \\textbf{x}\n\\end{itemize}\n\\begin{enumerate}\n\\item one\n\\item\n\\item[a] two\n\\end{enumerate}\n\\end{document}",
    "links": "\\documentclass{article}\\begin{document}\nSee \\href{https://x.com}{here}\\footnote{a note} and \\cite{key1,key2} and \\citep{ a , b } \\citet{c} \\ref{sec:1} \\eqref{eq:1} \\pageref{p}. \\url{https://x.com/y} \\label{l} \\verb|a$b| \\verb\n\\end{document}",
    "figure": "\\documentclass{article}\\begin{document}\n\\begin{figure}[h]\n\\centering\n\\includegraphics[width=0.5\\textwidth]{img/foo.png}\n\\caption{A photo with \\textbf{T=300K}}\n\\label{fig:foo}\n\\end{figure}\n\\begin{figure}\n\\includegraphics{bare.png}\n\\end{figure}\n\\begin{figure}\n\\includegraphics[height=3cm]{h.png}\n\\caption{}\n\\end{figure}\n\\end{document}",
    "table": "\\documentclass{article}\\begin{document}\n\\begin{table}[h]\n\\centering\n\\begin{tabular}{lcr}\n\\hline\nA & B & C \\\\\n1 & 2 & 3 \\\\\n4 & 5 & 6 \\\\\n\\hline\n\\end{tabular}\n\\caption{Some data}\n\\label{tab:demo}\n\\end{table}\n\\end{document}",
    "standalone-tabular": "\\documentclass{article}\\begin{document}\n\\begin{tabular}{ll}\nfoo & bar \\\\\nbaz & qux \\\\\n\\end{tabular}\n\\end{document}",
    "table-p-spec": "\\documentclass{article}\n\\begin{document}\n\\begin{table}[H]\n\\begin{tabular}{p{0.55\\columnwidth} p{0.45\\columnwidth}}\n\\hline\n\\textbf{Method} & \\textbf{Description} \\\\\n\\hline\nLevenberg-Marquardt & Efficient for least-squares \\\\\nPowell & Derivative-free \\\\\n\\hline\n\\end{tabular}\n\\caption{Optimization methods}\n\\label{tab:methods}\n\\end{table}\n\\end{document}",
    "table-merges": "\\documentclass{article}\\begin{document}\n\\begin{table}\\begin{tabular}{|l|c|r|}\\hline \\rowcolor[HTML]{EEF3FA} \\textbf{N} & \\multicolumn{2}{c}{\\cellcolor[HTML]{FFEB3B}wide} \\\\ \\hline \\multirow{2}{*}{y} & 1 & \\cellcolor[HTML]{00ff00} 2 \\\\ \\hline & \\multicolumn{2}{c}{} \\\\ \\cline{1-2}\\hline\\end{tabular}\\end{table}\n\\begin{table}\\begin{tabular}{lc}\\toprule\\rowcolor[HTML]{eef3fa} A & B \\\\ \\midrule 1 & 2 \\\\ \\bottomrule\\end{tabular}\\end{table}\n\\begin{table}\\begin{tabular}{l|c}\\toprule A & B \\\\ \\midrule 1 & 2 \\\\ \\bottomrule\\end{tabular}\\end{table}\n\\begin{table}no tabular here\\end{table}\n\\end{document}",
    "table-bad-multicolumn": "\\documentclass{article}\\begin{document}\n\\begin{tabular}{ll}\\multicolumn{x}{c}{a} & b \\\\\\end{tabular}\n\\end{document}",
    "longtable": "\\documentclass{article}\\begin{document}\n\\begin{longtable}{l p{3cm}}\n\\caption{Long one}\\label{tab:long}\\\\\n\\toprule\nH1 & H2 \\\\\n\\midrule\n\\endfirsthead\nH1 & H2 \\\\\n\\endhead\n\\bottomrule\n\\endlastfoot\na & b \\\\\nc & d \\\\\n\\end{longtable}\n\\end{document}",
    "align-envs": "\\documentclass{article}\\begin{document}\n\\begin{flushleft}\nHello world.\n\nSecond.\n\\end{flushleft}\n\\begin{center}\nHeading-ish text.\n\\begin{itemize}\\item in center\\end{itemize}\n\\end{center}\n\\begin{flushright}\nAligned right.\n\\end{flushright}\n\\end{document}",
    "title-emph": "\\documentclass{article}\\title{Hello \\emph{World}}\\begin{document}body\\end{document}",
    "comments": "\\documentclass{article}\\begin{document}\n%% ============================================\n\\section{Intro}\n%% banner\nBody text here. 100\\% sure % trailing\n% ===== KHERVETEX COMPILE START =====\nkept\n% ===== KHERVETEX COMPILE END =====\n\\end{document}",
    "verbatim-lst": "\\documentclass{article}\\begin{document}\nExample:\n\\begin{verbatim}\ndef foo(): return 1\n\\end{verbatim}\nAfter.\n\\begin{lstlisting}[caption={Demo}]\nprint(\"hi\")\n\\end{lstlisting}\n\\end{document}",
    "bibliography": "\\documentclass{article}\\begin{document}\nbody\n\\begin{thebibliography}{9}\n\\bibitem{key}\nA reference.\n\\end{thebibliography}\n\\end{document}",
    "abstract-keywords": "\\documentclass{article}\\begin{document}\n\\begin{abstract}\nShort summary of the work.\n\nA second paragraph with more detail.\n\\end{abstract}\n\\begin{keyword}\nXPS \\sep PHI \\sep Python\n\\end{keyword}\n\\begin{keywords}\n\\end{keywords}\n\\section{Intro}\nbody\n\\end{document}",
    "preamble-extras": "\\documentclass{article}\n\\usepackage{listings}\n\\usepackage{xcolor}\n\\usepackage[utf8]{inputenc}\n\\usepackage[onehalfspacing]{setspace}\n\\lstset{\n    language=Python,\n    basicstyle=\\ttfamily\\small,\n    frame=single,\n\n\n    numbers=left\n}\n\\definecolor{mycolor}{RGB}{12,34,56}\n\\hypersetup{colorlinks=true}\n\\newcommand{\\bigtitle}[1]{\\Large\\textbf{#1}}\n\\newcommand{\\Kstroke}{K\\kern-0.5em-}\n\\title [short] {T}\n\\begin{document}\nbody\n\\end{document}",
    "elsarticle": "\\documentclass[preprint,12pt]{elsarticle}\n\\journal{SoftwareX}\n\\begin{document}\n\\begin{frontmatter}\n\\title{Hello}\n\\author[ic]{Gwilherm Kerherve\\corref{cor1}}\n\\ead{me@example.com}\n\\cortext[cor1]{Corresponding author}\n\\affiliation[ic]{organization={Imperial}}\n\n\n\\begin{abstract}\nShort.\n\\end{abstract}\n\\begin{keyword}\nA \\sep B\n\\end{keyword}\n\\end{frontmatter}\n\\section{Body}\nbody\n\\end{document}",
    "elsarticle-author-preamble": "\\documentclass{elsarticle}\\author[ic]{Gwilherm Kerherve\\corref{cor1}}\\begin{document}body\\end{document}",
    "journal-macro": "\\documentclass{article}\\begin{document}\\journal{SoftwareX} Body.\\end{document}",
    "escapes": "\\documentclass{article}\\begin{document}\n100\\% \\& \\$5 plus a\\_b \\# \\{x\\} \\textbackslash{} \\textasciitilde{} \\textasciicircum{} a~b\n\\end{document}",
    "unknown-macros": "\\documentclass{article}\\begin{document}\nVisit \\Kstroke herveFitting today. \\textcolor{red}{important} note \\foo[a][b[c]]{x}{y{z}} \\bar{ unbalanced\n\\end{document}",
    "chapter": "\\documentclass{report}\\begin{document}\n\\chapter{Introduction}\nBody text after the chapter.\n\\section{Background}\n\\end{document}",
    "twocolumn-bracket": "\\documentclass[twocolumn]{article}\\begin{document}\n\\twocolumn[\n    \\begin{@twocolumnfalse}\n        \\maketitle\n        \\tableofcontents\n    \\end{@twocolumnfalse}\n]\nBody paragraph.\n\\onecolumn[unbalanced\n\\end{document}",
    "classopts": "\\documentclass[a4paper,11pt,twocolumn,draft]{article}\n\\begin{document}\nHello.\n\\end{document}",
    "classopts-10pt": "\\documentclass[10pt,twocolumn]{article}\n\\begin{document}\nHello.\n\\end{document}",
    "geometry-inches": "\\documentclass{article}\n\\usepackage[left=1in,right=1in,top=0.5in,bottom=0.5in]{geometry}\n\\begin{document}\nHello.\n\\end{document}",
    "wiley-preamble": "\\documentclass[VANCOUVER,LATO2COL]{WileyNJDv5}\n\\usepackage{tikz}\n\\author[1]{Alice}\n\\author[2]{Bob}\n\\address[1]{\\orgname{MIT}}\n\\title{My paper}\n\\begin{document}\n\\maketitle\nHello world.\n\\end{document}",
    "resume": "\\documentclass{resume}\n\\usepackage[left=0.75in,top=0.6in,right=0.75in,bottom=0.6in]{geometry}\n\\usepackage{hyperref}\n\\name{Gwilherm Kerherve \\small{PhD}}\n\\address{17 Great Courtlands, Langton Green}\n\\address{07473 132 455 \\\\ g.kerherve@ic.ac.uk}\n\\begin{document}\nA highly motivated scientist.\n\\begin{rSection}{Key Skills}\n\\begin{rSubsection}{Imperial College}{2020 - Present}{Research Manager}{London}\n\\item Maintain the XPS\n\\item Train users\n\\end{rSubsection}\n\\end{rSection}\n\\end{document}",
    "wiley-body": "\\documentclass[VANCOUVER,LATO2COL]{WileyNJDv5}\n\\usepackage{tikz}\n\\title{My paper}\n\\begin{document}\n\\author[1]{Alice}\n\\author[2]{Bob}\n\\address[1]{\\orgname{MIT}}\n\\address[2]{\\orgname{ETH}}\n\\authormark{Alice \\textsc{et al.}}\n\\titlemark{My paper}\n\\abstract[Abstract]{This is the abstract text.}\n\\keywords[Keywords]{XPS, fitting}\n\\maketitle\nHello world.\n\\end{document}",
    "wiley-ws": "\\documentclass[VANCOUVER]{WileyNJDv5}\n\\title{Paper}\n\\begin{document}\n\\author[1] {William S. J. Skinner}\n\\maketitle\nHello.\n\\section{S}\n\\end{document}",
    "wiley-no-boundary": "\\documentclass{WileyNJDv5}\n\\begin{document}\n\\author{A}\nText only.\n\\end{document}",
    "figure-star": "\\documentclass{article}\n\\begin{document}\n\\begin{figure*}[tb]\n  \\centering\n  \\includegraphics[width=\\textwidth]{wide.png}\n  \\caption{A wide figure}\n  \\label{fig:wide}\n\\end{figure*}\n\\begin{table*}\\begin{tabular}{l}a\\end{tabular}\\end{table*}\n\\end{document}",
    "tilde-cite": "\\documentclass{article}\n\\begin{document}\nSome text~\\cite{Kwok2000} and more~\\cite{Foo2021,Bar2022}.\n\\end{document}",
    "theorems": "\\documentclass{article}\\begin{document}\n\\begin{theorem}[Heine--Borel]\nA set is compact.\n\\end{theorem}\n\n\\begin{proof}\nOne.\n\nTwo.\n\\end{proof}\n\\begin{lemma}\\end{lemma}\n\\end{document}",
    "beamer": "\\documentclass{beamer}\n\\title{Talk}\n\\begin{document}\n\\begin{frame}\n\\titlepage\n\\end{frame}\n\\begin{frame}{Hello \\textbf{you}}\nSome content\n\\begin{itemize}\\item a\\end{itemize}\n\\end{frame}\n\\begin{frame}\nJust content\n\\end{frame}\n\\end{document}\n",
    "unknown-env": "\\documentclass{article}\\begin{document}\n\\begin{tikzpicture}[scale=2]\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}\n\\begin{minipage}{0.5\\textwidth}inside\\end{minipage}\n\\begin{quote*}q\\end{quote*}\n\\end{document}",
    "no-document": "Just a fragment with \\textbf{bold} and no preamble.\n\n\\section{S}",
    "crlf": "\\documentclass{article}\r\n\\title{CR}\r\n\\begin{document}\r\nLine one\r\n\r\nLine two\r\n\\section{S}\r\n\\end{document}\r\n",
    "unicode": "\\documentclass{article}\n\\title{Ünïcødé — 漢字 😀}\n\\begin{document}\nEmoji 😀 and \\'😀 and \\'{\\'e} and \\\"{ab} text. Ω\\textbf{ß}\n\\section{Straße}\n\\end{document}",
    "itemize-unicode-boundary": "\\documentclass{article}\\begin{document}\n\\begin{itemize}\n\\itemé x\n\\item y\n\\end{itemize}\n\\end{document}",
    "bad-geometry": "\\documentclass{article}\n\\usepackage[left=1.2.3cm]{geometry}\n\\begin{document}x\\end{document}",
    "linebreak": "\\documentclass{article}\\begin{document}\nfirst\\\\with second \\\\[2pt] third\\\\\n\\end{document}",
    "odd-whitespace": "\\documentclass{article}\\begin{document}\nA\\section\x1c{S}\n\x85\nB\n\u3000\nC\n\ufeff\nD\u2028E\\begin{tabular}{ll}a & b \\\\\x1cc & d\\end{tabular}\n\\end{document}",
}

IMPORTER_MD = {
    "basic": "# Title here\n\nSome **bold** and *italic* and `code` and __b__ and _i_.\nContinued line with [a link](https://x.y) and [@key1; @key2].\n\n## Sub heading ##\n\n- one\n- two\n  continued\n* three\n\n1. first\n2. second\n\n3. third after blank\n\n> quoted\n> more\n\n![A cat](img/cat.png)\n\n$$E = mc^2$$\n\n$$\na + b\n$$\n\nInline $x^2$ math and $$y$$ display.\n",
    "yaml": "---\ntitle: 'My Doc'\nauthor: \"Jane\"\nbibliography: refs.bib\n# comment\n- list\n---\nBody text.\n",
    "yaml-authors": "---\ntitle: T\nauthors: A, B\n---\n# H\n",
    "code": "Intro paragraph. Here is an example_one:\n\n```python\nprint('hi')\n```\n\n```\nplain\n```\n\nSee this; the code:\n```js\nx()\n```\n",
    "unclosed": "```rust\nfn main() {}\n",
    "headings": "#NoSpace\n###### Six\n####### Seven\n# Trailing #\n",
    "crlf": "# Win\r\n\r\nPara\r\nline\r\n\r\n- a\r\n- b\r\n",
    "empty": "",
    "unicode": "# Café 😀\n\nNaïve **straße** [@clé]\n",
    "odd-whitespace": "---\ntitle: X\x85author: Y\u2028\n---\n#\x1cH\n-\u3000item\n\ufeff\npara\x1c\n",
}

IMPORTER_FRAGMENTS = {
    "theorems": "\\begin{theorem}[Heine--Borel]\nA set is compact.\n\\end{theorem}\n\n\\begin{proof}\nOne.\n\nTwo.\n\\end{proof}",
    "full-doc": "\\documentclass{article}\n\\begin{document}\n\\section{S}\nText % comment\n\\end{document}",
    "empty": "",
    "mixed": "Para one.\n\n\\begin{itemize}\\item x\\end{itemize}\n\\begin{equation}a\\end{equation}",
}


def importer_corpus() -> dict:
    from khervedoc.importers import import_body_fragment
    tex = {}
    for name, src in IMPORTER_TEX.items():
        imported = safe(import_tex, src)
        tex[name] = {"source": src, "imported_json": imported if isinstance(imported, str)
                     else model.to_json(imported)}
    md = {}
    for name, src in IMPORTER_MD.items():
        imported = safe(import_md, src)
        md[name] = {"source": src, "imported_json": imported if isinstance(imported, str)
                    else model.to_json(imported)}
    frag = {}
    for name, src in IMPORTER_FRAGMENTS.items():
        blocks = safe(import_body_fragment, src)
        frag[name] = {"source": src, "blocks_json": blocks if isinstance(blocks, str)
                      else model.to_json(model.Document(children=blocks))}
    return {"tex": tex, "md": md, "fragments": frag}


def main() -> None:
    cwd = Path(tempfile.mkdtemp(prefix="ktex-golden-"))
    import os
    os.chdir(cwd)  # some factories write figure files next to themselves
    cases: dict[str, dict] = {}
    docs: dict[str, model.Document] = {}
    for category, label, factory, _blurb in GALLERY:
        name = f"example-{slug(category)}-{slug(label)}"
        doc = factory()
        docs[name] = doc
        case(cases, name, doc)

    article = docs.get("example-articles-single-column-article") or next(iter(docs.values()))
    welcome = next(iter(docs.values()))
    for cls in TEMPLATE_CHOICES:
        for base_name, base in (("article", article), ("welcome", welcome)):
            d = copy.deepcopy(base)
            d.meta.documentclass = cls
            case(cases, f"class-{cls}-{base_name}", d, importer=False)

    for vname, changes in meta_variants(article):
        for cls in ("article", "report", "memoir", "elsarticle"):
            d = copy.deepcopy(article)
            d.meta.documentclass = cls
            for k, v in changes.items():
                setattr(d.meta, k, v)
            case(cases, f"meta-{vname}-{cls}", d, importer=False)

    typst_edge_cases(cases)

    # Projects: the master .tex over a few chapter documents.
    projects = {}
    chapter_names = [n for n in docs if "thesis" in n or "book" in n][:3] or list(docs)[:3]
    for cls in ("book", "report", "article", "memoir", "llncs"):
        for auto in (True, False):
            proj = model.Project(meta=model.DocMeta(documentclass=cls))
            proj.bibliography = "refs/library.bib"
            proj.bib_style = "plainnat"
            proj.auto_page_numbers = auto
            types = ["frontmatter", "chapter", "chapter", "appendix", "backmatter"]
            for i, t in enumerate(types):
                proj.chapters.append(model.ChapterEntry(
                    path=f"part {i}/ch.{i}.ktex", label=f"Chapter {i}",
                    enabled=(i != 2), start_page=(10 * i if i else None),
                    last_known_pages=4 + i,
                    numbering="roman" if t == "frontmatter" else "arabic",
                    chapter_type=t, chapter_number=(7 if i == 3 else None)))
            chapter_docs = [docs[n] for n in chapter_names]
            projects[f"project-{cls}-{'auto' if auto else 'manual'}"] = {
                "project_json": model.project_to_json(proj),
                "chapter_docs": [model.to_json(d) for d in chapter_docs],
                "master": safe(serialize_project_master, proj, chapter_docs),
                "master_nodocs": safe(serialize_project_master, proj, []),
            }

    md_cases = {}
    md_samples = sorted((SRC / "tests").glob("**/*.md")) + sorted((SRC / "examples").glob("**/*.md"))
    for p in md_samples:
        md_cases[p.name] = {"source": p.read_text(encoding="utf-8"),
                            "imported_json": safe(lambda s: model.to_json(import_md(s)), p.read_text(encoding="utf-8"))}

    tex_samples = sorted((SRC / "examples").glob("**/*.tex"))
    tex_cases = {}
    for p in tex_samples:
        src = p.read_text(encoding="utf-8", errors="replace")
        imported = safe(import_tex, src)
        tex_cases[str(p.relative_to(SRC))] = {
            "source": src,
            "imported_json": imported if isinstance(imported, str) else model.to_json(imported),
        }

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    for fname, data in (("documents.json", cases), ("projects.json", projects),
                        ("markdown.json", md_cases), ("tex_sources.json", tex_cases)):
        (OUT / fname).write_text(json.dumps(data, indent=1, ensure_ascii=False, sort_keys=True),
                                 encoding="utf-8")
    (OUT / "importer.json").write_text(
        json.dumps(importer_corpus(), indent=1, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    print(f"{len(cases)} documents, {len(projects)} projects, "
          f"{len(md_cases)} markdown, {len(tex_cases)} tex sources -> {OUT}")


if __name__ == "__main__":
    main()
