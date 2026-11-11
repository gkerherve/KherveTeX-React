# CLAUDE.md — working conventions for KherveTeX-React

Project: KherveTeX in React + TypeScript. It began as a rewrite of the
Python / PySide6 app (`../KherveTeX`); since 2026-11-11 **this is the only
version under development**. The Python app is frozen: never change it,
never port features to it, and never build a feature there first. It still
reads and writes the same `.ktex` files, so keep the file format compatible.
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

## Where the code came from (the Python port)

- `src/core/` started as a function-for-function port of `khervedoc/`
  (model.py → model.ts, serializer.py → serializer.ts, ...). New work is
  designed here directly; the Python structure need not be kept.
- `tests/golden/*.json` were written by the Python app (`npm run golden`).
  They are now a frozen regression corpus: the `*.parity.test.ts` files
  check the output stays the same. When a change here is meant to alter
  the output, update the golden files from this app's own output (never
  by running the Python app), and say so in the commit.
- Python semantics that JavaScript gets wrong live in `src/core/py.ts`:
  floats print as `2.0` (`pyFloat`), `str.strip()` whitespace, `round()`
  half-to-even (`pyFixed`), `len()` in code points. Use them.
- Field names in the model stay snake_case: they are the JSON on disk.
- Tests ported from Python keep their Python test names.

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

- `npm test` — all Vitest suites (golden regression + unit tests)
- `npm run dev` — the app in a browser at http://localhost:5174
- `npx tsc -b` — type-check
