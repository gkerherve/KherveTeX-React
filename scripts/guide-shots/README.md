# Screenshots for Help ▸ User guide

The pictures in `public/guide/` are taken from this app with headless Chrome.

```bash
npm run dev                                   # the app on http://localhost:5174
cd scripts/guide-shots
npm i --no-save --no-package-lock puppeteer-core@23.11.1   # once (ignored by git)
node tabs.mjs
node features.mjs [step ...]
```

The shots land in `scripts/guide-shots/out/` (2× resolution, WebP); copy the
ones you want to `public/guide/` (at most 2200 px wide). `desktop-window.webp`
(the window with the PDF beside the page) and the `pdf-*.webp` pages come from
the desktop app and from tectonic, not from these scripts.
