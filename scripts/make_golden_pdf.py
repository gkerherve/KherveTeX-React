"""Write the .pdf importer parity corpus, tests/golden/pdf.json.

Builds small PDF fixtures with PyMuPDF (the fixtures of KherveTeX's
tests/test_pdf_importer.py, journal-style articles, images, hand-written
content streams that pin down MuPDF's span / line / block grouping, and the
a small LaTeX article compiled with tectonic when it is installed), then stores for
each one:

  pdf         the PDF bytes, base64
  metadata    PyMuPDF's title / author / keywords
  pages       per page: page.rect height / width, the get_text("dict")
              blocks import_pdf reads (text, size, flags, font, bbox,
              colour, alpha, origin), and get_images() with what Pixmap()
              makes of each image
  imported    model.to_json(import_pdf(...)), figure paths relative to the
              image_dir recorded at the top
  progress    the progress(page, total) calls

The TypeScript tests feed `pages` straight into the ported structure
detection (which must reproduce `imported` byte for byte) and compare their
own pdf.js extraction of `pdf` against `pages`.

    /path/to/KherveTeX/.venv/bin/python scripts/make_golden_pdf.py [path/to/KherveTeX]
"""
from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE.parent / "KherveTeX"
sys.path.insert(0, str(SRC))

import pymupdf  # noqa: E402

from khervedoc import model  # noqa: E402
from khervedoc.importers import import_pdf  # noqa: E402

OUT = HERE / "tests" / "golden" / "pdf.json"
IMAGE_DIR = "pdf-images"  # relative: Python runs in a scratch directory
A4 = dict(width=595, height=842)


# ---------------- fixtures from tests/test_pdf_importer.py ----------------

def basic_paragraph(doc):
    page = doc.new_page(**A4)
    page.insert_text((72, 72), "Hello world.", fontsize=12)


def heading_detected_by_size(doc):
    page = doc.new_page(**A4)
    page.insert_text((72, 120), "Big Title", fontsize=24, fontname="helv")
    page.insert_text((72, 200), "Body text here.", fontsize=12)


def multi_page(doc):
    for i in range(3):
        page = doc.new_page(**A4)
        page.insert_text((72, 72), f"Page {i + 1} content.", fontsize=12)


def progress_callback(doc):
    for _ in range(2):
        page = doc.new_page(**A4)
        page.insert_text((72, 72), "text", fontsize=12)


def image_extraction(doc):
    page = doc.new_page(**A4)
    page.insert_text((72, 72), "Before image.", fontsize=12)
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 50, 50), 1)
    pix.set_rect(pix.irect, (255, 0, 0, 255))
    page.insert_image(pymupdf.Rect(72, 100, 200, 200), pixmap=pix)


# ---------------- journal-style articles ----------------

LOREM = ("Thin oxide films grown by pulsed laser deposition were studied with "
         "photoelectron spectroscopy. The surface composition changes with the "
         "annealing temperature, and the core-level shifts are assigned to "
         "distinct chemical states of the cations at the interface.")


