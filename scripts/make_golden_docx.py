"""Write the Word (.docx) parity corpus and the embedded python-docx template.

Runs the Python KherveTeX (../KherveTeX, or the path given) with
python-docx 1.2 and stores what it produces:

  tests/golden/docx.json
    import   .docx fixtures built with python-docx (plus raw OOXML for
             equations, footnotes, numbering, merged cells, broken files),
             each with what importers.import_docx makes of it: the
             document.json and the images it extracts.
    export   documents (every gallery example and hand-made ones covering
             each branch of docx_exporter) with what export_docx writes:
             word/document.xml, the other generated parts, the zip entry
             order, and what import_docx reads back from that file.
    files    the image files the export documents reference.

  src/core/docxTemplate.ts
    The package python-docx saves for an untouched docx.Document() (its
    default.docx after one lxml round trip), base64. docxExport.ts starts
    from it exactly as export_docx starts from docx.Document(); every part
    the exporter never changes is copied from it byte for byte.

Run it with the KherveTeX virtualenv (python-docx, Pillow):

    ../KherveTeX/.venv/bin/python scripts/make_golden_docx.py [path/to/KherveTeX]
"""
from __future__ import annotations

import base64
import io
import json
import os
import struct
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE.parent / "KherveTeX"
sys.path.insert(0, str(SRC))

import docx  # noqa: E402
from docx.enum.style import WD_STYLE_TYPE  # noqa: E402
from docx.enum.text import WD_ALIGN_PARAGRAPH  # noqa: E402
from docx.oxml import parse_xml  # noqa: E402
from docx.oxml.ns import nsdecls, qn  # noqa: E402
from docx.shared import Inches  # noqa: E402
from PIL import Image  # noqa: E402

from khervedoc import model as M  # noqa: E402
from khervedoc.examples import GALLERY  # noqa: E402
from khervedoc.docx_exporter import export_docx  # noqa: E402
from khervedoc.importers import _classify_style, import_docx  # noqa: E402
from khervedoc.word_math import convert  # noqa: E402

OUT = HERE / "tests" / "golden" / "docx.json"
TEMPLATE_TS = HERE / "src" / "core" / "docxTemplate.ts"

assert docx.__version__ == "1.2.0", f"python-docx {docx.__version__}: the port mirrors 1.2.0"

b64 = lambda b: base64.b64encode(b).decode("ascii")  # noqa: E731
NS_M = "http://schemas.openxmlformats.org/officeDocument/2006/math"


def err(e: Exception) -> str:
    return f"!ERROR {type(e).__name__}"


# ---------------------------------------------------------------- images

def png_bytes(w, h, dpi=None, color=(200, 30, 30)):
    b = io.BytesIO()
    kw = {"dpi": dpi} if dpi else {}
    Image.new("RGB", (w, h), color).save(b, "PNG", **kw)
    return b.getvalue()


def img_bytes(fmt, w, h, **kw):
    b = io.BytesIO()
    Image.new("RGB", (w, h), (20, 120, 200)).save(b, fmt, **kw)
    return b.getvalue()


def exif_jpeg(w, h):
    im = Image.new("RGB", (w, h), (90, 160, 40))
    exif = Image.Exif()
    exif[0x011A] = 300  # XResolution
    exif[0x011B] = 150
    exif[0x0128] = 2
    b = io.BytesIO()
    im.save(b, "JPEG", exif=exif.tobytes())
    data = b.getvalue()
    # Drop Pillow's JFIF APP0 so the APP1 Exif segment comes first and
    # python-docx reads it as an Exif image (dpi from the TIFF header).
    if data[6:10] == b"JFIF":
        seg = struct.unpack(">H", data[4:6])[0]
        data = data[:2] + data[4 + seg:]
    assert data[6:10] == b"Exif", data[:12]
    return data


FILES = {
    "figs/plot.png": png_bytes(300, 200, dpi=(150, 150)),
    "figs/plain.png": png_bytes(7, 3),
    "figs/same.png": png_bytes(300, 200, dpi=(150, 150)),  # identical bytes: one part
    "figs/UPPER.PNG": png_bytes(40, 40, dpi=(72, 72), color=(1, 2, 3)),
    "figs/photo.jpg": img_bytes("JPEG", 64, 48, dpi=(96, 96)),
    "figs/photo2.jpeg": img_bytes("JPEG", 33, 17, dpi=(200, 100)),
    "figs/exif.jpg": exif_jpeg(50, 25),
    "figs/anim.gif": img_bytes("GIF", 21, 13),
    "figs/bitmap.bmp": img_bytes("BMP", 19, 11),
    "figs/scan.tiff": img_bytes("TIFF", 23, 29, dpi=(300, 300)),
    "figs/mislabeled.jpg": png_bytes(12, 12),  # PNG bytes, .jpg name
    "figs/noext": png_bytes(5, 9),
    "figs/odd name & <x>.png": png_bytes(8, 8, color=(9, 9, 9)),
    "figs/not-an-image.png": b"this is not an image",
}


# ---------------------------------------------------------------- fixtures

def body_append(d, xml: str):
    body = d.element.body
    body.insert(len(body) - 1, parse_xml(xml))


def W(inner: str) -> str:
    return f'<w:p {nsdecls("w", "r", "m", "a", "wp", "pic")}>{inner}</w:p>'


def saved(d) -> bytes:
    b = io.BytesIO()
    d.save(b)
    return b.getvalue()


FIXED_TIME = (1980, 1, 1, 0, 0, 0)


def rezip(data: bytes, replace=None, delete=(), add=None) -> bytes:
    replace = replace or {}
    src = zipfile.ZipFile(io.BytesIO(data))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for info in src.infolist():
            if info.filename in delete:
                continue
            blob = src.read(info.filename)
            if info.filename in replace:
                r = replace[info.filename]
                blob = r(blob) if callable(r) else r
            z.writestr(zipfile.ZipInfo(info.filename, date_time=FIXED_TIME), blob, zipfile.ZIP_DEFLATED)
        for name, blob in (add or {}).items():
            z.writestr(zipfile.ZipInfo(name, date_time=FIXED_TIME), blob, zipfile.ZIP_DEFLATED)
    return out.getvalue()


def sub(old: str, new: str):
    def f(b: bytes) -> bytes:
        s = b.decode("utf-8")
        assert old in s, old
        return s.replace(old, new, 1).encode("utf-8")
    return f


