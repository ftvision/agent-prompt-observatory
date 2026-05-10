import { getComponents, getLatestStructure, getMeta, getStructures } from '../data/loader.js'
import { createVersionPicker } from '../components/version-picker.js'
import './structure.css'

// Lazy-load marked: it's ~10 KB gzipped and only renders panel prose, which
// the user has to click into. Keeping it out of the initial bundle cuts
// first-paint JS by ~40%.
let markedPromise = null
function loadMarked() {
  if (!markedPromise) {
    markedPromise = import('marked').then(({ marked }) => {
      marked.setOptions({ breaks: true })
      // Override the code renderer for ```json fences so tool schemas get
      // syntax-highlighted instead of one wall of monospace text. Other
      // languages fall through to marked's default code renderer.
      // Marked v12 hands the renderer positional args (code, infostring,
      // escaped), not a token object — easy thing to get wrong.
      marked.use({
        renderer: {
          code(code, infostring) {
            if (infostring === 'json') {
              return `<pre><code class="language-json">${highlightJson(code)}</code></pre>\n`
            }
            return false
          },
        },
      })
      return marked
    })
  }
  return markedPromise
}

// Tiny JSON syntax highlighter. Tokenizes the raw JSON source character by
// character and emits HTML with semantic classes that structure.css styles.
// Non-token characters (whitespace, punctuation) and string contents are
// HTML-escaped individually so any literal &, <, > inside JSON values can't
// escape into markup — output is safe to drop into innerHTML.
function highlightJson(raw) {
  let out = ''
  let i = 0
  const n = raw.length
  while (i < n) {
    const c = raw[i]
    // String — possibly a key if the next non-whitespace char is ':'
    if (c === '"') {
      let j = i + 1
      while (j < n) {
        if (raw[j] === '\\' && j + 1 < n) { j += 2; continue }
        if (raw[j] === '"') { j++; break }
        j++
      }
      const lit = raw.slice(i, j)
      let k = j
      while (k < n && /\s/.test(raw[k])) k++
      const isKey = raw[k] === ':'
      out += `<span class="tok-${isKey ? 'key' : 'string'}">${escHtml(lit)}</span>`
      i = j
      continue
    }
    // Number
    if (c === '-' || (c >= '0' && c <= '9')) {
      let j = i
      if (raw[j] === '-') j++
      while (j < n && raw[j] >= '0' && raw[j] <= '9') j++
      if (raw[j] === '.') { j++; while (j < n && raw[j] >= '0' && raw[j] <= '9') j++ }
      if (raw[j] === 'e' || raw[j] === 'E') {
        j++
        if (raw[j] === '+' || raw[j] === '-') j++
        while (j < n && raw[j] >= '0' && raw[j] <= '9') j++
      }
      out += `<span class="tok-number">${raw.slice(i, j)}</span>`
      i = j
      continue
    }
    // Keywords
    if (raw.startsWith('true', i))  { out += '<span class="tok-bool">true</span>';  i += 4; continue }
    if (raw.startsWith('false', i)) { out += '<span class="tok-bool">false</span>'; i += 5; continue }
    if (raw.startsWith('null', i))  { out += '<span class="tok-null">null</span>';  i += 4; continue }
    // Punctuation, whitespace, anything else
    out += escHtml(c)
    i++
  }
  return out
}

function escHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Reserved top-level slugs for which the structure shape isn't a flat list of
// {title, char_count} subsections. user_message holds xml_tag entries; tools
// holds tool entries (with prose/schema breakdown).
const USER_SLUG = 'user_message'
const TOOLS_SLUG = 'tools'

