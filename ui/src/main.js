import { getMeta } from './data/loader.js'
import { renderStructure } from './views/structure.js'
import { renderDiff } from './views/diff.js'
import { renderEvolution } from './views/evolution.js'

const app = document.getElementById('app')

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
    id: 'diff',
    label: 'Diff',
    kicker: 'Two versions',
    title: 'Structural change before text evidence',
    meta: 'Compare persistence, additions, removals, and edits',
    render: renderDiff,
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
  const meta = await getMeta()
  const latest = meta.versions?.at(-1)

  app.innerHTML = `
    <header class="top-rail">
      <a class="rail-brand" href="#structure" aria-label="Prompt Drift Observatory home">
        <span class="brand-mark" aria-hidden="true"></span>
        <span>Prompt Drift Observatory</span>
      </a>
      <nav class="rail-nav" aria-label="Page sections">
        ${SECTIONS.map(section =>
          `<a class="rail-link" href="#${section.id}" data-section-link="${section.id}">${section.label}</a>`
        ).join('')}
      </nav>
      <div class="rail-meta">
        <span>${meta.versions?.length ?? 0} versions</span>
        <span>${latest?.version ?? 'latest unavailable'}</span>
      </div>
    </header>
    <main class="scroll-page">
      ${SECTIONS.map(section => `
        <section class="work-section work-section-${section.id}" id="${section.id}" data-section="${section.id}" aria-labelledby="${section.id}-title">
          <div class="section-chrome">
            <div>
              <div class="section-kicker">${section.kicker}</div>
              <h1 id="${section.id}-title">${section.title}</h1>
            </div>
            <div class="section-meta">${section.meta}</div>
          </div>
          <div class="section-surface" id="${section.id}-surface"></div>
        </section>
      `).join('')}
    </main>
  `

  for (const section of SECTIONS) {
    const surface = document.getElementById(`${section.id}-surface`)
    try {
      await section.render(surface)
    } catch (err) {
      console.error(`Failed to render section "${section.id}"`, err)
    }
  }

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
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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

  const initial = location.hash?.replace('#', '') || 'structure'
  setActive(initial)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.getElementById(initial)?.scrollIntoView({ block: 'start' })
    })
  })
}

main()
