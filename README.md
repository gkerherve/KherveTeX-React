# KherveTeX (React)

The React + TypeScript rewrite of [KherveTeX](https://github.com/gkerherve/kherveTeX),
the WYSIWYG editor that writes LaTeX and keeps its history in Git. It is an
exact copy: it opens and saves the same `.ktex` files, and generates the same
LaTeX and Typst, byte for byte. Each phase is checked against the Python app's
own output.

## Status: Phase 0 — the core, and the ribbon

- `src/core/model.ts`: the document model, with `document.json` identical to Python's.
- `src/core/serializer.ts`: model → LaTeX, covering single documents, chapter bodies and project masters.
- `src/core/typstSerializer.ts`: model → Typst.
- `src/core/importers.ts`: `.tex` and Markdown → model.
- `src/core/kdocz.ts`: the `.ktex` container, which the Python app opens too.
- `src/ui/`: KherveTeX's Word-style ribbon, with icons drawn in code. Its commands are not wired up yet.

Next phases: the Tauri shell, tectonic compile and PDF preview (1); the
visual editor (2); equations (3); git, Overleaf, KherveRef, and Word/PDF
import (4); drawing, MCP, spell check, updater and installers (5).

## Develop

```bash
npm install --legacy-peer-deps
npm run dev        # http://localhost:5174
npm test           # parity corpus + ported Python unit tests
npm run golden     # regenerate tests/golden from ../KherveTeX
```
