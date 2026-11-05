"""Write the projects parity corpus (tests/golden/project_flow.json).

Runs the Python KherveTeX's MainWindow offscreen (../KherveTeX, or the path
given) through whole project workflows — a document turned into a project,
documents added, reordered, unticked, added from elsewhere, removed; a new
project with page numbers from a compile log; a legacy .kdocproj.json
project converted — and stores, after each step, every file the project
code wrote: the folder's visible files, .kherve/ and .kherve/legacy/, each
working .tex (chapter bodies and the master), the project.json and
document.json inside each .ktex, and the Documents list's rows.
tests/project.parity.test.ts runs the same steps through
src/app/project.ts and requires the same files, byte for byte.

The editor is taken out of the loop (get_document returns the document last
set) so the corpus tests the project code, not the editor's round trip.

    QT_QPA_PLATFORM=offscreen .venv/bin/python scripts/make_golden_project.py [path/to/KherveTeX]
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import zipfile
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

HERE = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE.parent / "KherveTeX"
sys.path.insert(0, str(SRC))

from PySide6.QtCore import Qt  # noqa: E402
from PySide6.QtWidgets import QApplication, QFileDialog, QInputDialog, QMessageBox  # noqa: E402

from khervedoc.mainwindow import MainWindow  # noqa: E402
from khervedoc.model import (  # noqa: E402
    ChapterEntry, DocMeta, Document, Paragraph, Project, Section, Text,
    project_to_json, to_json,
)

OUT = HERE / "tests" / "golden" / "project_flow.json"
DIR = "<DIR>"


def snapshot(window, root: Path, label: str) -> dict:
    """Every file under `root` the project code writes, as text."""
    files: dict[str, str] = {}
    listing: list[str] = []
    for p in sorted(root.rglob("*")):
        rel = p.relative_to(root).as_posix()
        if rel.startswith(".git") or rel.startswith(".kherve/files") or p.is_dir():
            continue
        listing.append(rel)
        if p.suffix == ".tex" or p.name.endswith(".json"):
            files[rel] = p.read_text(encoding="utf-8").replace(str(root), DIR)
        elif p.suffix == ".ktex":
            with zipfile.ZipFile(p) as z:
                for name in ("project.json", "document.json"):
                    if name in z.namelist():
                        files[f"{rel}!{name}"] = z.read(name).decode("utf-8").replace(str(root), DIR)
    sb = window._project_sidebar
    rows = [sb._list.item(i).text() for i in range(sb._list.count())]
    proj = window._project
    return {
        "label": label,
        "listing": listing,
        "files": files,
        "rows": rows,
        "summary": sb._summary_label.text(),
        "title": sb._title_label.text(),
        "chapter_idx": window._project_chapter_idx,
        "project_path": (str(window._project_path).replace(str(root), DIR)
                         if window._project_path else None),
        "project": project_to_json(proj) if proj is not None else None,
    }


def make_window(monkey: list) -> MainWindow:
    w = MainWindow()
    w._kick_compile = lambda: None
    w._git_snapshot = lambda *a, **k: None
    last = {"doc": None}
    real_set = w._editor.set_document

    def set_document(doc):
        last["doc"] = doc
        real_set(doc)

    w._editor.set_document = set_document
    w._editor.get_document = lambda: last["doc"]
    return w


def answer_text(value: str) -> None:
    QInputDialog.getText = staticmethod(lambda *a, **k: (value, True))


def flow_convert(root: Path) -> list:
    w = make_window([])
    steps = []
    doc = Document(meta=DocMeta(title="My thesis"), children=[
        Section(level=1, children=[Text("Introduction")]),
        Section(level=2, children=[Text("Background")]),
        Paragraph(children=[Text("Original words with 50% & "),
                            Text("bold", marks=["bold"]), Text(".")])])
    w._editor.set_document(doc)
    path = root / "thesis.ktex.json"
    w._current_path = path
    w._write_to(path)
    w._update_title()
    steps.append(snapshot(w, root, "single"))
    answer_text("Methods")
    w._on_add_document()
    steps.append(snapshot(w, root, "convert"))
    answer_text("Results & Discussion")
    w._on_add_document()
    w._save_project()
    steps.append(snapshot(w, root, "add_second"))
    w._reorder_chapters([2, 0, 1])
    steps.append(snapshot(w, root, "reorder"))
    w._project_sidebar._list.item(1).setCheckState(Qt.Unchecked)
    w._save_project()
    steps.append(snapshot(w, root, "untick"))
    other = root.parent / f"{root.name}-elsewhere"
    other.mkdir()
    (other / "appendix.kdoc.json").write_text(to_json(Document(children=[
        Section(level=1, children=[Text("Appendix A")]),
        Paragraph(children=[Text("appendix words")])])), encoding="utf-8")
    (other / "extra.tex").write_text(
        "\\documentclass{article}\n\\begin{document}\n\\section{Extra}\n"
        "Some \\textbf{bold} text.\n\\end{document}\n", encoding="utf-8")
    (root / "old.kdoc.json").write_text(to_json(Document(children=[
        Paragraph(children=[Text("old words")])])), encoding="utf-8")
    w._add_existing_documents([str(other / "appendix.kdoc.json"), str(other / "extra.tex"),
                               str(root / "old.kdoc.json"), str(root / "thesis.ktex")])
    steps.append(snapshot(w, root, "add_existing"))
    w._project.chapters[3].chapter_type = "appendix"
    w._project.chapters[3].numbering = "roman"
    w._project_sidebar.set_project(w._project)
    w._save_project()
    steps.append(snapshot(w, root, "appendix"))
    QMessageBox.question = staticmethod(lambda *a, **k: QMessageBox.Yes)
    w._switch_chapter(1)
    w._remove_chapter(2)
    steps.append(snapshot(w, root, "remove"))
    w._remove_chapter(1)
    steps.append(snapshot(w, root, "remove_open"))
    w.close()
    return steps


def flow_new_project(root: Path) -> list:
    w = make_window([])
    steps = []
    answer_text("My Thesis: Part 1")
    QFileDialog.getExistingDirectory = staticmethod(lambda *a, **k: str(root))
    w._new_project()
    steps.append(snapshot(w, root, "new"))
    answer_text("Literature Review")
    w._on_add_document()
    answer_text("Literature Review")
    w._on_add_document()
    w._save_project()
    steps.append(snapshot(w, root, "add"))
    proj = w._project
    proj.chapters[0].chapter_type = "frontmatter"
    proj.chapters[0].numbering = "roman"
    for ch, pages in zip(proj.chapters, (3, 12, 7)):
        ch.last_known_pages = pages
    w._project_sidebar.recompute_auto_pages()
    steps.append(snapshot(w, root, "pages"))
    from types import SimpleNamespace
    import fitz
    pdf = root / ".kherve" / "out.pdf"
    d = fitz.open()
    for _ in range(14):
        d.new_page()
    d.save(pdf)
    pdf.with_suffix(".log").write_text(
        "KDOC:0:i:0\nKDOC:1:1:2\nKDOC:2:5:6\n"
        "KDOC:0:i:0\nKDOC:1:1:3\nKDOC:2:9:9\n", encoding="utf-8")
    w._page_counts_from_log(SimpleNamespace(pdf_path=pdf, log=""))
    pdf.unlink()
    pdf.with_suffix(".log").unlink()
    w._save_project()
    steps.append(snapshot(w, root, "log"))
    proj.auto_page_numbers = False
    proj.chapters[2].start_page = 40
    w._project_sidebar.set_project(proj)
    w._save_project()
    steps.append(snapshot(w, root, "manual_pages"))
    w.close()
    return steps


def flow_legacy(root: Path) -> list:
    w = make_window([])
    for name, words in (("Paper-1", "main words"), ("test2", "second")):
        (root / f"{name}.kdoc.json").write_text(to_json(Document(
            children=[Paragraph(children=[Text(words)])])), encoding="utf-8")
        (root / f"{name}.tex").write_text("old", encoding="utf-8")
    (root / "Paper.tex").write_text("old master", encoding="utf-8")
    proj = Project()
    proj.meta.title = "Paper"
    proj.chapters = [ChapterEntry(path="Paper-1.kdoc.json", label="Paper"),
                     ChapterEntry(path="test2.kdoc.json", label="test2")]
    pp = root / "Paper.kdocproj.json"
    pp.write_text(project_to_json(proj), encoding="utf-8")
    w._open_project_from_path(pp)
    steps = [snapshot(w, root, "open")]
    w._save_project()
    steps.append(snapshot(w, root, "converted"))
    w.close()
    return steps


def main() -> None:
    app = QApplication.instance() or QApplication([])
    out = {}
    for name, flow in (("convert", flow_convert), ("new_project", flow_new_project),
                       ("legacy", flow_legacy)):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "proj"
            root.mkdir()
            out[name] = flow(root)
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")
    del app


if __name__ == "__main__":
    main()
