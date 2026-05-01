import { marked } from 'marked'
import { getComponents, getMeta, getStructures } from '../data/loader.js'
import { createVersionPicker } from '../components/version-picker.js'
import './structure.css'

marked.setOptions({ breaks: true })

const PALETTE = {
  user: {
    label: 'User Prompt',
    className: 'amber',
    ink: '#674407',
    topA: '#ffe6b5',
    topB: '#f6c776',
    frontA: '#f7d28f',
    frontB: '#efb84f',
    sideA: '#f0bf64',
    sideB: '#d49a34',
    stroke: '#c58d27',
  },
  system: {
    label: 'System Prompt',
    className: 'blue',
    ink: '#174d7d',
    topA: '#d9ecfb',
    topB: '#a7cce9',
    frontA: '#c6def2',
    frontB: '#8db9dc',
    sideA: '#9fc5e4',
    sideB: '#77a8cf',
    stroke: '#6d9bc2',
  },
  tools: {
    label: 'Tools',
    className: 'green',
    ink: '#205d37',
    topA: '#dff0da',
    topB: '#b7d9ad',
    frontA: '#cce5c5',
    frontB: '#9fc98f',
    sideA: '#afd5a4',
    sideB: '#89b97a',
    stroke: '#7faa70',
  },
}

function esc(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatNumber(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(value || 0))
}

