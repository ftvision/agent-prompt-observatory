// Diagnose the version-axis and model-axis label truncation.
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
await page.waitForTimeout(300)

const r = await page.evaluate(() => {
  const versionLabels = Array.from(document.querySelectorAll('.evo-th-v-label')).slice(0, 6).map(el => {
    const r = el.getBoundingClientRect()
    return {
      text: el.textContent,
      width: r.width,
      scrollWidth: el.scrollWidth,
      offsetWidth: el.offsetWidth,
      cssWhiteSpace: getComputedStyle(el).whiteSpace,
      cssOverflow: getComputedStyle(el).overflow,
      parentTag: el.parentElement.tagName,
      parentCssOverflow: getComputedStyle(el.parentElement).overflow,
      parentCssPosition: getComputedStyle(el.parentElement).position,
      parentRectWidth: el.parentElement.getBoundingClientRect().width,
    }
  })
  const modelMarkers = Array.from(document.querySelectorAll('.evo-model-marker')).slice(0, 6).map(el => {
    const r = el.getBoundingClientRect()
    return {
      text: el.textContent,
      width: r.width,
      scrollWidth: el.scrollWidth,
      offsetWidth: el.offsetWidth,
      cssWhiteSpace: getComputedStyle(el).whiteSpace,
      parentCssOverflow: getComputedStyle(el.parentElement).overflow,
      parentRectWidth: el.parentElement.getBoundingClientRect().width,
    }
  })
  return { versionLabels, modelMarkers }
})
console.log(JSON.stringify(r, null, 2))
await page.screenshot({ path: '/tmp/evo-labels.png', fullPage: false, clip: { x: 0, y: 220, width: 1400, height: 200 } })
await browser.close()