def article(doc):
    page = doc.new_page(**A4)
    page.insert_text((72, 30), "Surface Science 712 (2026) 122345", fontsize=8)
    page.insert_text((72, 80), "Surface Science", fontsize=16, fontname="tibo")
    page.insert_text((72, 100), "Contents lists available at ScienceDirect", fontsize=9)
    page.insert_textbox(pymupdf.Rect(72, 120, 523, 180),
                        "Oxygen vacancies at the surface of strontium titanate",
                        fontsize=18, fontname="hebo")
    page.insert_text((72, 200), "Jane Doe, John Smith", fontsize=12)
    page.insert_text((72, 214), "Department of Materials, Imperial College London", fontsize=7)
    page.insert_text((72, 240), "A R T I C L E   I N F O", fontsize=9)
    page.insert_text((300, 240), "A B S T R A C T", fontsize=9)
    page.insert_textbox(pymupdf.Rect(300, 250, 523, 360), LOREM, fontsize=10)
    page.insert_text((72, 260), "Keywords: XPS; thin films; oxides", fontsize=10)
    page.insert_text((72, 400), "1. Introduction", fontsize=10, fontname="hebo")
    page.insert_textbox(pymupdf.Rect(72, 410, 523, 520), LOREM + " " + LOREM, fontsize=10)
    page.insert_text((72, 540), "2.1. Sample prepa-", fontsize=10)
    page.insert_text((72, 552), "ration", fontsize=10)
    page.insert_text((72, 600), "Fig. 1. Survey spectra of the as-grown film.", fontsize=9)
    page.insert_text((72, 640), "Results and discussion", fontsize=11, fontname="hebo")
    page.insert_textbox(pymupdf.Rect(72, 650, 523, 760), LOREM, fontsize=10)
    page.insert_text((290, 820), "1", fontsize=9)
    page.insert_text((72, 832), "https://doi.org/10.1016/j.susc.2026.122345", fontsize=7)
    page.insert_text((24, 700), "Downloaded from the publisher under a CC licence", fontsize=8, rotate=90)
    page = doc.new_page(**A4)
    page.insert_textbox(pymupdf.Rect(50, 80, 290, 400), LOREM + " " + LOREM, fontsize=10)
    page.insert_textbox(pymupdf.Rect(305, 80, 545, 400), LOREM, fontsize=10)
    page.insert_text((50, 430), "Table 1 Fitted binding energies.", fontsize=9)
    page.insert_text((50, 460), "3. Conclusions", fontsize=10, fontname="hebo")
    page.insert_text((50, 480), "Short paragraph closing the paper.", fontsize=10)
    doc.set_metadata({
        "title": "Oxygen vacancies at the surface of strontium titanate",
        "author": "Jane Doe, John Smith",
        "keywords": "XPS; thin films; oxides; ",
    })


def no_metadata(doc):
    page = doc.new_page(**A4)
    page.insert_text((72, 100), "A Paper Without Metadata", fontsize=20, fontname="tibo")
    page.insert_text((72, 140), "Abstract. We describe a method in one block.", fontsize=11, fontname="tiro")
    page.insert_text((72, 180), "Methods", fontsize=12, fontname="tibo")
    page.insert_text((72, 200), "We used the code", fontsize=11, fontname="tiro")
    page.insert_text((72, 214), "print(x)", fontsize=11, fontname="cour")
    page.insert_text((72, 228), "and an italic remark.", fontsize=11, fontname="tiit")
    page.insert_text((72, 260), "Abstract", fontsize=11, fontname="tibo")
    page.insert_text((72, 290), "Text after a lone abstract label goes to the abstract.", fontsize=11)
    page.insert_text((72, 330), "Keywords: alpha, beta", fontsize=11)
    page.insert_text((72, 360), "12", fontsize=11)
    page.insert_text((72, 390), "ab", fontsize=11)
    page.insert_text((72, 420), "Mixed", fontsize=12, fontname="tibo")
    page.insert_text((120, 420), " size", fontsize=12, fontname="tiro")
    page.insert_text((72, 450), "Small Bold Heading", fontsize=12, fontname="hebo")


def html_mixed(doc):
    page = doc.new_page(**A4)
    page.insert_htmlbox(
        pymupdf.Rect(72, 72, 523, 400),
        "<h1>Embedded fonts</h1>"
        "<p>Body text with <b>bold words</b>, <i>italic words</i>, "
        "<b><i>both</i></b> and <code>monospace()</code> inside one "
        "paragraph that wraps over several lines of the page so that the "
        "block holds more than one line.</p>"
        "<p>H<sub>2</sub>O and E = mc<sup>2</sup> carry sub- and superscripts.</p>",
        css="* {font-family: serif; font-size: 11pt}")
    doc.set_metadata({"title": "Embedded fonts", "author": "", "keywords": ""})


