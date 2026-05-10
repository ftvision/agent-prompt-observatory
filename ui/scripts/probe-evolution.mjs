#!/usr/bin/env node
// Probe the Evolution view in a real browser. Diagnoses layout, scroll, and
// freeze-pane behavior so we don't have to guess from CSS alone.
//
// Run: `node scripts/probe-evolution.mjs` (dev server on :5173 must be up).

import { chromium } from 'playwright'

const URL = process.env.URL || 'http://localhost:5173/'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })

await page.goto(URL, { waitUntil: 'networkidle' })

// Navigate to Evolution view via the nav.
await page.click('a[href="#/evolution"], button:has-text("Evolution")').catch(() => {})
await page.waitForSelector('.evo-table', { timeout: 5000 })
await page.waitForTimeout(400)

const snapshot = await page.evaluate(() => {
  const wrap = document.querySelector('.evo-table-wrap')
  const table = document.querySelector('.evo-table')
  const tbody = document.querySelector('.evo-table tbody')
  const firstBodyRow = tbody?.children[0]
  const firstBodyRowCellCount = firstBodyRow?.children.length || 0
  const colgroup = document.querySelector('.evo-table colgroup')
  const colCount = colgroup?.childElementCount || 0
  const colWidths = Array.from(colgroup?.children || []).slice(0, 5).map(c => c.style.width || getComputedStyle(c).width)

  // Sticky cell positions under heavy scroll
  const tdCat = document.querySelector('.evo-td-cat')
  const tdSec = document.querySelector('.evo-td-sec')

  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    wrap: {
      clientWidth: wrap?.clientWidth,
      scrollWidth: wrap?.scrollWidth,
      scrollLeft: wrap?.scrollLeft,
      clientHeight: wrap?.clientHeight,
      scrollHeight: wrap?.scrollHeight,
      overflowX: wrap ? getComputedStyle(wrap).overflowX : null,
      overflowY: wrap ? getComputedStyle(wrap).overflowY : null,
    },
    table: {
      offsetWidth: table?.offsetWidth,
      tableLayout: table ? getComputedStyle(table).tableLayout : null,
      width: table ? getComputedStyle(table).width : null,
      hasModelsClass: table?.classList.contains('has-models'),
    },
    body: {
      rowCount: tbody?.children.length,
      firstRowCellCount: firstBodyRowCellCount,
    },
    colgroup: { colCount, firstFiveColWidths: colWidths },
    stickyLabels: {
      tdCatLeft: tdCat ? getComputedStyle(tdCat).left : null,
      tdCatPosition: tdCat ? getComputedStyle(tdCat).position : null,
      tdSecLeft: tdSec ? getComputedStyle(tdSec).left : null,
      tdSecPosition: tdSec ? getComputedStyle(tdSec).position : null,
    },
  }
})

console.log('--- BEFORE SCROLL ---')
console.log(JSON.stringify(snapshot, null, 2))

// Scroll the wrap to the middle and re-snapshot to see if sticky labels stay put.
const midScroll = Math.floor((snapshot.wrap.scrollWidth - snapshot.wrap.clientWidth) / 2)
await page.evaluate(x => { document.querySelector('.evo-table-wrap').scrollLeft = x }, midScroll)
await page.waitForTimeout(300)

const afterScroll = await page.evaluate(() => {
  const wrap = document.querySelector('.evo-table-wrap')
  const tdCat = document.querySelector('.evo-td-cat')
  const tdCatRect = tdCat?.getBoundingClientRect()
  const wrapRect = wrap?.getBoundingClientRect()
  const tbody = document.querySelector('.evo-table tbody')
  return {
    scrollLeft: wrap?.scrollLeft,
    tdCatLeftPx: tdCatRect?.left,
    wrapLeftPx: wrapRect?.left,
    tdCatStuckOnLeft: tdCatRect && wrapRect ? Math.abs(tdCatRect.left - wrapRect.left) < 2 : null,
    firstRowCellCount: tbody?.children[0]?.children.length || 0,
  }
})

console.log('--- AFTER SCROLL TO MIDDLE ---')
console.log(JSON.stringify(afterScroll, null, 2))

// Scroll the page so the Evolution section is in view, then screenshot.
await page.evaluate(() => {
  document.querySelector('.work-section-evolution')?.scrollIntoView({ block: 'start' })
})
await page.waitForTimeout(300)
await page.screenshot({ path: '/tmp/evo-default.png', fullPage: false })
await page.evaluate(() => { document.querySelector('.evo-table-wrap').scrollLeft = 0 })
await page.waitForTimeout(200)
await page.screenshot({ path: '/tmp/evo-scrolled-left.png', fullPage: false })

if (errors.length) {
  console.log('--- PAGE ERRORS ---')
  errors.forEach(e => console.log(e))
}

await browser.close()
