# KherveTeX (React)

The React + TypeScript rewrite of [KherveTeX](https://github.com/gkerherve/kherveTeX),
the WYSIWYG editor that writes LaTeX and keeps its history in Git. It is an
exact copy: it opens and saves the same `.ktex` files, and generates the same
LaTeX and Typst, byte for byte. Each phase is checked against the Python app's
own output.

## Status

Every phase of the port is in: the core (model, LaTeX/Typst serializers,
.tex/.md/.docx/.pdf importers, .ktex container), the Tauri desktop app with
its bundled tectonic and offline TeX cache, the pdf.js preview and two-way
Code tab, the paged visual editor, equations and chemistry, drawings and
flowcharts, spell check, git history and branches, KherveRef citations,
Overleaf, projects, the MCP server for Claude, the updater and the release
workflows. Each part is checked against the Python app's own output
(`npm run golden` regenerates the corpora).

Not yet run: the release workflows (Windows and Intel macOS builds). The
updater needs a public release feed, and the repo secret
`TAURI_SIGNING_PRIVATE_KEY`.

## Develop

```bash
npm install --legacy-peer-deps
npm run dev        # http://localhost:5174
npm test           # parity corpus + ported Python unit tests
npm run golden     # regenerate tests/golden from ../KherveTeX
npx tauri build --bundles app --no-sign   # the desktop app
node scripts/smoke_test.mjs src-tauri/target/release/bundle/macos/KherveTeX.app  # offline compile check
```
