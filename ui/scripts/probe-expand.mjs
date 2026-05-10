// Verify the inline expand panel stays within the focal viewport.
import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.click('a[href="#/evolution"], button:has-text("Evolution")').catch(() => {})
await page.waitForSelector('.evo-table', { timeout: 5000 })
await page.evaluate(() => document.querySelector('.work-section-evolution')?.scrollIntoView({ block: 'start' }))
await page.waitForTimeout(400)

// Click an h1-row to open its detail panel. Pick something stable.
await page.click('tr.evo-row[data-key^="h1:"]', { force: true })
await page.waitForSelector('.evo-expand-row', { timeout: 3000 })
await page.waitForTimeout(300)

const before = await page.evaluate(() => {
  const wrap = document.querySelector('.evo-table-wrap')
  const inner = document.querySelector('.evo-expand-inner')
  const td = document.querySelector('.evo-expand-td')
  const expandRow = document.querySelector('.evo-expand-row')
  const tdR = td?.getBoundingClientRect()
  const innerR = inner?.getBoundingClientRect()
  const wrapR = wrap?.getBoundingClientRect()
  const tdStyle = getComputedStyle(td)
  const expandStyle = getComputedStyle(expandRow)
  return {
    wrapClientWidth: wrap.clientWidth,
    wrapScrollWidth: wrap.scrollWidth,
    wrapScrollLeft: wrap.scrollLeft,
    innerWidthPx: inner.style.width,
    innerLeft: innerR.left,
    wrapLeft: wrapR.left,
    tdLeft: tdR.left,
    tdComputedPosition: tdStyle.position,
    tdComputedLeft: tdStyle.left,
    tdDisplay: tdStyle.display,
    expandRowDisplay: expandStyle.display,
    contentOverflowsViewport: innerR.right > wrapR.right,
  }
})
console.log('--- INITIAL (panel opened, scrollLeft=0 from end) ---')
console.log(JSON.stringify(before, null, 2))

// Scroll the wrap to the middle and check the panel inner stays put.
await page.evaluate(() => {
  const wrap = document.querySelector('.evo-table-wrap')
  wrap.scrollLeft = Math.floor((wrap.scrollWidth - wrap.clientWidth) / 2)
})
await page.waitForTimeout(200)

const mid = await page.evaluate(() => {
  const wrap = document.querySelector('.evo-table-wrap')
  const inner = document.querySelector('.evo-expand-inner')
  const innerR = inner.getBoundingClientRect()
  const wrapR = wrap.getBoundingClientRect()
  return {
    scrollLeft: wrap.scrollLeft,
    innerLeftRelToWrap: innerR.left - wrapR.left,
    innerWidth: innerR.width,
    contentOverflowsViewport: innerR.right > wrapR.right + 1,
  }
})
console.log('--- AFTER SCROLL TO MIDDLE ---')
console.log(JSON.stringify(mid, null, 2))

await page.screenshot({ path: '/tmp/evo-expand.png', fullPage: false })
await browser.close()
