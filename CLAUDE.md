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

Commit after every change and push to `origin/dev`
(https://github.com/gkerherve/KherveTeX-React).

## Name and version

The big name is KherveTeX, the short name **kTeX** (2026-11-13): it shows
in the title bar, splash, Welcome, About, update messages and release
titles (`SHORT_NAME` in `src/version.ts`). Since 2026-11-22 the installed
app is **kTeX** too (owner's request): `productName` in tauri.conf.json,
so `kTeX.app`, the `kTeX_N...` installers and the file-type name. The bundle
identifier (`com.kerherve.khervetex`, which also names the settings
folder), the repo, the Cargo crate and the MCP server keep "KherveTeX".

Like kCAD, the version is the commit count: `package.json` `version` is
`"<N>.0.0"` with N = `git rev-list --count HEAD` + 1 (the commit being
made), shown `vN`. Set it in every commit, and every commit message
starts with `v<N>: `. Release tags are `vN`. As semver N.0.0 is newer
than the old `0.338.0`, so copies on the old numbering update to it
with no bridge release. Commits before the switch keep their old
numbers (v0.1 to v0.79, then v0.336 to v0.338). 2026-11-16: the owner
set the running number to **v401**, so the next commit is v402 (use the
number in `package.json` + 1, not the raw commit count).

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
