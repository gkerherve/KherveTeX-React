import { start, shot, tour, tab, sleep, clickText, hideNoise } from './lib.mjs'
const { browser, page } = await start()
await tour(page); await hideNoise(page)
await shot(page, 'window')
for (const t of ['Home','Insert','Draw','Design','Layout','View','References','Review','History','Compile','Examples','Help']) {
  await tab(page, t); await shot(page, 'tab-' + t.toLowerCase(), { x: 0, y: 0, width: 1440, height: 150 })
}
await browser.close()
