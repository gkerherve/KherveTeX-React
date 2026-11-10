"""Open each Word example (examples/word/docx/, made by
make_word_examples.cjs) the way KherveTeX's File > Open does
(importers.import_docx), save it as .ktex, and compile its LaTeX with
tectonic to check that it builds.

    ../KherveTeX/.venv/bin/python scripts/import_word_examples.py [folder]

Writes <folder>/ktex/<name>.ktex and <folder>/pdf/<name>.pdf (folder:
examples/word, its .docx files in docx/; another folder is searched with
its subfolders, as examples/word/web, real Word files from the web), and
prints one line per document: blocks by kind and whether the PDF built.
"""
from __future__ import annotations

import collections
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT.parent / "KherveTeX"))

from khervedoc import importers  # noqa: E402
from khervedoc.kdocz import save_kdocz  # noqa: E402

WORD = ROOT / "examples" / "word"


def main() -> int:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else WORD
    sources = (sorted((root / "docx").glob("*.docx")) if root == WORD
               else sorted(p for p in root.rglob("*.docx")
                           if p.parent.name not in ("ktex", "pdf")))
    ktex_dir = root / "ktex"
    pdf_dir = root / "pdf"
    ktex_dir.mkdir(exist_ok=True)
    pdf_dir.mkdir(exist_ok=True)
    tectonic = shutil.which("tectonic")
    failed = 0
    for docx in sources:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            try:
                doc = importers.import_docx(docx, tmp / f"{docx.stem}_images")
            except Exception as exc:
                failed += 1
                print(f"{docx.stem}: IMPORT FAILED: {exc}")
                continue
            out = ktex_dir / f"{docx.stem}.ktex"
            save_kdocz(doc, out)
            kinds = collections.Counter(type(b).__name__ for b in doc.children)
            summary = ", ".join(f"{n} {k}" for k, n in sorted(kinds.items()))
            built = "not compiled (no tectonic)"
            if tectonic:
                build = tmp / "build"
                with zipfile.ZipFile(out) as zf:
                    zf.extractall(build)
                r = subprocess.run([tectonic, "-X", "compile", "--keep-logs", "document.tex"],
                                   cwd=build, capture_output=True, text=True)
                pdf = build / "document.pdf"
                if r.returncode == 0 and pdf.exists():
                    shutil.copy(pdf, pdf_dir / f"{docx.stem}.pdf")
                    built = "PDF ok"
                else:
                    failed += 1
                    errors = [ln for ln in (r.stdout + r.stderr).splitlines() if "error" in ln.lower()]
                    built = "PDF FAILED: " + " | ".join(errors[:3])
            print(f"{docx.stem}: {summary} — {built}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