def images(doc):
    page = doc.new_page(**A4)
    page.insert_text((72, 72), "A page of images.", fontsize=12)
    rgb = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 64, 60), 0)
    rgb.set_rect(rgb.irect, (0, 128, 255))
    rgb.set_rect(pymupdf.IRect(0, 0, 32, 30), (255, 255, 0))
    xref = page.insert_image(pymupdf.Rect(72, 100, 200, 200), pixmap=rgb)
    icon = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 20, 20), 0)
    icon.set_rect(icon.irect, (0, 0, 0))
    page.insert_image(pymupdf.Rect(220, 100, 240, 120), pixmap=icon)
    gray = pymupdf.Pixmap(pymupdf.csGRAY, pymupdf.IRect(0, 0, 70, 55), 0)
    gray.set_rect(gray.irect, (90,))
    page.insert_image(pymupdf.Rect(72, 220, 200, 320), pixmap=gray)
    alpha = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 52, 52), 1)
    alpha.set_rect(alpha.irect, (10, 200, 30, 128))
    page.insert_image(pymupdf.Rect(220, 220, 300, 300), pixmap=alpha)
    page = doc.new_page(**A4)
    page.insert_text((72, 72), "The first image again.", fontsize=12)
    page.insert_image(pymupdf.Rect(72, 100, 200, 200), xref=xref)


# ---------------- MuPDF grouping probes ----------------

PROBE_FONTS = ["helv", "hebo", "heit", "tiro", "cour"]

