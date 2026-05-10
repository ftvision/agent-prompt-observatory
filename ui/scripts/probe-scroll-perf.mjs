// Measure how long fillAllRows takes per scroll event and whether blanks
// persist after scrolling stops.
import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.click('a[href="#/evolution"], button:has-text("Evolution")').catch(() => {})
await page.waitForSelector('.evo-table', { timeout: 5000 })
await page.waitForTimeout(400)
await page.evaluate(() => {
  document.querySelector('.work-section-evolution')?.scrollIntoView({ block: 'start' })
})
await page.waitForTimeout(400)

// Instrument fillAllRows-equivalent behavior by counting cells and timing
// scroll-driven re-renders.
const result = await page.evaluate(async () => {
  const wrap = document.querySelector('.evo-table-wrap')
  const tbody = document.querySelector('.evo-table tbody')
  const rowCount = tbody?.children.length || 0

  // Count non-spacer .evo-cell elements before scrolling.
  const beforeCells = document.querySelectorAll('.evo-cell:not(.evo-spacer)').length
  const beforeBars = document.querySelectorAll('.evo-bar').length

  // Walk through 5 scroll positions, sleeping a frame between each, and
  // capture cell counts + frame timing.
  const samples = []
  const positions = [0, 1500, 3000, 4500, wrap.scrollWidth - wrap.clientWidth]
  for (const pos of positions) {
    const t0 = performance.now()
    wrap.scrollLeft = pos
    // wait one rAF to let the virtualizer's onChange fire and re-render
    await new Promise(r => requestAnimationFrame(() => r()))
    await new Promise(r => requestAnimationFrame(() => r()))
    const t1 = performance.now()
    const cells = document.querySelectorAll('.evo-cell:not(.evo-spacer)').length
    const bars = document.querySelectorAll('.evo-bar').length
    samples.push({ scrollLeft: pos, settleMs: +(t1 - t0).toFixed(2), cells, bars })
  }

  return { rowCount, beforeCells, beforeBars, samples }
})
console.log(JSON.stringify(result, null, 2))
await browser.close()