// Per-slug palettes for the 3D slabs. Known H1s get hand-tuned hues; any H1
// the corpus introduces later falls through to DEFAULT_H1_PALETTE.
const PALETTES = {
  user_message: {
    fallbackLabel: 'User Prompt',
    className: 'amber',
    ink: '#674407',
    topA: '#ffe6b5', topB: '#f6c776',
    frontA: '#f7d28f', frontB: '#efb84f',
    sideA: '#f0bf64', sideB: '#d49a34',
    stroke: '#c58d27',
  },
  system_prompt: {
    fallbackLabel: 'System Prompt',
    className: 'blue',
    ink: '#174d7d',
    topA: '#d9ecfb', topB: '#a7cce9',
    frontA: '#c6def2', frontB: '#8db9dc',
    sideA: '#9fc5e4', sideB: '#77a8cf',
    stroke: '#6d9bc2',
  },
  executing_actions_with_care: {
    fallbackLabel: 'Executing actions with care',
    className: 'teal',
    ink: '#11534f',
    topA: '#cdeeea', topB: '#8fcfc6',
    frontA: '#b6e3dd', frontB: '#74bdb2',
    sideA: '#90ccc4', sideB: '#5da89e',
    stroke: '#5fa39a',
  },
  text_output_does_not_apply_to_tool_calls: {
    fallbackLabel: 'Text output',
    className: 'violet',
    ink: '#3d2563',
    topA: '#e3d6f3', topB: '#bda1dd',
    frontA: '#cfb9e6', frontB: '#a585cf',
    sideA: '#b094d6', sideB: '#8a6abc',
    stroke: '#7e5ab1',
  },
  tools: {
    fallbackLabel: 'Tools',
    className: 'green',
    ink: '#205d37',
    topA: '#dff0da', topB: '#b7d9ad',
    frontA: '#cce5c5', frontB: '#9fc98f',
    sideA: '#afd5a4', sideB: '#89b97a',
    stroke: '#7faa70',
  },
}

const DEFAULT_H1_PALETTE = {
  fallbackLabel: 'Section',
  className: 'slate',
  ink: '#3a4655',
  topA: '#dde4ec', topB: '#b1bdcc',
  frontA: '#cad3de', frontB: '#9ba9bb',
  sideA: '#aeb9c8', sideB: '#8290a3',
  stroke: '#7a8798',
}

function getPalette(slug) {
  return PALETTES[slug] || DEFAULT_H1_PALETTE
}