SEGMENTATION = {
    "vgap1.5": "BT /helv 12 Tf 72 700 Td (First line) Tj ET BT /helv 12 Tf 72 682 Td (Second line) Tj ET",
    "vgap1.8": "BT /helv 12 Tf 72 700 Td (First line) Tj ET BT /helv 12 Tf 72 678.4 Td (Second line) Tj ET",
    "hgap-space": "BT /helv 12 Tf 72 700 Td (Left) Tj ET BT /helv 12 Tf 98.34 700 Td (Right) Tj ET",
    "hgap-newline": "BT /helv 12 Tf 72 700 Td (Left) Tj ET BT /helv 12 Tf 105.34 700 Td (Right) Tj ET",
    "fontchange": "BT /helv 12 Tf 72 700 Td (Plain ) Tj /hebo 12 Tf (bold) Tj /helv 12 Tf ( and ) Tj /heit 12 Tf (ital) Tj ET",
    "rise": "BT /tiro 12 Tf 72 700 Td (E = mc) Tj /tiro 7 Tf 5 Ts (2) Tj 0 Ts /tiro 12 Tf ( done) Tj ET",
    "sub": "BT /tiro 12 Tf 72 700 Td (H) Tj /tiro 7 Tf -3 Ts (2) Tj 0 Ts /tiro 12 Tf (O) Tj ET",
    "TJ-kerning": "BT /helv 12 Tf 72 700 Td [(Wo) 80 (rd) -200 (small) -300 (next) -1500 (far)] TJ ET",
    "twocol": ("BT /helv 10 Tf 12 TL 50 700 Td (Left col line one) Tj T* (Left col line two) Tj ET "
               "BT /helv 10 Tf 12 TL 320 700 Td (Right col line one) Tj T* (Right col line two) Tj ET"),
    "interleave": "BT /helv 10 Tf 50 700 Td (Left one) Tj 270 0 Td (Right one) Tj -270 -12 Td (Left two) Tj 270 0 Td (Right two) Tj ET",
    "rot90": "BT /helv 10 Tf 0 1 -1 0 20 100 Tm (Rotated sidebar text that goes up the page) Tj ET",
    "hscale": "BT /helv 12 Tf 150 Tz 72 700 Td (Wide) Tj ET",
    "tm-size": "BT /helv 1 Tf 12 0 0 12 72 700 Tm (Scaled by Tm) Tj ET",
    "backwards": "BT /helv 12 Tf 200 700 Td (Second) Tj -128 0 Td (First) Tj ET",
    "same-object-indent": "BT /helv 12 Tf 72 700 Td (Line one) Tj 15 -14.4 Td (indented) Tj ET",
    "new-object-indent": "BT /helv 12 Tf 72 700 Td (Line one) Tj ET BT /helv 12 Tf 87 685.6 Td (indented) Tj ET",
    "colour-object": "BT /helv 12 Tf 72 700 Td (Line one) Tj 1 0 0 rg 15 -14.4 Td (red indented) Tj ET",
    "superscript": "BT /helv 12 Tf 72 700 Td (base) Tj 3 Ts (up) Tj 6 Ts (top) Tj 0 Ts (back) Tj ET",
    "wide-space-font": "BT /helv 12 Tf 72 700 Td [(ab) -500] TJ /hebo 12 Tf (cd) Tj ET",
    "small-space-font": "BT /helv 12 Tf 72 700 Td [(ab) -200] TJ /hebo 12 Tf (cd) Tj ET",
    "charspacing": "BT /helv 12 Tf 2 Tc 72 700 Td (abcd) Tj ET",
    "wordspacing": "BT /helv 12 Tf 5 Tw 72 700 Td (ab cd) Tj ET",
    "invisible": "BT /helv 12 Tf 72 700 Td (seen ) Tj 3 Tr (unseen) Tj ET",
    "offpage": "BT /helv 12 Tf 72 900 Td (off page) Tj ET BT /helv 12 Tf 72 700 Td (on page) Tj ET",
    "cm": "q 2 0 0 2 0 0 cm BT /helv 6 Tf 36 350 Td (cm scaled) Tj ET Q",
    "big-then-small": "BT /helv 24 Tf 72 700 Td (Big) Tj ET BT /helv 10 Tf 72 680 Td (small) Tj ET",
    "small-then-big": "BT /helv 10 Tf 72 700 Td (small) Tj ET BT /helv 24 Tf 72 670 Td (Big) Tj ET",
    "header-footer": ("BT /helv 9 Tf 72 815 Td (Running header) Tj ET BT /helv 12 Tf 72 700 Td (Body) Tj ET "
                      "BT /helv 9 Tf 290 20 Td (7) Tj ET"),
}


def segmentation(doc):
    for stream in SEGMENTATION.values():
        page = doc.new_page(**A4)
        for base in PROBE_FONTS:
            page.insert_text((0, -100), "x", fontname=base, fontsize=1)
        doc.update_stream(page.get_contents()[0], stream.encode())


LATEX = r"""\documentclass[10pt]{article}
\usepackage[a4paper,margin=2.5cm]{geometry}
\title{Surface oxygen vacancies}
\author{Jane Doe\thanks{Imperial College London}}
\date{}
\begin{document}
\maketitle
\begin{abstract}
We study thin oxide films with photoelectron spectroscopy. The core-level
shifts are assigned to distinct chemical states.
\end{abstract}
\section{Introduction}
Oxide surfaces matter for catalysis and \textbf{electronics}; see the
\emph{review} and the code \texttt{fit\_peaks()}. Efficient fitting of
difficult spectra is needed, and E = mc$^2$ is used. The binding energies
were calibrated to the C~1s line at 284.8~eV and the spectra were fitted
with Voigt functions after a Shirley background was subtracted from each
region.

A second paragraph starts here with an indentation and continues over a
couple of lines so that the block holds several lines of justified text.
\subsection{Setup}
The spectrometer was a monochromated Al K$\alpha$ source.
\end{document}
"""


def tectonic_binary() -> str | None:
    for cand in (SRC / "packaging" / "bin" / "tectonic", shutil.which("tectonic")):
        if cand and Path(cand).exists():
            return str(cand)
    return None