def fx_styles_and_marks():
    d = docx.Document()
    d.core_properties.author = "Jane Doe"
    d.add_paragraph("A Study of Things", style="Title")
    d.add_paragraph("A smaller subtitle", style="Subtitle")
    for lvl in range(1, 10):
        d.add_paragraph(f"Heading level {lvl}", style=f"Heading {lvl}")
    d.add_paragraph("Figure 1: a caption", style="Caption")
    d.add_paragraph("Quoted text", style="Quote")
    p = d.add_paragraph()
    for text, kw in [("bold", "b"), ("italic", "i"), ("under", "u"), ("strike", "s"),
                     ("sub", "sub"), ("sup", "sup"), ("caps", "sc"), ("plain", "")]:
        r = p.add_run(text + " ")
        if kw == "b":
            r.bold = True
        elif kw == "i":
            r.italic = True
        elif kw == "u":
            r.underline = True
        elif kw == "s":
            r.font.strike = True
        elif kw == "sub":
            r.font.subscript = True
        elif kw == "sup":
            r.font.superscript = True
        elif kw == "sc":
            r.font.small_caps = True
    r = p.add_run("all")
    r.bold = r.italic = r.underline = True
    r.font.strike = r.font.small_caps = r.font.superscript = True
    for align in (WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.CENTER,
                  WD_ALIGN_PARAGRAPH.RIGHT, WD_ALIGN_PARAGRAPH.JUSTIFY,
                  WD_ALIGN_PARAGRAPH.DISTRIBUTE, WD_ALIGN_PARAGRAPH.THAI_JUSTIFY):
        d.add_paragraph(f"aligned {align}").alignment = align
    body_append(d, W('<w:pPr><w:jc w:val="start"/></w:pPr><w:r><w:t>start jc</w:t></w:r>'))
    body_append(d, W('<w:pPr><w:jc/></w:pPr><w:r><w:t>jc without val</w:t></w:r>'))
    body_append(d, W('<w:pPr><w:jc w:val="end"/><w:jc w:val="center"/></w:pPr><w:r><w:t>two jc</w:t></w:r>'))
    body_append(d, W(
        '<w:r><w:rPr><w:b w:val="0"/><w:i w:val="false"/></w:rPr><w:t>off but present</w:t></w:r>'
        '<w:r><w:rPr><w:u w:val="none"/></w:rPr><w:t>u none</w:t></w:r>'
        '<w:r><w:rPr><w:u/></w:rPr><w:t>u bare</w:t></w:r>'
        '<w:r><w:rPr><w:u w:val="double"/></w:rPr><w:t>u double</w:t></w:r>'
        '<w:r><w:rPr><w:vertAlign w:val="baseline"/></w:rPr><w:t>baseline</w:t></w:r>'
        '<w:r><w:rPr><w:vertAlign/></w:rPr><w:t>vert no val</w:t></w:r>'
        '<w:r><w:rPr><w:dstrike/><w:caps/></w:rPr><w:t>dstrike caps</w:t></w:r>'
        '<w:r><w:t xml:space="preserve">  spaced  </w:t></w:r>'
        '<w:r><w:t></w:t></w:r>'
        '<w:r><w:tab/></w:r>'
        '<w:r><w:t>first</w:t><w:tab/><w:t>second</w:t></w:r>'
        '<w:r><w:tab/><w:t>after tab</w:t></w:r>'
        '<w:r><w:rPr><w:b/></w:rPr></w:r>'
        '<w:ins w:id="1" w:author="x"><w:r><w:t>inserted</w:t></w:r></w:ins>'
        '<w:smartTag w:uri="u" w:element="e"><w:r><w:t>smart</w:t></w:r></w:smartTag>'
        '<w:fldSimple w:instr="PAGE"><w:r><w:t>7</w:t></w:r></w:fldSimple>'
        '<w:r><w:t>ünïcødé 𝔘 &amp; &lt;tags&gt; "q" \u00a0nbsp</w:t></w:r>'
        '<w:r><w:t><![CDATA[cdata <x>]]></w:t></w:r>'
    ))
    body_append(d, W('<w:r><w:t xml:space="preserve">   </w:t></w:r>'))
    body_append(d, W('<w:pPr><w:pStyle w:val="Caption"/></w:pPr>'
                     '<w:r><w:rPr><w:i/></w:rPr><w:t>already italic</w:t></w:r>'
                     '<w:r><w:rPr><w:b/></w:rPr><w:t> bold caption</w:t></w:r>'
                     '<w:hyperlink w:anchor="x"><w:r><w:t> link in caption</w:t></w:r></w:hyperlink>'))
    body_append(d, W('<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>'))
    body_append(d, W('<w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Second </w:t></w:r>'
                     '<w:r><w:rPr><w:b/></w:rPr><w:t>title</w:t></w:r>'))
    body_append(d, W(''))
    return saved(d)


def fx_custom_styles():
    d = docx.Document()
    st = d.styles
    names = ["ThesisTitle", "1.1 Heading3", "Heading2", "heading 12", "MySubtitle",
             "Author Name", "Abstract Text", "Figure Caption", "Bullet List",
             "  Title  ", "HEADING 4", "Sub Title", "Sub-Title", "My Body Text",
             "Kapitel Überschrift", "Heading ٣", "chapter"]
    for n in names:
        s = st.add_style(n, WD_STYLE_TYPE.PARAGRAPH)
        d.add_paragraph(f"text in {n.strip()}", style=s)
    cs = st.add_style("Emphasis Char", WD_STYLE_TYPE.CHARACTER)
    body_append(d, W(f'<w:pPr><w:pStyle w:val="{cs.style_id}"/></w:pPr><w:r><w:t>char style id</w:t></w:r>'))
    body_append(d, W('<w:pPr><w:pStyle w:val="NoSuchStyle"/></w:pPr><w:r><w:t>missing id</w:t></w:r>'))
    body_append(d, W('<w:pPr><w:pStyle w:val=""/></w:pPr><w:r><w:t>empty id</w:t></w:r>'))
    # A style with no w:name, one with no w:type (not a paragraph style),
    # and a second default paragraph style (the last one wins).
    styles = st.element
    styles.append(parse_xml(f'<w:style {nsdecls("w")} w:type="paragraph" w:styleId="Nameless"/>'))
    styles.append(parse_xml(f'<w:style {nsdecls("w")} w:styleId="Untyped"><w:name w:val="Heading 2"/></w:style>'))
    styles.append(parse_xml(f'<w:style {nsdecls("w")} w:type="paragraph" w:default="1" w:styleId="MyDef">'
                            '<w:name w:val="My Default Heading 3"/></w:style>'))
    body_append(d, W('<w:pPr><w:pStyle w:val="Nameless"/></w:pPr><w:r><w:t>nameless style</w:t></w:r>'))
    body_append(d, W('<w:pPr><w:pStyle w:val="Untyped"/></w:pPr><w:r><w:t>untyped style</w:t></w:r>'))
    body_append(d, W('<w:r><w:t>no pStyle: the last default style</w:t></w:r>'))
    return saved(d)