function classifyKind(slug) {
  if (slug === USER_SLUG) return 'user'
  if (slug === TOOLS_SLUG) return 'tool'
  return 'h1'
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

function buildGroups(structure, topLevelTitles) {
  const groups = []
  for (const [slug, rawItems] of Object.entries(structure)) {
    const items = Array.isArray(rawItems) ? rawItems : []
    if (!items.length) continue

    const kind = classifyKind(slug)
    const palette = getPalette(slug)
    const label = topLevelTitles?.[slug] || palette.fallbackLabel

    if (kind === 'user') {
      groups.push({
        slug, kind, label, key: slug,
        ...palette,
        items: items.map(item => ({
          ...item,
          title: formatTitle(item),
          type: 'user',
          slug,
          lookupKey: item.key,
          size: getSize(item),
        })),
      })
      continue
    }

    if (kind === 'tool') {
      groups.push({
        slug, kind, label, key: slug,
        ...palette,
        items: items.map(item => ({
          ...item,
          type: 'tool',
          slug,
          lookupKey: item.title,
          size: getSize(item),
        })),
      })
      continue
    }

    // Generic H1 section
    groups.push({
      slug, kind, label, key: slug,
      ...palette,
      items: items.map(item => ({
        ...item,
        type: 'h1',
        slug,
        lookupKey: item.title,
        size: getSize(item),
      })),
    })
  }

  // Stack order mirrors Anthropic's prompt-cache layout:
  // tools (top) → system (middle) → messages (bottom). Stable within each
  // band so H1 subsections keep their declared order in the source structure.
  const rank = g => g.slug === TOOLS_SLUG ? 0 : g.slug === USER_SLUG ? 2 : 1
  return groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i)
    .map(({ g }) => g)
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

// Greedy word-wrap so SVG callout titles don't get clipped by the narrow
// rail column. SVG <text> doesn't wrap; we emit one <tspan> per line.
function wrapTitle(text, maxChars = 17) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const lines = []
  let cur = ''
  for (const word of words) {
    if (!cur) { cur = word; continue }
    if ((cur.length + 1 + word.length) <= maxChars) cur += ' ' + word
    else { lines.push(cur); cur = word }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : [text]
}

function groupCallout({ group, anchorX, anchorY, labelX }) {
  const subLabel = group.kind === 'tool' ? 'tool' : 'section'
  const lines = wrapTitle(group.label, 17)
  const lineHeight = 18  // ~ matches the 19px font-size of .callout-title
  // Center the multi-line block vertically around (anchorY - 6) so single-line
  // titles render at the original position and longer titles stay balanced.
  const titleTop = anchorY - 6 - (lines.length - 1) * lineHeight / 2
  const tspans = lines.map((line, i) =>
    `<tspan x="${labelX}" ${i === 0 ? `y="${titleTop}"` : `dy="${lineHeight}"`}>${esc(line)}</tspan>`
  ).join('')
  const metaY1 = titleTop + (lines.length - 1) * lineHeight + 18
  const metaY2 = metaY1 + 17
  return `
    <g class="group-callout ${group.className}">
      <path d="M${labelX + 74},${anchorY} H${anchorX - 28}" stroke="${group.stroke}" stroke-width="1.4"/>
      <circle cx="${anchorX - 28}" cy="${anchorY}" r="3" fill="${group.stroke}"/>
      <text class="callout-title" fill="${group.ink}">${tspans}</text>
      <text class="callout-meta" x="${labelX}" y="${metaY1}" fill="#5f5a51">${plural(group.items.length, subLabel)}</text>
      <text class="callout-meta" x="${labelX}" y="${metaY2}" fill="#5f5a51">${formatNumber(group.total)} chars</text>
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

  // Compute the total height we need so the SVG can grow with more H1s.
  let predictedHeight = y
  groups.forEach((group, i) => {
    if (i > 0) predictedHeight += dividerGap
    predictedHeight += group.items.length * (h + gap)
  })
  predictedHeight += 32

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
    <svg class="structure-stack-svg" viewBox="0 0 660 ${Math.max(950, predictedHeight)}" role="list" aria-label="Prompt structure stack. Use arrow keys to move between layers, Enter to read details.">
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
    const detail = components[item.slug]?.[item.lookupKey]
    if (!detail) return ''
    return [detail.prose, detail.schema ? `\`\`\`json\n${detail.schema}\n\`\`\`` : ''].filter(Boolean).join('\n\n')
  }
  if (item.type === 'user') return components[item.slug]?.[item.lookupKey]?.text || ''
  // h1 subsection
  return components[item.slug]?.[item.lookupKey]?.text || ''
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
  const text = components ? getTextForItem(components, item) : null
  const initialBody = components == null
    ? 'Loading panel content…'
    : text || 'No detail text available.'
  const metadata = getMetadata(item)

  return `
    <div class="structure-panel-head">
      <div>
        <div class="structure-breadcrumb">${esc(item.groupLabel)} <span>›</span> ${esc(item.title)}</div>
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
        <div class="rendered-md" data-rendered-md>${esc(initialBody)}</div>
      </div>
      <div class="panel-pane ${activeTab === 'raw' ? '' : 'hidden'}" data-panel-pane="raw">
        <pre data-raw-text>${esc(initialBody)}</pre>
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
  // Aggregate per-slug totals; sum across H1 sections (excluding user/tools)
  // for the "system sections" metric so the count still answers "how many
  // H2-level subsections live in the system area."
  let userTotal = 0
  let toolsTotal = 0
  let toolsCount = 0
  let h1SubsectionCount = 0
  let h1Total = 0

  for (const [slug, items] of Object.entries(structure)) {
    const arr = Array.isArray(items) ? items : []
    if (slug === USER_SLUG) {
      userTotal = arr.reduce((sum, item) => sum + getSize(item), 0)
    } else if (slug === TOOLS_SLUG) {
      toolsTotal = arr.reduce((sum, item) => sum + getSize(item), 0)
      toolsCount = arr.length
    } else {
      h1SubsectionCount += arr.length
      h1Total += arr.reduce((sum, item) => sum + getSize(item), 0)
    }
  }
  const total = userTotal + h1Total + toolsTotal

  return `
    <div class="structure-index">
      <div class="section-number">1</div>
      <div class="structure-index-titles">
        <h2>
          Structure
          <span class="cache-info" data-cache-info>
            <button type="button" class="cache-info-trigger" aria-expanded="false" aria-controls="cache-info-popover" aria-label="About the slab order">i</button>
            <span class="cache-info-popover" id="cache-info-popover" role="tooltip">
              Slabs are stacked top-to-bottom in Anthropic's prompt-cache order: <strong>tools → system → messages</strong>. The cache references the prompt in that order up to and including each <code>cache_control</code> block, so changes lower in the stack invalidate less.
              <a href="https://platform.claude.com/docs/en/build-with-claude/prompt-caching" target="_blank" rel="noopener">Prompt caching docs ↗</a>
            </span>
          </span>
        </h2>
        <p>Claude Code ${esc(version)}</p>
      </div>
      <div class="structure-version-pick">
        <label>Version</label>
        <div data-version-picker></div>
      </div>
      <dl class="metric-list">
        <div><dt>Total size</dt><dd>${formatNumber(total)}<span>characters</span></dd></div>
        <div><dt>System sections</dt><dd>${formatNumber(h1SubsectionCount)}</dd></div>
        <div><dt>Tools</dt><dd>${formatNumber(toolsCount)}</dd></div>
        <div><dt>Last updated</dt><dd>${esc(formatDate(versionMeta?.release_date))}<span>local dataset</span></dd></div>
      </dl>
    </div>
  `
}

export async function renderStructure(container) {
  let meta
  let latestPayload
  try {
    ;[meta, latestPayload] = await Promise.all([getMeta(), getLatestStructure()])
  } catch (error) {
    container.innerHTML = renderError(error?.message || 'The local prompt dataset is unavailable.')
    container.querySelector('[data-structure-retry]')?.addEventListener('click', () => renderStructure(container))
    return
  }

  // structures is a lazy map: the latest version is seeded from the small
  // latest.json. Older versions trigger a one-time fetch of the full file.
  const structures = { [latestPayload.version]: latestPayload.structure }
  let allStructuresLoaded = false
  async function ensureStructure(version) {
    if (structures[version]) return structures[version]
    if (!allStructuresLoaded) {
      try {
        const full = await getStructures()
        Object.assign(structures, full)
        allStructuresLoaded = true
      } catch (_error) {
        return null
      }
    }
    return structures[version] ?? null
  }

  const versionMetaList = Array.isArray(meta.versions) ? meta.versions : []
  const versions = versionMetaList.map(v => v.version)
  const topLevelTitles = meta.top_level_titles || {}
  let currentVersion = latestPayload.version || versionMetaList.at(-1)?.version || versions.at(-1)
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
    const structure = await ensureStructure(currentVersion)
    if (token !== drawToken) return
    if (!structure) {
      container.innerHTML = renderError(`Version ${currentVersion} is missing structure data.`)
      container.querySelector('[data-structure-retry]')?.addEventListener('click', () => draw())
      return
    }

    const versionMeta = versionMetaList.find(v => v.version === currentVersion)

    const groups = buildGroups(structure, topLevelTitles).map(group => ({
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
    // Default selection: first system_prompt subsection if present, else
    // first item in first non-user group, else first item overall.
    const firstSystem = groups.find(g => g.slug === 'system_prompt')?.items[0]
      || groups.find(g => g.kind === 'h1')?.items[0]
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
      currentComponents = null
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

    const cacheInfo = container.querySelector('[data-cache-info]')
    const cacheTrigger = cacheInfo?.querySelector('.cache-info-trigger')
    if (cacheInfo && cacheTrigger) {
      // Document-level listeners get torn down when the popover closes so they
      // don't accumulate across redraws (draw() runs on every selection change).
      let dismissCtrl = null
      const close = () => {
        cacheInfo.classList.remove('open')
        cacheTrigger.setAttribute('aria-expanded', 'false')
        dismissCtrl?.abort()
        dismissCtrl = null
      }
      cacheInfo.querySelector('.cache-info-popover')?.addEventListener('click', e => e.stopPropagation())
      cacheTrigger.addEventListener('click', event => {
        event.stopPropagation()
        if (cacheInfo.classList.contains('open')) { close(); return }
        cacheInfo.classList.add('open')
        cacheTrigger.setAttribute('aria-expanded', 'true')
        dismissCtrl = new AbortController()
        document.addEventListener('click', close, { signal: dismissCtrl.signal })
        document.addEventListener('keydown', e => { if (e.key === 'Escape') close() }, { signal: dismissCtrl.signal })
      })
    }

    if (focusSelectedAfterDraw) {
      focusSelectedAfterDraw = false
      requestAnimationFrame(() => {
        container.querySelector('.svg-slab.selected')?.focus()
      })
    }

    if (selectedItem) hydratePanel(selectedItem, token)
  }

  async function hydratePanel(item, token) {
    if (!currentComponents) {
      try { currentComponents = await getComponents(currentVersion) }
      catch { currentComponents = null }
      if (token !== drawToken) return
    }
    let marked
    try { marked = await loadMarked() }
    catch { marked = null }
    if (token !== drawToken) return

    const text = getTextForItem(currentComponents, item)
    const md = text || '_No detail text available._'
    // marked.parse() handles HTML escaping itself — pre-escaping the input
    // produced double-encoded entities like "&quot;" and "&lt;&lt;" inside
    // tool schemas and prose. Fall back to esc() only when marked failed
    // to load, since we still write to innerHTML.
    const html = marked ? marked.parse(md) : esc(md)
    container.querySelectorAll('[data-rendered-md]').forEach(el => { el.innerHTML = html })
    container.querySelectorAll('[data-raw-text]').forEach(el => {
      el.textContent = text || 'No detail text available.'
    })
  }

  await draw()
}
