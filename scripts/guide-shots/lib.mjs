import puppeteer from 'puppeteer-core'
export const OUT = new URL('./out/', import.meta.url).pathname
export async function start(w = 1440, h = 900) {
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
    args: [`--window-size=${w},${h}`, '--hide-scrollbars', '--font-render-hinting=none'] })
  const page = await browser.newPage()
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 })
  await page.goto('http://localhost:5174/', { waitUntil: 'networkidle0' })
  await sleep(1500)
  return { browser, page }
}
export const sleep = ms => new Promise(r => setTimeout(r, ms))
const DIALOGS = new Set(['equation-builder','flowchart','drawing','chart','smartart','preferences','chemistry','symbols','shortcuts','about','references-manager'])
export async function shot(page, name, clip) {
  await sleep(350)
  if (!clip && DIALOGS.has(name)) {
    clip = await page.evaluate(() => { const ds = [...document.querySelectorAll('.dlg, [role=dialog], .kwin, .kd-dialog')].filter(d => d.getBoundingClientRect().width > 100); const d = ds[ds.length - 1]; if (!d) return null; const b = d.getBoundingClientRect(); const m = 14; return { x: Math.max(0, b.left - m), y: Math.max(0, b.top - m), width: Math.min(innerWidth - Math.max(0, b.left - m), b.width + 2 * m), height: Math.min(innerHeight - Math.max(0, b.top - m), b.height + 2 * m) } }) ?? undefined
  }
  await page.screenshot({ path: OUT + name + '.webp', type: 'webp', quality: 82, ...(clip ? { clip } : {}) })
  console.log('shot', name)
}
// click the first element matching selector whose text (trimmed) starts with txt
export async function clickText(page, sel, txt, opts = {}) {
  const ok = await page.evaluate((sel, txt, exact) => {
    const el = [...document.querySelectorAll(sel)].find(e => exact ? e.textContent.trim() === txt : e.textContent.trim().includes(txt))
    if (!el) return false
    el.scrollIntoView?.({ block: 'nearest' })
    const r = el.getBoundingClientRect(); window.__c = [r.left + r.width / 2, r.top + r.height / 2]; return true
  }, sel, txt, !!opts.exact)
  if (!ok) throw new Error('not found: ' + sel + ' ' + txt)
  const [x, y] = await page.evaluate(() => window.__c)
  await page.mouse.click(x, y, { clickCount: opts.count ?? 1 })
  await sleep(opts.wait ?? 400)
}
export async function tab(page, name) { await clickText(page, '.rb-tab', name, { exact: true }) }
export async function tour(page) {
  await clickText(page, 'label', 'Visual only')
  await clickText(page, 'button', 'Take the guided tour')
  await sleep(1500)
}
export async function closeDialogs(page) { await page.keyboard.press('Escape'); await sleep(300) }
export async function hideNoise(page) {
  await page.addStyleTag({ content: `.toast,[class*="toast"]{display:none!important}` })
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('body *')) {
      if (el.childElementCount === 0 && /browser version cannot run tectonic/.test(el.textContent)) { let p = el; for (let i = 0; i < 3 && p.parentElement && p.parentElement !== document.body; i++) p = p.parentElement; el.closest('div').style.display = 'none' }
    }
  })
}
// click the deepest element whose own trimmed text equals / contains txt
export async function leaf(page, txt, opts = {}) {
  const p = await page.evaluate((txt, exact, within) => {
    const root = within ? document.querySelector(within) : document.body
    const all = [...root.querySelectorAll('*')].filter(e => { const t = e.textContent.replace(/\s+/g, ' ').trim(); return (exact ? t === txt : t.includes(txt)) && e.getBoundingClientRect().width > 0 })
    const el = all.filter(e => !all.some(o => o !== e && e.contains(o)))[0]
    if (!el) return null
    el.scrollIntoView({ block: 'nearest' })
    const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]
  }, txt, opts.exact !== false, opts.within)
  if (!p) throw new Error('leaf not found: ' + txt)
  await page.mouse.click(p[0], p[1], { clickCount: opts.count ?? 1 })
  await sleep(opts.wait ?? 450)
}
export async function fresh(browser) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })
  await page.goto('http://localhost:5174/', { waitUntil: 'networkidle0' }); await sleep(1200)
  await tour(page); await hideNoise(page)
  return page
}
export async function textAt(page, needle) {
  return page.evaluate((needle) => {
    const w = document.createTreeWalker(document.querySelector('.ProseMirror'), NodeFilter.SHOW_TEXT); let n
    while ((n = w.nextNode())) { const i = n.data.indexOf(needle); if (i >= 0) { n.parentElement.scrollIntoView({ block: 'center' }); const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1); const b = r.getBoundingClientRect(); return [b.left + 1, b.top + b.height / 2] } }
    return null }, needle)
}
