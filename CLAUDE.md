# CLAUDE.md — working conventions for KherveTeX-React

Project: the React + TypeScript rewrite of KherveTeX (`../KherveTeX`, Python /
PySide6). It must be an exact behavioural copy: same `.ktex` files, same
generated LaTeX and Typst byte for byte, same ribbon, menus and commands.
Stack: Vite, React 19, TypeScript, Vitest; Tauri 2 shell from Phase 1
(tectonic as a bundled binary, git2-rs for git, pdf.js for the preview).

## Branching: `dev` is the working branch

All work goes on `dev`. `main` lags behind until the user asks for a merge.
Never work in a git worktree or on a throwaway branch.

## Always commit and push after any change

Commit after every change; push to `origin/dev` once a remote exists (none
yet — the GitHub repo is created only when the user says so).

## Version

`package.json` `version` is `"<major>.<minor>.0"`; bump the minor on any
user-visible change, in the same commit. Every commit message starts with
`v<major>.<minor>: ` (e.g. `v0.1: phase 0 core`).

## Parity with the Python app is the specification

- `src/core/` is a function-for-function port of `khervedoc/` (model.py →
  model.ts, serializer.py → serializer.ts, ...). Keep the Python structure
  and order so the two can be diffed side by side; carry over its *why*
  comments.
- `scripts/make_golden.py` runs the Python app and writes
  `tests/golden/*.json`; the `*.parity.test.ts` files require identical
  output. After changing the Python serializer/importer, re-run
  `npm run golden` and port the change here in the same week.
- Python semantics that JavaScript gets wrong live in `src/core/py.ts`:
  floats print as `2.0` (`pyFloat`), `str.strip()` whitespace, `round()`
  half-to-even (`pyFixed`), `len()` in code points. Use them.
- Field names in the model stay snake_case: they are the JSON on disk.
- Ported Python unit tests keep their Python test names.

## Architectural invariants (from KherveTeX)

- The document model (`src/core/model.ts`) is the single source of truth.
  Never build LaTeX strings outside `serializer.ts`.
- `src/core/` has no React, DOM or Tauri imports; file access is injected
  (`FileAccess` in kdocz.ts) so it runs in Vitest and in the app.
- Toolbar icons are drawn in code (`src/ui/icons.tsx`) — no PNG/SVG files.
- The ribbon is KherveTeX's Word-style ribbon; keep its look. Its contents
  are data in `src/ui/ribbonModel.ts`, mirroring `mainwindow.py`.
- The light palette is intentional.

## Commands

- `npm test` — all Vitest suites (parity + ported unit tests)
- `npm run golden` — regenerate the parity corpus from `../KherveTeX`
- `npm run dev` — the app in a browser at http://localhost:5174
- `npx tsc -b` — type-check
