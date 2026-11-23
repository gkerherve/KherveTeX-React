import { start, shot, tab, sleep, leaf, fresh, textAt } from './lib.mjs'
const { browser, page: p0 } = await start(); await p0.close()
const W = 1440
const only = process.argv.slice(2)
const step = async (name, fn) => { if (only.length && !only.includes(name)) return; const page = await fresh(browser); try { await fn(page) } catch (e) { console.log('FAIL', name, e.message.slice(0, 140)) } await page.close() }
const lbl = (page, t, o = {}) => leaf(page, t, { within: '.ribbon', ...o })
const clickWord = async (page, needle, count = 1) => { await textAt(page, needle); await sleep(300); const q = await textAt(page, needle); if (!q) throw new Error('no text ' + needle); await page.mouse.click(q[0], q[1], { clickCount: count }); await sleep(500) }

await step('toc', async page => {
  await clickWord(page, 'is a word processor'); await page.keyboard.press('Home')
  await tab(page, 'Insert'); await lbl(page, 'Table of Contents'); await leaf(page, 'Automatic Table (2 levels)'); await sleep(900)
  await leaf(page, 'Contents', { within: '.kt-toc' }); await sleep(300)
  await page.evaluate(() => { const t = document.querySelector('.kt-toc'); t.scrollIntoView({ block: 'start' }); const sc = (function f(e) { return e && (e.scrollHeight > e.clientHeight + 5 && getComputedStyle(e).overflowY !== 'visible' ? e : f(e.parentElement)) })(t.parentElement); if (sc) sc.scrollTop -= 200 })
  await sleep(400); await shot(page, 'toc', { x: 0, y: 150, width: 1440, height: 720 })
})
await step('symbol', async page => { await tab(page, 'Insert'); await lbl(page, 'Symbol', { exact: false }); await sleep(900); await shot(page, 'symbols') })
await step('themes', async page => { await tab(page, 'Design'); await lbl(page, 'Themes'); await shot(page, 'design-themes', { x: 0, y: 0, width: 900, height: 620 }) })
await step('colours', async page => { await tab(page, 'Design'); await lbl(page, 'Colours'); await shot(page, 'design-colours', { x: 300, y: 0, width: 900, height: 700 }) })
await step('watermark', async page => { await tab(page, 'Design'); await lbl(page, 'Watermark'); await shot(page, 'design-watermark', { x: 500, y: 0, width: 900, height: 620 }) })
await step('watermark-page', async page => { await tab(page, 'Design'); await lbl(page, 'Watermark'); await leaf(page, 'DRAFT', { exact: false, within: 'body' }).catch(() => leaf(page, 'Draft', { exact: false })); await sleep(800); await page.evaluate(() => document.querySelector('.kt-flow').scrollIntoView()); await shot(page, 'design-watermark-page') })
await step('margins', async page => { await tab(page, 'Layout'); await lbl(page, 'Margins'); await shot(page, 'layout-margins', { x: 0, y: 0, width: 760, height: 640 }) })
await step('columns', async page => { await tab(page, 'Layout'); await lbl(page, 'Columns'); await shot(page, 'layout-columns', { x: 0, y: 0, width: 900, height: 500 }) })
await step('shortcuts', async page => { await tab(page, 'Help'); await lbl(page, 'Keyboardshortcuts', { exact: false }).catch(() => lbl(page, 'Keyboard', { exact: false })); await sleep(700); await shot(page, 'shortcuts') })
await step('about', async page => { await tab(page, 'Help'); await lbl(page, 'About', { exact: false }); await sleep(700); await shot(page, 'about') })
await step('refs', async page => { await tab(page, 'References'); await lbl(page, 'library', { exact: false }); await sleep(1000); await shot(page, 'references-manager') })
await step('refstyle', async page => { await tab(page, 'References'); await lbl(page, 'Style'); await shot(page, 'references-style', { x: 0, y: 0, width: 1000, height: 700 }) })
await step('code', async page => { await tab(page, 'View'); await lbl(page, 'Code'); await sleep(1500); await shot(page, 'view-code') })
await step('table-context', async page => {
  const q = await page.evaluate(() => { const c = [...document.querySelectorAll('.kt-flow td, .kt-flow th')][4]; if (!c) return null; c.scrollIntoView({ block: 'center' }); return true }); if (!q) throw new Error('no table'); await sleep(400)
  const pt = await page.evaluate(() => { const r = [...document.querySelectorAll('.kt-flow td, .kt-flow th')][4].getBoundingClientRect(); return [r.left + 10, r.top + r.height / 2] }); await page.mouse.click(pt[0], pt[1]); await sleep(700)
  await tab(page, 'Table Design'); await shot(page, 'table-context')
})
await step('equation-context', async page => {
  const ok = await page.evaluate(() => { const e = document.querySelector('.kt-flow .kt-math-block, .kt-flow [data-type=math_block], .kt-flow .math-block'); if (!e) return [...new Set([...document.querySelectorAll('.kt-flow *')].map(x => x.className).filter(c => /math/i.test(c)))].slice(0, 8); e.scrollIntoView({ block: 'center' }); return true })
  if (ok !== true) throw new Error('classes: ' + JSON.stringify(ok)); await sleep(400)
  const pt = await page.evaluate(() => { const r = document.querySelector('.kt-flow .kt-math-block, .kt-flow [data-type=math_block], .kt-flow .math-block').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] }); await page.mouse.click(pt[0], pt[1]); await sleep(700); await shot(page, 'equation-context')
})
await step('comment', async page => {
  await clickWord(page, 'Select a passage', 2); await page.keyboard.down('Shift'); for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight'); await page.keyboard.up('Shift')
  await tab(page, 'Review'); await lbl(page, 'comment', { exact: false }); await sleep(700); await page.keyboard.type('Check this wording with the co-author.', { delay: 10 }); await sleep(500); await shot(page, 'review-comment')
})
await step('equation-filled', async page => {
  await tab(page, 'Insert'); await lbl(page, 'Equation builder', { exact: false }); await sleep(1200)
  await page.keyboard.type('e^', { delay: 60 }); await page.keyboard.type('i\\pi ', { delay: 60 }); await page.keyboard.press('ArrowRight'); await page.keyboard.type('+1=0', { delay: 60 }); await sleep(900); await shot(page, 'equation-builder')
})
await step('draw', async page => {
  await tab(page, 'Draw'); await page.evaluate(() => document.querySelectorAll('.rb-pen')[1].click()); await sleep(300)
  const q = await textAt(page, 'always gives'); await sleep(300); const r = await page.evaluate(() => { const w = document.createTreeWalker(document.querySelector('.ProseMirror'), NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const i = n.data.indexOf('always gives'); if (i >= 0) { const g = document.createRange(); g.setStart(n, i + 7); g.setEnd(n, i + 12); const b = g.getBoundingClientRect(); return [b.left, b.top, b.width, b.height] } } })
  const [x, y, w, h] = r; const cx = x + w / 2, cy = y + h / 2
  await page.mouse.move(cx + w / 2 + 6, cy); await page.mouse.down(); for (let k = 1; k <= 40; k++) { const t = k / 40 * 2 * Math.PI + 0.1; await page.mouse.move(cx + (w / 2 + 6) * Math.cos(t), cy + (h / 2 + 4) * Math.sin(t)) } await page.mouse.up(); await sleep(300)
  await page.evaluate(() => document.querySelectorAll('.rb-pen')[2].click()); await sleep(200); await page.evaluate(() => document.querySelectorAll('.rb-pen')[2].click()).catch(() => {}); await sleep(200)
  await page.keyboard.press('Escape'); await tab(page, 'Draw'); await page.evaluate(() => document.querySelectorAll('.rb-pen')[2].click()); await sleep(200)
  const q2 = await page.evaluate(() => { const w = document.createTreeWalker(document.querySelector('.ProseMirror'), NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const i = n.data.indexOf('nothing you do here'); if (i >= 0) { const g = document.createRange(); g.setStart(n, i); g.setEnd(n, i + 19); const b = g.getBoundingClientRect(); return [b.left, b.top + b.height / 2, b.width] } } })
  await page.mouse.move(q2[0], q2[1]); await page.mouse.down(); for (let k = 1; k <= 20; k++) await page.mouse.move(q2[0] + q2[2] * k / 20, q2[1] + Math.sin(k) * 0.4); await page.mouse.up(); await sleep(300)
  await page.keyboard.press('Escape'); await sleep(300); await shot(page, 'draw', { x: 0, y: 0, width: W, height: 700 })
})

