// Verify markdown rendering in the Structure view's tool detail panel
// doesn't double-escape entities.
import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForSelector('.svg-slab', { timeout: 5000 })

// Click the Read tool slab (any tool will do — Read has a JSON schema with quotes).
await page.click('.svg-slab[data-component-id="tools:Read"]', { force: true })
await page.waitForTimeout(500)

const r = await page.evaluate(() => {
  const rendered = document.querySelector('[data-rendered-md]')
  const raw = document.querySelector('[data-raw-text]')?.textContent || ''
  const html = rendered?.innerHTML || ''
  return {
    htmlSnippet: html.slice(0, 2000),
    hasQuotEntity: html.includes('&amp;quot;'),
    hasLtEntity: html.includes('&amp;lt;'),
    hasGtEntity: html.includes('&amp;gt;'),
    rawSnippet: raw.slice(0, 200),
  }
})
console.log(JSON.stringify(r, null, 2))
await page.screenshot({ path: '/tmp/structure-md.png', fullPage: false })
await browser.close()
