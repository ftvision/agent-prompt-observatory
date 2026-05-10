import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForSelector('.svg-slab', { timeout: 5000 })
await page.click('.svg-slab[data-component-id="tools:Read"]', { force: true })
await page.waitForTimeout(500)

const r = await page.evaluate(() => {
  const pre = document.querySelector('.panel-pane[data-panel-pane="rendered"] pre')
  const code = pre?.querySelector('code')
  const tokKey = pre?.querySelector('.tok-key')
  const tokString = pre?.querySelector('.tok-string')
  const get = el => {
    if (!el) return null
    const s = getComputedStyle(el)
    return {
      textDecoration: s.textDecoration,
      textDecorationLine: s.textDecorationLine,
      textDecorationColor: s.textDecorationColor,
      borderBottom: s.borderBottom,
      borderTop: s.borderTop,
      backgroundImage: s.backgroundImage,
      whiteSpace: s.whiteSpace,
      lineHeight: s.lineHeight,
    }
  }
  return {
    pre: get(pre),
    code: get(code),
    tokKey: get(tokKey),
    tokString: get(tokString),
  }
})
console.log(JSON.stringify(r, null, 2))
await browser.close()