def fx_hyperlinks():
    d = docx.Document()
    p = d.add_paragraph("See ")
    part = d.part
    r1 = part.relate_to("https://example.org/a?b=1&c=2", docx.opc.constants.RELATIONSHIP_TYPE.HYPERLINK, is_external=True)
    r_int = [k for k, v in part.rels.items() if v.reltype.endswith("/styles")][0]
    p._p.append(parse_xml(
        f'<w:hyperlink {nsdecls("w", "r")} r:id="{r1}"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr>'
        '<w:t>the site</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t> bold part</w:t></w:r></w:hyperlink>'))
    p.add_run(" and ")
    p._p.append(parse_xml(f'<w:hyperlink {nsdecls("w")} w:anchor="sec1"><w:r><w:t>anchor</w:t></w:r></w:hyperlink>'))
    p._p.append(parse_xml(f'<w:hyperlink {nsdecls("w", "r")} r:id="{r1}"></w:hyperlink>'))
    p._p.append(parse_xml(f'<w:hyperlink {nsdecls("w", "r")} r:id="rId999"><w:r><w:t>dangling</w:t></w:r></w:hyperlink>'))
    p._p.append(parse_xml(f'<w:hyperlink {nsdecls("w", "r")} r:id="{r_int}"><w:r><w:t>internal</w:t></w:r></w:hyperlink>'))
    p._p.append(parse_xml(f'<w:hyperlink {nsdecls("w", "r")} r:id=""><w:r><w:t>empty id</w:t></w:r></w:hyperlink>'))
    p._p.append(parse_xml(f'<w:hyperlink {nsdecls("w", "r")} r:id="{r1}"><w:ins w:id="2" w:author="a">'
                          '<w:r><w:t>nested ins</w:t></w:r></w:ins><w:r><w:t></w:t></w:r></w:hyperlink>'))
    return saved(d)


FOOTNOTES_XML = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>'
    '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>'
    '<w:footnote w:id="1"><w:p><w:r><w:t>First note.</w:t></w:r><w:r><w:t>More</w:t></w:r></w:p></w:footnote>'
    '<w:footnote w:id="2"><w:p><w:r><w:t>Second note.</w:t></w:r></w:p></w:footnote>'
    '</w:footnotes>')


def fx_footnotes():
    d = docx.Document()
    p = d.add_paragraph("Claim")
    for fid in ("1", "2", "0", "-1", "x", "77"):
        p._p.append(parse_xml(f'<w:r {nsdecls("w")}><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>'
                              f'<w:footnoteReference w:id="{fid}"/></w:r>'))
    p._p.append(parse_xml(f'<w:r {nsdecls("w")}><w:footnoteReference/></w:r>'))
    d.add_paragraph("After")
    data = saved(d)
    rel = ('<Relationship Id="rId90" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
           'relationships/footnotes" Target="footnotes.xml"/></Relationships>')
    ct = ('<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-'
          'officedocument.wordprocessingml.footnotes+xml"/></Types>')
    return rezip(data, replace={
        "word/_rels/document.xml.rels": sub("</Relationships>", rel),
        "[Content_Types].xml": sub("</Types>", ct),
    }, add={"word/footnotes.xml": FOOTNOTES_XML.encode()})


NUMBERING_EXTRA = (
    '<w:abstractNum {ns} w:abstractNumId="90">'
    '<w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl>'
    '<w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl>'
    '<w:lvl w:ilvl="2"><w:numFmt w:val="lowerRoman"/></w:lvl>'
    '<w:lvl w:ilvl="3"><w:numFmt w:val="none"/></w:lvl>'
    '<w:lvl w:ilvl="4"></w:lvl>'
    '<w:lvl w:ilvl="4"><w:numFmt w:val="upperLetter"/></w:lvl>'
    '<w:lvl w:ilvl="5"><w:numFmt/></w:lvl>'
    '</w:abstractNum>'
)


def fx_lists():
    d = docx.Document()
    numbering = d.part.numbering_part.element
    first_num = numbering.find(qn("w:num"))
    first_num.addprevious(parse_xml(NUMBERING_EXTRA.format(ns=nsdecls("w"))))
    numbering.append(parse_xml(f'<w:num {nsdecls("w")} w:numId="90"><w:abstractNumId w:val="90"/></w:num>'))
    numbering.append(parse_xml(f'<w:num {nsdecls("w")} w:numId="91"></w:num>'))
    numbering.append(parse_xml(f'<w:num {nsdecls("w")} w:numId="92"><w:abstractNumId w:val="404"/></w:num>'))

    def item(text, num, ilvl=None, style=None):
        ppr = ""
        if style:
            ppr += f'<w:pStyle w:val="{style}"/>'
        if num is not None:
            lv = f'<w:ilvl w:val="{ilvl}"/>' if ilvl is not None else ""
            ppr += f'<w:numPr>{lv}<w:numId w:val="{num}"/></w:numPr>'
        body_append(d, W(f'<w:pPr>{ppr}</w:pPr><w:r><w:t>{text}</w:t></w:r>'))

    d.add_paragraph("Intro")
    item("one", 90, 0)
    item("two", 90, 0)
    item("nested bullet", 90, 1)
    item("roman", 90, 2)
    item("none fmt", 90, 3)
    item("lvl without fmt then fmt", 90, 4)
    item("empty fmt", 90, 5)
    item("missing ilvl", 90)
    item("unknown num", 91, 0)
    item("missing abstract", 92, 0)
    item("template bullet", 2, 0)
    item("template decimal", 1, 0)
    item("numId zero", 0, 0)
    item("styled bullet", None, style="ListBullet")
    item("styled number", None, style="ListNumber")
    item("list paragraph", None, style="ListParagraph")
    d.add_paragraph("Break")
    item("after break", 90, 0)
    body_append(d, W('<w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>numPr without numId</w:t></w:r>'))
    body_append(d, W('<w:pPr><w:numPr><w:numId/></w:numPr></w:pPr><w:r><w:t>numId without val</w:t></w:r>'))
    body_append(d, W('<w:pPr><w:pPrChange w:id="5" w:author="a"><w:pPr><w:numPr><w:ilvl w:val="0"/>'
                     '<w:numId w:val="90"/></w:numPr></w:pPr></w:pPrChange></w:pPr><w:r><w:t>numPr in change</w:t></w:r>'))
    body_append(d, W('<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="90"/></w:numPr></w:pPr>'))
    item("trailing", 90, 0)
    return saved(d)


