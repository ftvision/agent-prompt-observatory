import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.click('a[href="#/evolution"], button:has-text("Evolution")').catch(() => {})
await page.waitForSelector('.evo-table', { timeout: 5000 })
await page.waitForTimeout(400)
const r = await page.evaluate(() => {
  const out = []
  let el = document.querySelector('.evo-table-wrap')
  while (el && el !== document.body) {
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: el.className.split(' ').slice(0, 3).join('.'),
      offsetW: el.offsetWidth,
      clientW: el.clientWidth,
      scrollW: el.scrollWidth,
      cssWidth: getComputedStyle(el).width,
      maxWidth: getComputedStyle(el).maxWidth,
      display: getComputedStyle(el).display,
      overflowX: getComputedStyle(el).overflowX,
      minWidth: getComputedStyle(el).minWidth,
    })
    el = el.parentElement
  }
  return { docScrollW: document.documentElement.scrollWidth, viewportW: window.innerWidth, chain: out }
})
console.log(JSON.stringify(r, null, 2))
await browser.close()
