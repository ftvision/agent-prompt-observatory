import { navigate } from '../router.js'

const NAV_LINKS = [
  { hash: '#/', label: 'Structure' },
  { hash: '#/diff', label: 'Diff' },
  { hash: '#/evolution', label: 'Evolution' },
]

export function renderNav(container) {
  container.innerHTML = `
    <span class="nav-brand">Claude Code Evolution</span>
    ${NAV_LINKS.map(link =>
      `<a class="nav-link" data-hash="${link.hash}" href="${link.hash}">${link.label}</a>`
    ).join('')}
  `

  function updateActive() {
    const current = window.location.hash || '#/'
    container.querySelectorAll('.nav-link').forEach(a => {
      a.classList.toggle('active', a.dataset.hash === current)
    })
  }

  container.querySelectorAll('.nav-link').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault()
      navigate(a.dataset.hash)
    })
  })

  window.addEventListener('hashchange', updateActive)
  updateActive()
}