def fx_lists_no_numbering():
    d = docx.Document()
    body_append(d, W('<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>a</w:t></w:r>'))
    body_append(d, W('<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>b</w:t></w:r>'))
    d.add_paragraph("styled", style="List Number")
    data = saved(d)
    return rezip(data, delete={"word/numbering.xml"}, replace={
        "word/_rels/document.xml.rels": lambda b: b.replace(
            b'<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
            b'relationships/numbering" Target="numbering.xml"/>', b""),
    })


def fx_tables():
    d = docx.Document()
    d.add_paragraph("Before")
    t = d.add_table(rows=3, cols=3)
    for r in range(3):
        for c in range(3):
            t.cell(r, c).text = f" r{r}c{c} "
    t.cell(0, 0).merge(t.cell(0, 1))
    t.cell(1, 2).merge(t.cell(2, 2))
    t.cell(2, 0).add_paragraph("second para")
    inner = t.cell(1, 1).add_table(rows=1, cols=1)
    inner.cell(0, 0).text = "inner"
    d.add_paragraph("Between")
    body_append(d, (
        f'<w:tbl {nsdecls("w")}><w:tblPr/><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>'
        '<w:tr></w:tr>'
        '<w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr><w:tc><w:p><w:r><w:t>shifted</w:t></w:r></w:p></w:tc></w:tr>'
        '<w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>top</w:t></w:r></w:p></w:tc>'
        '<w:tc><w:p><w:hyperlink><w:r><w:t>linked</w:t></w:r></w:hyperlink><w:r><w:tab/><w:t>x</w:t>'
        '<w:br/><w:t>y</w:t><w:br w:type="page"/><w:cr/><w:noBreakHyphen/><w:ptab/></w:r></w:p></w:tc></w:tr>'
        '<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr>'
        '<w:sdt><w:sdtContent><w:tr><w:tc><w:p><w:r><w:t>in sdt</w:t></w:r></w:p></w:tc></w:tr></w:sdtContent></w:sdt>'
        '</w:tbl>'))
    body_append(d, f'<w:tbl {nsdecls("w")}><w:tblPr/><w:tblGrid/></w:tbl>')
    d.add_paragraph("After")
    return saved(d)


def fx_table_bad_vmerge():
    d = docx.Document()
    body_append(d, (f'<w:tbl {nsdecls("w")}><w:tblPr/><w:tblGrid><w:gridCol/></w:tblGrid>'
                    '<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>'))
    return saved(d)


def fx_images():
    d = docx.Document()
    tmp = Path(tempfile.mkdtemp())
    for name in ("figs/plot.png", "figs/photo.jpg", "figs/anim.gif"):
        p = tmp / Path(name).name
        p.write_bytes(FILES[name])
    d.add_paragraph("Text before")
    d.add_paragraph().add_run().add_picture(str(tmp / "plot.png"), width=Inches(2))
    para = d.add_paragraph("Caption-ish text with ")
    para.add_run().add_picture(str(tmp / "photo.jpg"))
    para.add_run(" an inline photo")
    para = d.add_paragraph()
    para.add_run().add_picture(str(tmp / "anim.gif"))
    para.add_run().add_picture(str(tmp / "plot.png"))
    para = d.add_paragraph()
    para.add_run().add_picture(str(tmp / "plot.png"))
    para.add_run("   ")
    rid = d.part.relate_to("https://x.org", docx.opc.constants.RELATIONSHIP_TYPE.HYPERLINK, is_external=True)
    para = d.add_paragraph()
    para.add_run().add_picture(str(tmp / "photo.jpg"))
    para._p.append(parse_xml(f'<w:hyperlink {nsdecls("w", "r")} r:id="{rid}"><w:r><w:t>only a link</w:t></w:r></w:hyperlink>'))
    body_append(d, W('<w:r><w:drawing><a:blip r:embed="rId404"/><a:blip r:embed=""/><a:blip/></w:drawing>'
                     '<w:t>broken blips</w:t></w:r>'))
    body_append(d, W(f'<w:r><w:drawing><a:blip r:embed="{rid}"/></w:drawing><w:t>external blip</w:t></w:r>'))
    lst = d.add_paragraph("bullet", style="List Bullet")
    lst = d.add_paragraph(style="List Bullet")
    lst.add_run().add_picture(str(tmp / "anim.gif"))
    d.add_paragraph("bullet after image", style="List Bullet")
    return saved(d)


def fx_numbered_headings():
    # Headings numbered by a Word list (manuals: "1.2 Mounting"), and a
    # table laying out instructions beside a screenshot.
    d = docx.Document()
    tmp = Path(tempfile.mkdtemp())
    (tmp / "plot.png").write_bytes(FILES["figs/plot.png"])
    for text, lvl in (("Intro", 0), ("Holder", 1), ("Clips", 2), ("No level", None), ("Deep", 7)):
        lv = f'<w:ilvl w:val="{lvl}"/>' if lvl is not None else ""
        body_append(d, W(f'<w:pPr><w:pStyle w:val="Heading1"/><w:numPr>{lv}<w:numId w:val="1"/></w:numPr>'
                         f'</w:pPr><w:r><w:t>{text}</w:t></w:r>'))
    body_append(d, W('<w:pPr><w:pStyle w:val="Heading2"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/>'
                     '</w:numPr></w:pPr><w:r><w:t>Style deeper</w:t></w:r>'))
    body_append(d, W('<w:pPr><w:pStyle w:val="Title"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/>'
                     '</w:numPr></w:pPr><w:r><w:t>Numbered title</w:t></w:r>'))
    t = d.add_table(rows=2, cols=2)
    t.cell(0, 0).text = "Open the software"
    t.cell(0, 0).add_paragraph("Click Start", style="List Number")
    t.cell(0, 1).paragraphs[0].add_run().add_picture(str(tmp / "plot.png"))
    t.cell(1, 0).text = "Then wait"
    inner = t.cell(1, 1).add_table(rows=1, cols=1)
    inner.cell(0, 0).text = "nested"
    d.add_paragraph("After")
    plain = d.add_table(rows=1, cols=2)
    plain.cell(0, 0).text = "a"
    plain.cell(0, 1).text = "b"
    return saved(d)


