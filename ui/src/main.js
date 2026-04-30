import { registerRoute, initRouter } from './router.js'
import { renderNav } from './components/nav.js'
import { getMeta } from './data/loader.js'
import { renderStructure } from './views/structure.js'
import { renderDiff } from './views/diff.js'
import { renderEvolution } from './views/evolution.js'

const app = document.getElementById('app')

async function main() {
  await getMeta() // preload

  const navEl = document.createElement('nav')
  app.appendChild(navEl)
  renderNav(navEl)

  const viewEl = document.createElement('main')
  app.appendChild(viewEl)

  registerRoute('#/', () => { viewEl.innerHTML = ''; renderStructure(viewEl) })
  registerRoute('#/diff', () => { viewEl.innerHTML = ''; renderDiff(viewEl) })
  registerRoute('#/evolution', () => { viewEl.innerHTML = ''; renderEvolution(viewEl) })

  initRouter()
}

main()