def latex_pdf() -> bytes | None:
    """A real TeX-made PDF (xdvipdfmx, embedded CFF fonts), the way KherveTeX
    exports; None when tectonic or its cache is missing."""
    exe = tectonic_binary()
    if not exe:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        tex = Path(tmp) / "latex.tex"
        tex.write_text(LATEX, encoding="utf-8")
        run = subprocess.run([exe, "--only-cached", str(tex)], cwd=tmp,
                             capture_output=True)
        pdf = Path(tmp) / "latex.pdf"
        return pdf.read_bytes() if run.returncode == 0 and pdf.exists() else None


CASES = {
    "basic_paragraph": basic_paragraph,
    "heading_detected_by_size": heading_detected_by_size,
    "multi_page": multi_page,
    "progress_callback": progress_callback,
    "image_extraction": image_extraction,
    "article": article,
    "no_metadata": no_metadata,
    "html_mixed": html_mixed,
    "images": images,
    "segmentation": segmentation,
}
LATEX_PDF = latex_pdf()
if LATEX_PDF:
    CASES["latex_article"] = LATEX_PDF


# ---------------- dumping ----------------

def dump_pages(src) -> list:
    pages = []
    for page in src:
        td = page.get_text("dict", flags=pymupdf.TEXT_PRESERVE_WHITESPACE)
        blocks = []
        for blk in td.get("blocks", []):
            lines = []
            for line in blk.get("lines", []):
                spans = [{
                    "text": s["text"], "size": s["size"], "flags": s["flags"],
                    "font": s["font"], "bbox": list(s["bbox"]),
                    "color": s["color"], "alpha": s.get("alpha", 255),
                    "origin": list(s["origin"]),
                } for s in line.get("spans", [])]
                lines.append({"bbox": list(line["bbox"]), "dir": list(line["dir"]), "spans": spans})
            blocks.append({"type": blk.get("type"), "bbox": list(blk["bbox"]), "lines": lines})
        imgs = []
        for img_info in page.get_images(full=True):
            entry = {"xref": img_info[0]}
            try:
                pix = pymupdf.Pixmap(src, img_info[0])
                entry.update(width=pix.width, height=pix.height, alpha=bool(pix.alpha))
                if pix.alpha:
                    pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
                pix.tobytes("png")
                entry["png_ok"] = True
            except Exception as e:  # what Python's loop swallows
                entry["png_ok"] = False
                entry["error"] = type(e).__name__
            imgs.append(entry)
        pages.append({"width": page.rect.width, "height": page.rect.height,
                      "blocks": blocks, "images": imgs})
    return pages


def main() -> None:
    out: dict = {"pymupdf": pymupdf.VersionBind, "image_dir": IMAGE_DIR,
                 "segmentation_pages": list(SEGMENTATION), "cases": {}}
    with tempfile.TemporaryDirectory() as tmp:
        os.chdir(tmp)
        for name, build in CASES.items():
            if isinstance(build, bytes):
                data = build
            else:
                doc = pymupdf.open()
                build(doc)
                doc.subset_fonts()
                data = doc.tobytes(garbage=3, deflate=True)
                doc.close()
            path = Path(tmp) / f"{name}.pdf"
            path.write_bytes(data)
            with pymupdf.open(str(path)) as src:
                meta = src.metadata or {}
                pages = dump_pages(src)
            calls = []
            result = import_pdf(path, Path(IMAGE_DIR) / name,
                                progress=lambda c, t: calls.append([c, t]))
            out["cases"][name] = {
                "pdf": base64.b64encode(data).decode("ascii"),
                "metadata": {k: meta.get(k, "") or "" for k in ("title", "author", "keywords")},
                "pages": pages,
                "imported": model.to_json(result),
                "progress": calls,
            }
            print(f"{name}: {len(data)} bytes, {len(pages)} pages")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