def emf_dib(width, height, bits, palette=b"", extra_record=None):
    """An EMF wrapping one bitmap in EMR_STRETCHDIBITS, as Word stores a
    pasted screenshot; extra_record makes it a real (vector) metafile."""
    import struct
    stride = ((width * bits + 31) // 32) * 4
    pixels = bytes((7 * k + 3) % 256 for k in range(stride * abs(height)))
    bmi = struct.pack("<IiiHHIIiiII", 40, width, height, 1, bits, 0, len(pixels), 0, 0,
                      len(palette) // 4, 0) + palette
    off_bmi = 80
    off_bits = off_bmi + len(bmi)
    size = off_bits + len(pixels)
    rec = (struct.pack("<II4i", 81, size, 0, 0, width, abs(height))
           + struct.pack("<6i", 0, 0, 0, 0, width, abs(height))
           + struct.pack("<IIIIII", off_bmi, len(bmi), off_bits, len(pixels), 0, 0x00CC0020)
           + struct.pack("<ii", width, abs(height)) + bmi + pixels)
    header = struct.pack("<II", 1, 16) + b"\0" * 8
    out = header + rec
    if extra_record:
        out += extra_record
    return out + struct.pack("<II", 14, 20) + b"\0" * 12


def fx_emf_images():
    import struct
    d = docx.Document()
    tmp = Path(tempfile.mkdtemp())
    for k in range(5):
        (tmp / f"p{k}.png").write_bytes(png_bytes(2, 2, color=(10 * k, 20, 30)))
        d.add_paragraph().add_run().add_picture(str(tmp / f"p{k}.png"))
    d.add_paragraph("After")
    pal = b"".join(bytes((k, 255 - k, 2 * k % 256, 0)) for k in range(4))
    blobs = {
        "image1.png": emf_dib(5, 3, 24),
        "image2.png": emf_dib(3, -2, 32),
        "image3.png": emf_dib(6, 2, 8, pal),
        "image4.png": emf_dib(2, 2, 24, extra_record=struct.pack("<II", 27, 16) + b"\0" * 8),
        "image5.png": b"\xd7\xcd\xc6\x9a" + b"\0" * 40,
    }
    exts = {"image1.png": "emf", "image2.png": "emf", "image3.png": "emf", "image4.png": "emf",
            "image5.png": "wmf"}
    data = saved(d)
    import io, zipfile
    zin = zipfile.ZipFile(io.BytesIO(data))
    names = sorted(n for n in zin.namelist() if n.startswith("word/media/"))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            body = zin.read(item.filename)
            name = item.filename
            if name.startswith("word/media/"):
                continue
            if name == "word/_rels/document.xml.rels":
                txt = body.decode()
                for k, n in enumerate(names):
                    base = n.split("/")[-1]
                    txt = txt.replace(f'Target="media/{base}"',
                                      f'Target="media/m{k}.{exts[list(exts)[k]]}"')
                body = txt.encode()
            if name == "[Content_Types].xml":
                body = body.replace(b"</Types>", b'<Default Extension="emf" ContentType="image/x-emf"/>'
                                    b'<Default Extension="wmf" ContentType="image/x-wmf"/></Types>')
            zout.writestr(item, body)
        for k, n in enumerate(names):
            key = list(exts)[k]
            zout.writestr(f"word/media/m{k}.{exts[key]}", blobs[key])
    return out.getvalue()


def omath(inner: str) -> str:
    return f"<m:oMath>{inner}</m:oMath>"


def mr(t: str) -> str:
    return f"<m:r><m:t>{t}</m:t></m:r>"


EQUATIONS = [
    mr("E=m") + f"<m:sSup><m:e>{mr('c')}</m:e><m:sup>{mr('2')}</m:sup></m:sSup>",
    f"<m:f><m:num>{mr('a')}</m:num><m:den>{mr('b')}</m:den></m:f>",
    f"<m:sSub><m:e>{mr('x')}</m:e><m:sub>{mr('i')}</m:sub></m:sSub>",
    f"<m:sSubSup><m:e>{mr('x')}</m:e><m:sub>{mr('i')}</m:sub><m:sup>{mr('2')}</m:sup></m:sSubSup>",
    f"<m:rad><m:radPr><m:degHide m:val=\"1\"/></m:radPr><m:deg/><m:e>{mr('x')}</m:e></m:rad>",
    f"<m:rad><m:deg>{mr('3')}</m:deg><m:e>{mr('y')}</m:e></m:rad>",
    f"<m:nary><m:naryPr><m:chr m:val=\"∑\"/></m:naryPr><m:sub>{mr('i=1')}</m:sub><m:sup>{mr('n')}</m:sup><m:e>{mr('i')}</m:e></m:nary>",
    f"<m:nary><m:naryPr><m:chr m:val=\"∫\"/></m:naryPr><m:sub>{mr('0')}</m:sub><m:sup>{mr('1')}</m:sup><m:e>{mr('f(x)dx')}</m:e></m:nary>",
    f"<m:d><m:dPr><m:begChr m:val=\"[\"/><m:endChr m:val=\"]\"/></m:dPr><m:e>{mr('a')}</m:e><m:e>{mr('b')}</m:e></m:d>",
    f"<m:m><m:mr><m:e>{mr('1')}</m:e><m:e>{mr('0')}</m:e></m:mr><m:mr><m:e>{mr('0')}</m:e><m:e>{mr('1')}</m:e></m:mr></m:m>",
    f"<m:acc><m:accPr><m:chr m:val=\"̂\"/></m:accPr><m:e>{mr('x')}</m:e></m:acc>",
    f"<m:func><m:fName>{mr('sin')}</m:fName><m:e>{mr('θ')}</m:e></m:func>",
    f"<m:limLow><m:e>{mr('lim')}</m:e><m:lim>{mr('n→∞')}</m:lim></m:limLow>",
    f"<m:bar><m:e>{mr('z')}</m:e></m:bar>",
    f"<m:eqArr><m:e>{mr('a=1')}</m:e><m:e>{mr('b=2')}</m:e></m:eqArr>",
]


def fx_equations():
    d = docx.Document()
    for i, eq in enumerate(EQUATIONS):
        body_append(d, W(f'<w:r><w:t xml:space="preserve">Inline {i}: </w:t></w:r>{omath(eq)}'
                         '<w:r><w:t xml:space="preserve"> after.</w:t></w:r>'))
        body_append(d, W(f'<m:oMathPara>{omath(eq)}</m:oMathPara>'))
    body_append(d, W(f'<w:pPr><w:pStyle w:val="Heading2"/></w:pPr>{omath(EQUATIONS[0])}'))
    body_append(d, W(f'<w:pPr><w:pStyle w:val="ListBullet"/></w:pPr>{omath(EQUATIONS[1])}'))
    body_append(d, W(f'<w:pPr><w:jc w:val="center"/></w:pPr><m:oMathPara>{omath(EQUATIONS[2])}</m:oMathPara>'
                     '<w:r><w:tab/><w:t>(1)</w:t></w:r>'))
    return saved(d)


def fx_plain():
    d = docx.Document()
    d.add_paragraph("Just one paragraph.")
    return saved(d)


def fx_no_styles_part():
    d = docx.Document()
    d.add_paragraph("Heading?", style="Heading 1")
    d.add_paragraph("Title?", style="Title")
    d.add_paragraph("Body")
    return rezip(saved(d), delete={"word/styles.xml"}, replace={
        "word/_rels/document.xml.rels": lambda b: b.replace(
            b'<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
            b'relationships/styles" Target="styles.xml"/>', b""),
    })


def fx_no_core_props():
    d = docx.Document()
    d.add_paragraph("No core properties")
    return rezip(saved(d), delete={"docProps/core.xml"}, replace={
        "_rels/.rels": lambda b: b.replace(
            b'<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/package/2006/'
            b'relationships/metadata/core-properties" Target="docProps/core.xml"/>', b""),
    })


def fx_core_author_whitespace():
    d = docx.Document()
    d.add_paragraph("x")
    return rezip(saved(d), replace={
        "docProps/core.xml": lambda b: b.replace(b"<dc:creator>python-docx</dc:creator>",
                                                 b"<dc:creator>  Ann &amp; Bob  </dc:creator>"),
    })


def fx_body_comment():
    d = docx.Document()
    d.add_paragraph("before")
    return rezip(saved(d), replace={"word/document.xml": sub("<w:body>", "<w:body><!-- comment -->")})


def fx_para_comment():
    d = docx.Document()
    d.add_paragraph("before")
    return rezip(saved(d), replace={"word/document.xml": sub("<w:t>before</w:t></w:r>",
                                                             "<w:t>before</w:t></w:r><!-- c -->")})


def fx_pstyle_without_val():
    d = docx.Document()
    body_append(d, W('<w:pPr><w:pStyle/></w:pPr><w:r><w:t>x</w:t></w:r>'))
    return saved(d)


def fx_bad_style_type():
    d = docx.Document()
    d.styles.element.append(parse_xml(f'<w:style {nsdecls("w")} w:type="bogus" w:styleId="Bogus"><w:name w:val="B"/></w:style>'))
    d.add_paragraph("no pStyle → default_for iterates every style")
    return saved(d)


def fx_wrong_main_content_type():
    d = docx.Document()
    d.add_paragraph("macro?")
    return rezip(saved(d), replace={"[Content_Types].xml": sub(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        "application/vnd.ms-word.document.macroEnabled.main+xml")})


def fx_missing_part():
    d = docx.Document()
    d.add_paragraph("x")
    return rezip(saved(d), delete={"word/fontTable.xml"})


def fx_not_a_zip():
    return b"PK\x03\x04 definitely not a docx"


IMPORT_FIXTURES = {
    "styles_and_marks": fx_styles_and_marks,
    "custom_styles": fx_custom_styles,
    "hyperlinks": fx_hyperlinks,
    "footnotes": fx_footnotes,
    "lists": fx_lists,
    "lists_no_numbering": fx_lists_no_numbering,
    "tables": fx_tables,
    "table_bad_vmerge": fx_table_bad_vmerge,
    "images": fx_images,
    "numbered_headings": fx_numbered_headings,
    "emf_images": fx_emf_images,
    "equations": fx_equations,
    "plain": fx_plain,
    "no_styles_part": fx_no_styles_part,
    "no_core_props": fx_no_core_props,
    "core_author_whitespace": fx_core_author_whitespace,
    "body_comment": fx_body_comment,
    "para_comment": fx_para_comment,
    "pstyle_without_val": fx_pstyle_without_val,
    "bad_style_type": fx_bad_style_type,
    "wrong_main_content_type": fx_wrong_main_content_type,
    "missing_part": fx_missing_part,
    "not_a_zip": fx_not_a_zip,
}


def run_import(data: bytes) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        cwd = os.getcwd()
        os.chdir(tmp)
        try:
            Path("in.docx").write_bytes(data)
            try:
                doc = import_docx(Path("in.docx"), Path("images"))
                result = M.to_json(doc)
            except Exception as e:  # a crash is behaviour too
                result = err(e)
            images = {}
            if Path("images").is_dir():
                for p in sorted(Path("images").iterdir()):
                    images[p.name] = b64(p.read_bytes())
        finally:
            os.chdir(cwd)
    return {"imported_json": result, "images": images}


# ---------------------------------------------------------------- export documents

T = M.Text


def export_docs() -> dict[str, M.Document]:
    docs: dict[str, M.Document] = {}
    # Every gallery example, named as scripts/make_golden.py names them.
    slug = lambda s: "".join(c if c.isalnum() else "-" for c in s.lower()).strip("-")  # noqa: E731
    cwd = os.getcwd()
    os.chdir(tempfile.mkdtemp(prefix="ktex-docx-golden-"))  # factories may write files
    try:
        for category, label, factory, _blurb in GALLERY:
            docs[f"example-{slug(category)}-{slug(label)}"] = factory()
    finally:
        os.chdir(cwd)

    docs["inlines"] = M.Document(meta=M.DocMeta(title="Inlines & <marks>", author="A. Author"), children=[
        M.Paragraph(children=[
            T("bold", ["bold"]), T(" italic", ["italic"]), T(" under", ["underline"]),
            T(" strike", ["strikethrough"]), T(" sub", ["subscript"]), T(" sup", ["superscript"]),
            T(" sc", ["smallcaps"]), T(" code", ["code"]),
            T(" all", ["superscript", "code", "smallcaps", "subscript", "strikethrough", "underline", "italic", "bold"]),
            T(" twice", ["underline", "underline", "bold", "bold", "code", "code"]),
            T(" unknown", ["sparkle"]),
            M.MathInline(latex="E=mc^2"),
            M.Footnote(children=[T("a "), M.MathInline(latex="x"), T("note")]),
            M.Citation(keys=["knuth", "lamport"], style="citep"), M.Citation(keys=[]),
            M.CrossRef(label="fig:a", kind="eqref"),
            M.InlineRaw(latex="\\Kstroke"),
        ], alignment="left"),
        M.Paragraph(children=[
            M.Link(url="https://example.org/?a=1&b=<2>\"", children=[T("link text "), T("more", ["bold"]),
                                                                     M.MathInline(latex="x'"), M.CrossRef(label="q")]),
            M.Link(url="https://example.org/?a=1&b=<2>\"", children=[T("same url")]),
            M.Link(url="mailto:x@y.z", children=[]),
            M.Link(url="", children=[T("")]),
        ], alignment="right"),
        M.Paragraph(children=[
            M.Highlight(children=[T("hl", ["italic"]), T("two")], color="green"),
            M.Highlight(children=[T("pinkish")], color="pink"),
            M.Highlight(children=[M.Link(url="u", children=[T("l")])], color="orange"),
            M.Highlight(children=[], color="nope"),
            M.Comment(children=[T("annotated", ["bold"])], note="a note", author="me"),
            M.Comment(children=[T("silent")], note=""),
            M.Highlight(children=[M.Comment(children=[T("c")], note="n")], color="blue"),
        ], alignment="center"),
        M.Paragraph(children=[T(" lead\ttab\nnewline\r\ncrlf trail ")], alignment="justify"),
        M.Paragraph(children=[T("weird alignment")], alignment="sideways"),
        M.Paragraph(children=[], alignment="left"),
        M.Paragraph(children=[T("ünïcødé 𝔘 \u00a0 \u2028 \x85 & <x> \"q\" 'a'")]),
    ])
    docs["blocks"] = M.Document(
        meta=M.DocMeta(title="", author="", margin_top_cm=1.0, margin_bottom_cm=3.333,
                       margin_left_cm=0.0, margin_right_cm=2.54),
        children=[
            M.Title(children=[T("The Title", ["bold"])]),
            M.Author(children=[T("Ann"), M.Footnote(children=[T("Uni")])]),
            M.Affiliation(children=[T("Dept"), T(" of X", ["italic"])]),
            M.Correspondence(children=[T("ann@x.org", ["italic"])]),
            M.Abstract(children=[T("Abstract text "), T("bold", ["bold"]),
                                 M.Highlight(children=[T("hl")])]),
            M.Keywords(children=[T("a; b; c")]),
            M.Keywords(children=[]),
            M.Section(level=1, children=[T("One")]),
            M.Section(level=2, children=[T("Two")]),
            M.Section(level=3, children=[T("Three")]),
            M.Section(level=4, children=[T("Four")]),
            M.Section(level=5, children=[T("Five")]),
            M.Section(level=7, children=[T("Seven")]),
            M.Section(level=0, children=[]),
            M.Theorem(kind="theorem", title="Main", children=[T("Statement.")]),
            M.Theorem(kind="lemma", title="", children=[T("Lemma body.")]),
            M.Theorem(kind="proof", children=[T("Trivial.")]),
            M.Theorem(kind="theorem", start=False, children=[T("continued")]),
            M.Theorem(kind="conjecture-ish", title="x", children=[]),
            M.List(ordered=False, items=[M.ListItem(children=[T("a")]), M.ListItem(children=[T("b", ["bold"])])]),
            M.List(ordered=True, items=[M.ListItem(children=[T("one")]), M.ListItem(children=[])]),
            M.List(ordered=True, items=[]),
            M.MathBlock(latex="\\int_0^1 f(x)\\,dx", numbered=True, label="eq:a"),
            M.MathBlock(latex=""),
            M.RawLatex(text="\\vspace{1em}\n\\noindent"),
            M.RawLatex(text=""),
            M.Frame(children=[T("Slide")]),
            M.Paragraph(children=[T("end")]),
        ])
    docs["tables"] = M.Document(children=[
        M.Table(rows=[["Name", "A", "B"], ["x", "1", ""], ["y", "2", "3"], ["", "4", "5"]],
                caption="T", label="tab:t", alignment="lcr",
                merges=[[1, 1, 1, 2], [2, 0, 2, 1]], header=True, repeat_header=True,
                shading={"1,1": "#ffeb3b", "0,2": "abcdef", " 3 , 0 ": "#0f0"}),
        M.Table(rows=[["only"]], caption="", repeat_header=True),
        M.Table(rows=[["a", "b", "c", "d"], ["e", "f", "g", "h"], ["i", "j", "k", "l"]],
                merges=[[0, 0, 2, 2], [1, 3, 2, 1], [0, 2, 1, 2]], caption="Merged & <shaded>",
                shading={"2,2": "#123456", "-1,-1": "#ffffff"}),
        M.Table(rows=[["a", "b"], ["c", "d", "extra"], ["e"]], caption="ragged"),
        M.Table(rows=[["x\ty", "line1\nline2", " pad "]]),
        M.Table(rows=[[]], caption="no columns"),
        M.Table(rows=[], caption="no rows"),
        M.Table(rows=[["a", "b"], ["c", "d"]], merges=[[0, 0, 5, 5]]),
        M.Table(rows=[["a", "b"], ["c", "d"]], merges=[[1, 1, 1, 1]]),
    ])
    docs["figures"] = M.Document(children=[
        M.Figure(path="figs/plot.png", caption="A plot", align="left"),
        M.Figure(path="figs/plain.png", caption="", align="right"),
        M.Figure(path="figs/same.png", caption="same bytes"),
        M.Figure(path="figs/plot.png", caption="again"),
        M.Figure(path="figs/UPPER.PNG"),
        M.Figure(path="figs/photo.jpg", align="middle"),
        M.Figure(path="figs/photo2.jpeg"),
        M.Figure(path="figs/exif.jpg"),
        M.Figure(path="figs/anim.gif"),
        M.Figure(path="figs/bitmap.bmp"),
        M.Figure(path="figs/scan.tiff"),
        M.Figure(path="figs/mislabeled.jpg"),
        M.Figure(path="figs/noext"),
        M.Figure(path="figs/odd name & <x>.png", caption="odd"),
        M.Figure(path="figs/missing.png", caption="not there"),
        M.Paragraph(children=[T("after figures")]),
    ])
    docs["figure_not_image"] = M.Document(children=[M.Figure(path="figs/not-an-image.png")])
    docs["figure_empty_path"] = M.Document(children=[M.Figure(path="")])
    docs["control_char"] = M.Document(children=[M.Paragraph(children=[T("bell\x07")])])
    docs["long_title"] = M.Document(meta=M.DocMeta(title="t" * 256))
    docs["title_255"] = M.Document(meta=M.DocMeta(title="𝔘" * 255, author="x\ry"))
    docs["empty"] = M.Document()
    docs["negative_margin"] = M.Document(meta=M.DocMeta(margin_left_cm=-1.0))
    docs["bad_merge"] = M.Document(children=[M.Table(rows=[["a", "b"], ["c", "d"]], merges=[[0, 0, 1, 2], [0, 1, 2, 1]])])
    docs["bad_shading_key"] = M.Document(children=[M.Table(rows=[["a"]], shading={"0": "#fff"})])
    return docs


def zip_entries(data: bytes) -> tuple[list[str], dict[str, str]]:
    z = zipfile.ZipFile(io.BytesIO(data))
    names = [i.filename for i in z.infolist()]
    texts = {}
    for n in ("[Content_Types].xml", "docProps/core.xml", "word/_rels/document.xml.rels", "word/document.xml"):
        texts[n] = z.read(n).decode("utf-8")
    return names, texts


def run_export(doc: M.Document, workdir: Path) -> dict:
    entry = {"document_json": M.to_json(doc)}
    cwd = os.getcwd()
    os.chdir(workdir)
    try:
        out = Path("out.docx")
        if out.exists():
            out.unlink()
        try:
            export_docx(doc, out)
        except Exception as e:
            entry["error"] = err(e)
            return entry
        data = out.read_bytes()
        names, texts = zip_entries(data)
        entry["entries"] = names
        entry["parts"] = texts
        z = zipfile.ZipFile(io.BytesIO(data))
        entry["media"] = {n: b64(z.read(n)) for n in names if n.startswith("word/media/")}
        rt = run_import(data)
        entry["roundtrip_json"] = rt["imported_json"]
        entry["roundtrip_images"] = sorted(rt["images"])
    finally:
        os.chdir(cwd)
    return entry


# ---------------------------------------------------------------- small functions

STYLE_NAMES = [
    "", "Title", "title", " Title ", "Subtitle", "Heading 1", "heading 1", "Heading 6",
    "Heading 7", "Heading 0", "Heading9", "heading  3", "HEADING 2", "Heading ٣", "Heading ²",
    "1.1 Heading3", "ThesisTitle", "MySubtitle", "Sub title", "Sub-title", "Author",
    "Author Name", "Abstract", "AbstractHeading 2", "Caption", "Figure Caption",
    "List Paragraph", "List Bullet 2", "Checklist", "Normal", "Body Text", "Quote",
    "Kapitel", "ſubtitle", "TITLE PAGE", "Heading 1 Char", None,
]

WORD_MATH = [
    "Ln = −⟨P⟩hi,     Rn = −⟨P⟩lo\t\t(2)", "E = mc²", "ΔG = −nFE", "sin θ ≤ 1",
    "x₁ + x₂ = 3", "Emax = ħω/2", "(3)", "\u00a0a\u2028=\u00a0b\u00a0", "⟨P⟩hi",
    "a = b\t(12b)", "a = b (1.2)", "f(x) = ∑ᵢ xᵢ²", "Tₘₐₓ = 300 K", "∫₀¹ x dx = ½",
    "α + β → γ", "lim x→∞ 1/x = 0", "v = √(2gh)", "ΔHᵣ° = −285.8 kJ", "[A]ab + (B)cd",
    "ln Kₑq = −ΔG°/RT", "Pr(A) ≈ 0.5 ± 0.1", "x ∈ ℝ, ∀ε > 0", "a,  b,   c", "Å = 10⁻¹⁰ m",
    "ABCD + Abcde + Ab + AB", "\\text{x}", "", "   ", "naïve café",
]


# ---------------------------------------------------------------- template

def write_template() -> bytes:
    data = saved(docx.Document())
    z = zipfile.ZipFile(io.BytesIO(data))
    names = [i.filename for i in z.infolist()]
    # Same entries, same bytes, fixed timestamps: regenerating the module
    # only changes it when python-docx's output does.
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zo:
        for n in names:
            zo.writestr(zipfile.ZipInfo(n, date_time=(1980, 1, 1, 0, 0, 0)), z.read(n),
                        compress_type=zipfile.ZIP_DEFLATED)
    b = b64(out.getvalue())
    lines = [b[i:i + 100] for i in range(0, len(b), 100)]
    TEMPLATE_TS.write_text(
        "// GENERATED by scripts/make_golden_docx.py — do not edit.\n"
        "// The package python-docx 1.2.0 saves for an untouched docx.Document():\n"
        "// its templates/default.docx after one lxml load/save round trip. Every\n"
        "// part export_docx leaves alone is copied from here byte for byte.\n"
        f"// Entries: {', '.join(names)}\n\n"
        "export const DOCX_TEMPLATE_B64 =\n"
        + " +\n".join(f"  '{ln}'" for ln in lines) + "\n",
        encoding="utf-8")
    return data


def main() -> None:
    write_template()
    corpus: dict = {"python_docx": docx.__version__, "import": {}, "export": {}, "files": {}}
    corpus["classify_style"] = [[n, *_classify_style(n, None)] for n in STYLE_NAMES]
    corpus["word_math"] = [[t, *convert(t)] for t in WORD_MATH]
    for name, build in IMPORT_FIXTURES.items():
        data = build()
        if zipfile.is_zipfile(io.BytesIO(data)):
            data = rezip(data)  # fixed timestamps: the corpus only changes with the code
        entry = {"docx": b64(data)}
        entry.update(run_import(data))
        corpus["import"][name] = entry
    corpus["files"] = {k: b64(v) for k, v in FILES.items()}
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for rel, blob in FILES.items():
            (work / rel).parent.mkdir(parents=True, exist_ok=True)
            (work / rel).write_bytes(blob)
        for name, doc in export_docs().items():
            corpus["export"][name] = run_export(doc, work)
    OUT.write_text(json.dumps(corpus, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    errors = sorted(k for k, v in corpus["import"].items() if v["imported_json"].startswith("!ERROR"))
    print(f"wrote {OUT.relative_to(HERE)} ({OUT.stat().st_size // 1024} KB): "
          f"{len(corpus['import'])} import fixtures ({len(errors)} raise), "
          f"{len(corpus['export'])} export documents")
    print(f"wrote {TEMPLATE_TS.relative_to(HERE)}")


if __name__ == "__main__":
    main()
