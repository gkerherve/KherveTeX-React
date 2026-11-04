"""Write the Overleaf parity corpus (tests/golden/overleaf.json).

Runs the Python KherveTeX (../KherveTeX, or the path given) and stores what
its Overleaf code produces: git_url for a set of pasted links, _explain for a
set of git errors, the Download-for-Overleaf zip (entry names in order and
their bytes), the folder overleaf.write_project leaves (what Send pushes) and
what Get reads back from it (import_tex on the main file, as receive does
after the clone). tests/overleaf.parity.test.ts requires the TypeScript port
to produce the same.

    .venv/bin/python scripts/make_golden_overleaf.py [path/to/KherveTeX]
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE.parent / "KherveTeX"
sys.path.insert(0, str(SRC))

from khervedoc import model, overleaf  # noqa: E402
from khervedoc.importers import import_tex  # noqa: E402
from khervedoc.kdocz import export_latex_zip  # noqa: E402

OUT = HERE / "tests" / "golden" / "overleaf.json"
FOLDER = "<FOLDER>"
BASE = "<BASE>"

LINKS = [
    "https://www.overleaf.com/project/0123456789abcdef01234567",
    "https://git.overleaf.com/0123456789abcdef01234567",
    "0123456789abcdef01234567",
    "  https://www.overleaf.com/project/0123456789abcdef01234567?x=1  ",
    "https://www.overleaf.com/read/abcdef",
    "https://example.com/0123456789abcdef01234567",
    "/srv/git/project.git",
    "file:///srv/git/project.git",
    "0123456789ABCDEF01234567",
    "0123456789abcdef0123456",
    "x0123456789abcdef01234567",
    "",
    "   ",
    "my project",
]

ERRORS = [
    "unexpected http status code: 401",
    "403 Forbidden",
    "authentication required but no callback set",
    "Invalid Credentials",
    "unexpected http status code: 404",
    "repository Not Found",
    "fatal: '/x' does not appear to be a git repository",
    "failed to resolve address for git.overleaf.com",
    "",
]


def enc(data: bytes) -> str:
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return "base64:" + base64.b64encode(data).decode("ascii")


def scrub(text: str, *pairs: tuple[str, str]) -> str:
    for real, token in pairs:
        text = text.replace(real, token)
    return text


PNG = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\xff\xfe"
INPUTS = {
    "plot.png": PNG,
    "sketch.png": PNG + b"sketch",
    "sketch.svg": b"<svg xmlns='http://www.w3.org/2000/svg'/>",
    "sketch.pdf": b"%PDF-1.4 sketch",
    "flow.png": PNG + b"flow",
    "flow.pdf": b"%PDF-1.4 flow",
    "flow.flow.json": b'{"nodes": []}',
    "flow.tikz": b"\\begin{tikzpicture}\\end{tikzpicture}",
    "noext": b"raw bytes",
}


def figures_doc() -> model.Document:
    M = model
    return M.Document(meta=M.DocMeta(title="Figures and equations"), children=[
        M.Title(children=[M.Text("Figures and equations")]),
        M.Section(level=1, children=[M.Text("Intro")]),
        M.Paragraph(children=[M.Text("See the plot.")]),
        M.Figure(path="plot.png", caption="A plot", label="fig:plot"),
        M.Figure(path="sketch.png", caption="A drawing", source="drawing"),
        M.Figure(path="flow.png", caption="A flowchart", source="flowchart"),
        M.Figure(path="plot.png", caption="The plot again"),
        M.Figure(path="missing.png", caption="Not on disk"),
        M.Figure(path="noext", caption="No suffix"),
        M.MathBlock(latex="  E = mc^2  ", numbered=True, label="eq:e"),
        M.MathBlock(latex="a^2+b^2=c^2"),
        M.MathBlock(latex="   "),
        M.MathBlock(latex="x", numbered=True),
    ])


def shared_doc(text: str) -> model.Document:
    """tests/test_overleaf.py's _doc."""
    M = model
    return M.Document(meta=M.DocMeta(title="Shared"), children=[
        M.Title(children=[M.Text("Shared")]),
        M.Section(level=1, children=[M.Text("Intro")]),
        M.Paragraph(children=[M.Text(text)])])


def main() -> None:
    documents = json.loads((HERE / "tests" / "golden" / "documents.json")
                           .read_text(encoding="utf-8"))
    cases: list[tuple[str, model.Document, str, dict | None]] = [
        ("shared", shared_doc("Our first draft."), "main",
         {"kherveref.bib": "@misc{k,title={T}}\n"}),
        ("figures", figures_doc(), "main", None),
        ("figures-paper", figures_doc(), "paper",
         {"kherveref.bib": "@article{a,title={Ünïcode}}\n", "notes.txt": "x\n"}),
    ]
    for key in ("class-article-article", "class-article-welcome",
                "class-beamer-welcome", "class-book-article",
                "class-elsarticle-welcome", "class-IEEEtran-article"):
        cases.append((key, model.from_json(documents[key]["document_json"]),
                      "main", None))

    out: dict = {
        "git_url": [],
        "explain": [],
        "cache_key": {},
        "inputs": {k: base64.b64encode(v).decode("ascii")
                   for k, v in INPUTS.items()},
        "cases": {},
    }
    for link in LINKS:
        try:
            out["git_url"].append([link, overleaf.git_url(link), None])
        except overleaf.OverleafError as exc:
            out["git_url"].append([link, None, str(exc)])
    for text in ERRORS:
        out["explain"].append([text, str(overleaf._explain(Exception(text)))])
    for link in LINKS[:4]:
        out["cache_key"][link] = hashlib.sha1(link.encode()).hexdigest()[:12]

    cwd = os.getcwd()
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp).resolve()
        base = tmp / "base"
        base.mkdir()
        for name, data in INPUTS.items():
            (base / name).write_bytes(data)
        # Relative figure paths are tried against the working directory
        # first; run from an empty one so only base_dir matches.
        empty = tmp / "cwd"
        empty.mkdir()
        os.chdir(empty)
        try:
            for name, doc, main_name, extra in cases:
                pairs = ((str(base), BASE),)
                zpath = tmp / f"{name}.zip"
                export_latex_zip(doc, zpath, base, main_name=main_name)
                with zipfile.ZipFile(zpath) as zf:
                    entries = [[i.filename, scrub(enc(zf.read(i)), *pairs)]
                               for i in zf.infolist()]
                folder = tmp / f"{name}-project"
                folder.mkdir()
                main = overleaf.write_project(doc, base, folder, main_name,
                                              extra)
                files = sorted(
                    [p.relative_to(folder).as_posix(),
                     scrub(enc(p.read_bytes()), *pairs)]
                    for p in folder.rglob("*") if p.is_file())
                found = overleaf.main_tex(folder)
                back = import_tex(found.read_text(encoding="utf-8",
                                                  errors="replace"),
                                  base_dir=folder)
                out["cases"][name] = {
                    "document_json": model.to_json(doc),
                    "main_name": main_name,
                    "extra_files": extra,
                    "zip_entries": entries,
                    "project_files": files,
                    "main": main.relative_to(folder).as_posix(),
                    "main_tex": found.relative_to(folder).as_posix(),
                    "received_json": scrub(model.to_json(back),
                                           (str(folder), FOLDER), *pairs),
                }
        finally:
            os.chdir(cwd)

    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n",
                   encoding="utf-8")
    print(f"wrote {OUT} ({len(out['cases'])} cases)")


if __name__ == "__main__":
    main()