function formatDate(value) {
  if (!value) return 'Unknown'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

function plural(count, one, many = `${one}s`) {
  return `${formatNumber(count)} ${count === 1 ? one : many}`
}

function truncate(value, max = 34) {
  const text = String(value || '')
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

function formatTitle(item) {
  if (item.title) return item.title
  if (item.kind === 'system_reminder') return `System reminder ${item.index + 1}`
  return item.key || 'User prompt'
}

function getSize(item) {
  return item.char_count ?? item.total_chars ?? item.prose_chars ?? 0
}

function buildGroups(structure) {
  return [
    {
      key: 'user',
      ...PALETTE.user,
      items: (structure.user_message || []).map(item => ({
        ...item,
        title: formatTitle(item),
        type: 'user',
        lookupKey: item.key,
        size: getSize(item),
      })),
    },
    {
      key: 'system',
      ...PALETTE.system,
      items: (structure.system_message || []).map(item => ({
        ...item,
        type: 'system',
        lookupKey: item.title,
        size: getSize(item),
      })),
    },
    {
      key: 'tools',
      ...PALETTE.tools,
      items: (structure.tools || []).map(item => ({
        ...item,
        type: 'tool',
        lookupKey: item.title,
        size: getSize(item),
      })),
    },
  ].filter(group => group.items.length)
}

function flattenGroups(groups) {
  return groups.flatMap(group => group.items)
}

function slab({ x, y, w, h, d, item, group, showTop = false, selected = false }) {
  const top = `${x + d},${y - d} ${x + w - d * 0.35},${y - d} ${x + w},${y} ${x},${y}`
  const front = `${x},${y} ${x + w},${y} ${x + w},${y + h} ${x},${y + h}`
  const side = `${x + w},${y} ${x + w - d * 0.35},${y - d} ${x + w - d * 0.35},${y + h - d} ${x + w},${y + h}`
  const icon = item.type === 'tool' ? `<text class="slab-icon" x="${x + 16}" y="${y + h / 2 + 3}" fill="${group.ink}">□</text>` : ''

  return `
    <g class="svg-slab ${group.className} ${selected ? 'selected' : ''}" data-component-id="${esc(item.id)}" tabindex="0" role="button" aria-label="${esc(group.label)}: ${esc(item.title)}">
      <title>${esc(group.label)}: ${esc(item.title)}, ${formatNumber(item.size)} characters</title>
      ${showTop ? `<polygon points="${side}" fill="url(#${group.key}-side)" stroke="${group.stroke}" stroke-width="0.6" opacity="0.52"/>` : ''}
      ${showTop ? `<polygon points="${top}" fill="url(#${group.key}-top)" stroke="${group.stroke}" stroke-width="0.8"/>` : ''}
      <polygon class="slab-front" points="${front}" fill="url(#${group.key}-front)" stroke="${group.stroke}" stroke-width="0.9"/>
      <path d="M${x + 6},${y + 2.5} H${x + w - 8}" stroke="rgba(255,255,255,0.48)" stroke-width="1.2"/>
      <path d="M${x + w - 5},${y + 2.5} V${y + h - 2}" stroke="rgba(35,45,55,0.12)" stroke-width="1"/>
      <path d="M${x + w - 2},${y + 3} V${y + h - 3}" stroke="rgba(255,255,255,0.24)" stroke-width="0.8"/>
      ${icon}
      <text class="slab-label" x="${x + (item.type === 'tool' ? 33 : 24)}" y="${y + h / 2 + 3}" fill="${group.ink}">${esc(truncate(item.title, item.type === 'tool' ? 32 : 38))}</text>
    </g>
  `
}

function groupCallout({ group, anchorX, anchorY, labelX }) {
  return `
    <g class="group-callout ${group.className}">
      <path d="M${labelX + 74},${anchorY} H${anchorX - 28}" stroke="${group.stroke}" stroke-width="1.4"/>
      <circle cx="${anchorX - 28}" cy="${anchorY}" r="3" fill="${group.stroke}"/>
      <text class="callout-title" x="${labelX}" y="${anchorY - 6}" fill="${group.ink}">${group.label}</text>
      <text class="callout-meta" x="${labelX}" y="${anchorY + 12}" fill="#5f5a51">${plural(group.items.length, group.key === 'tools' ? 'tool' : 'section')}</text>
      <text class="callout-meta" x="${labelX}" y="${anchorY + 29}" fill="#5f5a51">${formatNumber(group.total)} chars</text>
    </g>
  `
}

function renderSvgStack(groups, selectedId) {
  const x = 200
  const w = 320
  const h = 34
  const d = 8
  const gap = 1
  const dividerGap = 24
  let y = 32
  const parts = []
  const callouts = []

  groups.forEach((group, groupIndex) => {
    if (groupIndex > 0) {
      y += dividerGap
    }

    const firstY = y
    group.items.forEach((item, itemIndex) => {
      parts.push(slab({ x, y, w, h, d, item, group, showTop: itemIndex === 0, selected: item.id === selectedId }))
      y += h + gap
    })
    const anchorY = firstY + Math.min(34, (group.items.length * (h + gap)) / 2)
    callouts.push(groupCallout({ group, anchorX: x, anchorY, labelX: 30 }))
  })

  return `
    <svg class="structure-stack-svg" viewBox="0 0 660 950" role="list" aria-label="Prompt structure stack. Use arrow keys to move between layers, Enter to read details.">
      <defs>
        ${groups.map(group => `
          <linearGradient id="${group.key}-top" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stop-color="${group.topA}"/>
            <stop offset="1" stop-color="${group.topB}"/>
          </linearGradient>
          <linearGradient id="${group.key}-front" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stop-color="${group.frontA}"/>
            <stop offset="1" stop-color="${group.frontB}"/>
          </linearGradient>
          <linearGradient id="${group.key}-side" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stop-color="${group.sideA}"/>
            <stop offset="1" stop-color="${group.sideB}"/>
          </linearGradient>
        `).join('')}
        <filter id="stackShadow" x="-20%" y="-10%" width="140%" height="135%">
          <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#7a6c58" flood-opacity="0.08"/>
        </filter>
      </defs>
      ${callouts.join('')}
      <g filter="url(#stackShadow)">
        ${parts.join('')}
      </g>
    </svg>
  `
}

function getTextForItem(components, item) {
  if (!components) return ''
  if (item.type === 'tool') {
    const detail = components.tools?.[item.lookupKey]
    if (!detail) return ''
    return [detail.prose, detail.schema ? `\`\`\`json\n${detail.schema}\n\`\`\`` : ''].filter(Boolean).join('\n\n')
  }
  if (item.type === 'system') return components.system_message?.[item.lookupKey]?.text || ''
  return components.user_message?.[item.lookupKey]?.text || ''
}

function getMetadata(item) {
  const rows = [
    ['Size', `${formatNumber(item.size)} characters`],
    ['Type', item.type],
  ]
  if (item.type === 'tool') {
    rows.push(['Prose', `${formatNumber(item.prose_chars)} chars`])
    rows.push(['Schema', `${formatNumber(item.schema_chars)} chars`])
  }
  if (item.key) rows.push(['Path', item.key])
  rows.push(['ID', item.id])
  return rows
}

function renderPanel(item, components, activeTab = 'rendered') {
  const text = getTextForItem(components, item)
  const metadata = getMetadata(item)

  return `
    <div class="structure-panel-head">
      <div>
        <div class="structure-breadcrumb">${item.groupLabel} <span>›</span> ${esc(item.title)}</div>
      </div>
      <button class="panel-close" type="button" aria-label="Clear selection">×</button>
    </div>
    <div class="panel-tabs" role="tablist">
      ${['rendered', 'raw', 'metadata'].map(tab => `
        <button class="panel-tab ${activeTab === tab ? 'active' : ''}" type="button" data-panel-tab="${tab}">${tab[0].toUpperCase()}${tab.slice(1)}</button>
      `).join('')}
    </div>
    <div class="panel-body">
      <div class="panel-pane ${activeTab === 'rendered' ? '' : 'hidden'}" data-panel-pane="rendered">
        <h3>${esc(item.title)}</h3>
        <div class="rendered-md">${marked.parse(text ? esc(text) : '_No detail text available._')}</div>
      </div>
      <div class="panel-pane ${activeTab === 'raw' ? '' : 'hidden'}" data-panel-pane="raw">
        <pre>${esc(text || 'No detail text available.')}</pre>
      </div>
      <div class="panel-pane ${activeTab === 'metadata' ? '' : 'hidden'}" data-panel-pane="metadata">
        <dl class="metadata-list">
          ${metadata.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}
        </dl>
      </div>
    </div>
  `
}

function renderEmptyPanel() {
  return `
    <div class="structure-panel-empty">
      <h3>No layer selected</h3>
      <p>Select a slab in the stack to inspect rendered text, raw prompt content, and metadata.</p>
    </div>
  `
}

function renderError(message) {
  return `
    <div class="structure-error">
      <h2>Structure could not load</h2>
      <p>${esc(message)}</p>
      <button type="button" data-structure-retry>Retry</button>
    </div>
  `
}

function renderMetrics(structure, version, versionMeta) {
  const userTotal = (structure.user_message || []).reduce((sum, item) => sum + getSize(item), 0)
  const systemTotal = (structure.system_message || []).reduce((sum, item) => sum + getSize(item), 0)
  const toolTotal = (structure.tools || []).reduce((sum, item) => sum + getSize(item), 0)
  const systemSectionCount = (structure.system_message || []).length
  const total = userTotal + systemTotal + toolTotal

  return `
    <div class="structure-index">
      <div class="section-number">1</div>
      <div class="structure-index-titles">
        <h2>Structure</h2>
        <p>Claude Code ${esc(version)}</p>
      </div>
      <div class="structure-version-pick">
        <label>Version</label>
        <div data-version-picker></div>
      </div>
      <dl class="metric-list">
        <div><dt>Total size</dt><dd>${formatNumber(total)}<span>characters</span></dd></div>
        <div><dt>System sections</dt><dd>${formatNumber(systemSectionCount)}</dd></div>
        <div><dt>Tools</dt><dd>${formatNumber((structure.tools || []).length)}</dd></div>
        <div><dt>Last updated</dt><dd>${esc(formatDate(versionMeta?.release_date))}<span>local dataset</span></dd></div>
      </dl>
    </div>
  `
}

export async function renderStructure(container) {
  let meta
  let structures
  try {
    ;[meta, structures] = await Promise.all([getMeta(), getStructures()])
  } catch (error) {
    container.innerHTML = renderError(error?.message || 'The local prompt dataset is unavailable.')
    container.querySelector('[data-structure-retry]')?.addEventListener('click', () => renderStructure(container))
    return
  }

  const versionMetaList = Array.isArray(meta.versions) ? meta.versions : []
  const versions = versionMetaList.map(v => v.version)
  let currentVersion = versionMetaList.at(-1)?.version || versions.at(-1)
  let currentTab = 'rendered'
  let currentId
  let currentComponents = null
  let drawToken = 0
  let focusSelectedAfterDraw = false

  if (!versions.length) {
    container.innerHTML = renderError('No prompt versions are available in the local dataset.')
    return
  }

  async function draw() {
    const token = ++drawToken
    const structure = structures[currentVersion]
    if (!structure) {
      container.innerHTML = renderError(`Version ${currentVersion} is missing structure data.`)
      container.querySelector('[data-structure-retry]')?.addEventListener('click', () => draw())
      return
    }

    const versionMeta = versionMetaList.find(v => v.version === currentVersion)
    try {
      currentComponents = await getComponents(currentVersion)
    } catch (_error) {
      currentComponents = null
    }
    if (token !== drawToken) return

    const groups = buildGroups(structure).map(group => ({
      ...group,
      total: group.items.reduce((sum, item) => sum + item.size, 0),
      items: group.items.map((item, index) => ({
        ...item,
        id: `${group.key}:${item.lookupKey || item.title || index}`,
        groupKey: group.key,
        groupLabel: group.label,
      })),
    }))
    const allItems = flattenGroups(groups)
    const firstSystem = groups.find(group => group.key === 'system')?.items[0]
    const selectedItem = currentId === null
      ? null
      : allItems.find(item => item.id === currentId) || firstSystem || groups[0]?.items[0] || null
    currentId = selectedItem?.id ?? currentId ?? ''

    container.innerHTML = `
      <div class="structure-workbench">
        ${renderMetrics(structure, currentVersion, versionMeta)}
        <div class="structure-visual">
          ${renderSvgStack(groups, currentId)}
        </div>
        <aside class="structure-panel" aria-live="polite">
          ${selectedItem ? renderPanel(selectedItem, currentComponents, currentTab) : renderEmptyPanel()}
        </aside>
        <div class="structure-live" aria-live="polite">${selectedItem ? `${selectedItem.groupLabel}: ${selectedItem.title}, ${formatNumber(selectedItem.size)} characters` : 'No layer selected'}</div>
      </div>
    `

    const pickerHost = container.querySelector('[data-version-picker]')
    createVersionPicker(pickerHost, versions, currentVersion, version => {
      currentVersion = version
      currentId = undefined
      currentTab = 'rendered'
      draw()
    })

    container.querySelectorAll('[data-component-id]').forEach(node => {
      node.addEventListener('click', () => {
        currentId = node.dataset.componentId
        currentTab = 'rendered'
        draw()
      })
      node.addEventListener('keydown', event => {
        const activeIndex = allItems.findIndex(item => item.id === node.dataset.componentId)
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
          event.preventDefault()
          currentId = allItems[Math.min(activeIndex + 1, allItems.length - 1)]?.id || node.dataset.componentId
          focusSelectedAfterDraw = true
          draw()
          return
        }
        if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
          event.preventDefault()
          currentId = allItems[Math.max(activeIndex - 1, 0)]?.id || node.dataset.componentId
          focusSelectedAfterDraw = true
          draw()
          return
        }
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        currentId = node.dataset.componentId
        currentTab = 'rendered'
        draw()
      })
    })

    container.querySelectorAll('[data-panel-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        currentTab = tab.dataset.panelTab
        container.querySelectorAll('[data-panel-tab]').forEach(btn => btn.classList.toggle('active', btn === tab))
        container.querySelectorAll('[data-panel-pane]').forEach(pane => pane.classList.toggle('hidden', pane.dataset.panelPane !== currentTab))
      })
    })

    container.querySelector('.panel-close')?.addEventListener('click', () => {
      currentId = null
      draw()
    })

    if (focusSelectedAfterDraw) {
      focusSelectedAfterDraw = false
      requestAnimationFrame(() => {
        container.querySelector('.svg-slab.selected')?.focus()
      })
    }
  }

  await draw()
}