await step('flowchart', async page => { await tab(page, 'Insert'); await lbl(page, 'Flowchart builder', { exact: false }); await sleep(1800); await leaf(page, 'Decision', { exact: false, within: '.dlg' }).catch(() => {}); await sleep(600); await leaf(page, 'Process', { exact: false, within: '.dlg' }).catch(() => {}); await sleep(900); await shot(page, 'flowchart') })
await step('drawing', async page => { await tab(page, 'Insert'); await lbl(page, 'Drawing', { exact: true }); await sleep(1800); await shot(page, 'drawing') })
await step('chart', async page => { await tab(page, 'Insert'); await lbl(page, 'Chart', { exact: true }); await sleep(1800); await shot(page, 'chart') })
await step('smartart', async page => { await tab(page, 'Insert'); await lbl(page, 'SmartArt', { exact: true }); await sleep(1800); await shot(page, 'smartart') })
await step('preferences', async page => { await page.evaluate(() => { const b = [...document.querySelectorAll('.ribbon button, button')].find(x => /Preferences/.test(x.title || x.getAttribute('aria-label') || '')); b?.click() }); await sleep(1200); await shot(page, 'preferences') })
await step('chemistry', async page => { await tab(page, 'Insert'); await lbl(page, 'Chemical', { exact: false }); await sleep(1200); const ok = await page.evaluate(() => { const i = document.querySelector('.dlg textarea, .dlg input[type=text]'); if (!i) return false; i.focus(); return true }); if (ok) { await page.keyboard.type('2H2 + O2 -> 2H2O', { delay: 30 }) } await sleep(1500); await shot(page, 'chemistry') })
await browser.close()
