import { getMeta } from './data/loader.js'
import { renderStructure } from './views/structure.js'
import { renderEvolution } from './views/evolution.js'

const app = document.getElementById('app')

function esc(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatCount(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(value || 0))
}

const SECTIONS = [
  {
    id: 'structure',
    label: 'Structure',
    kicker: 'Single version',
    title: 'Prompt architecture as a layered object',
    meta: 'One vertical stack: User Prompt, System Prompt, Tools',
    render: renderStructure,
  },
  {
    id: 'evolution',
    label: 'Evolution',
    kicker: 'Version range',
    title: 'Component size and state across releases',
    meta: 'User Prompt, System Prompt, and Tools over time',
    render: renderEvolution,
  },
]

async function main() {
  let meta
  try {
    meta = await getMeta()
  } catch (error) {
    app.innerHTML = `
      <main class="app-fatal" role="alert">
        <h1>Claude Code Prompt Observatory could not load</h1>
        <p>${esc(error?.message || 'Version metadata is unavailable. Check the local data export and dev server.')}</p>
        <button type="button" data-app-retry>Retry</button>
      </main>
    `
    app.querySelector('[data-app-retry]')?.addEventListener('click', main)
    return
  }

  const latest = meta.versions?.at(-1)

  app.innerHTML = `
    <header class="top-rail">
      <a class="rail-brand" href="#structure" aria-label="Claude Code Prompt Observatory home">
        <span class="brand-mark" aria-hidden="true"></span>
        <span>Claude Code Prompt Observatory</span>
      </a>
      <nav class="rail-nav" aria-label="Page sections">
        ${SECTIONS.map(section =>
          `<a class="rail-link" href="#${section.id}" data-section-link="${section.id}">${section.label}</a>`
        ).join('')}
      </nav>
      <div class="rail-meta">
        <span>${formatCount(meta.versions?.length ?? 0)} versions</span>
        <span>${esc(latest?.version ?? 'latest unavailable')}</span>
        <span class="rail-divider" aria-hidden="true">·</span>
        <a class="rail-credit" href="https://cchistory.mariozechner.at/" target="_blank" rel="noopener noreferrer">data: cchistory.mariozechner.at</a>
      </div>
    </header>
    <main class="scroll-page">
      ${SECTIONS.map(section => `
        <section class="work-section work-section-${section.id}" id="${section.id}" data-section="${section.id}" aria-labelledby="${section.id}-title">
          <div class="section-chrome">
            <div>
              <div class="section-kicker">${esc(section.kicker)}</div>
              <h1 id="${section.id}-title">${esc(section.title)}</h1>
            </div>
            <div class="section-meta">${esc(section.meta)}</div>
          </div>
          <div class="section-surface" id="${section.id}-surface"></div>
        </section>
      `).join('')}
    </main>
  `

  async function mount(section, surface) {
    try {
      await section.render(surface)
    } catch (err) {
      console.error(`Failed to render section "${section.id}"`, err)
      surface.innerHTML = `
        <div class="section-error" role="alert">
          <h2>${esc(section.label)} could not render</h2>
          <p>${esc(err?.message || 'The section failed while reading local prompt data.')}</p>
          <button type="button" data-section-retry="${esc(section.id)}">Retry</button>
        </div>
      `
      surface.querySelector('[data-section-retry]')?.addEventListener('click', async () => {
        surface.innerHTML = '<p class="loading">Loading section…</p>'
        try {
          await section.render(surface)
        } catch (retryErr) {
          surface.innerHTML = `
            <div class="section-error" role="alert">
              <h2>${esc(section.label)} could not render</h2>
              <p>${esc(retryErr?.message || 'The retry failed while reading local prompt data.')}</p>
            </div>
          `
        }
      })
    }
  }

  // Structure renders immediately (it owns the first viewport). Evolution
  // defers until its surface is within ~one screen of the viewport, so the
  // 800 KB structures.json fetch + parse stays off the critical path.
  const structureSection = SECTIONS.find(s => s.id === 'structure')
  const structureSurface = document.getElementById('structure-surface')
  const structurePromise = mount(structureSection, structureSurface)

  const evolutionSection = SECTIONS.find(s => s.id === 'evolution')
  const evolutionSurface = document.getElementById('evolution-surface')
  let evolutionStarted = false
  const startEvolution = () => {
    if (evolutionStarted) return
    evolutionStarted = true
    mount(evolutionSection, evolutionSurface)
  }
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) {
        observer.disconnect()
        startEvolution()
      }
    }, { rootMargin: '600px 0px' })
    observer.observe(evolutionSurface)
    // Clicking the rail nav for Evolution scrolls into view, which trips the
    // observer; explicit handler isn't needed.
  } else {
    startEvolution()
  }

  await structurePromise
  wireSectionNav()
}

function wireSectionNav() {
  const links = [...document.querySelectorAll('[data-section-link]')]
  const sections = [...document.querySelectorAll('[data-section]')]

  const setActive = (id) => {
    links.forEach(link => {
      const active = link.dataset.sectionLink === id
      link.classList.toggle('active', active)
      if (active) link.setAttribute('aria-current', 'true')
      else link.removeAttribute('aria-current')
    })
  }

  links.forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault()
      const target = document.getElementById(link.dataset.sectionLink)
      target?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      })
      history.replaceState(null, '', `#${link.dataset.sectionLink}`)
      setActive(link.dataset.sectionLink)
    })
  })

  const observer = new IntersectionObserver(entries => {
    const visible = entries
      .filter(entry => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
    if (visible) setActive(visible.target.dataset.section)
  }, { rootMargin: '-20% 0px -55% 0px', threshold: [0.12, 0.35, 0.6] })

  sections.forEach(section => observer.observe(section))

  const requested = location.hash?.replace('#', '') || 'structure'
  const initial = sections.some(section => section.id === requested) ? requested : 'structure'
  if (requested !== initial) history.replaceState(null, '', `#${initial}`)
  setActive(initial)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.getElementById(initial)?.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      })
    })
  })
}

main()
