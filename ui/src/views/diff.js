import './diff.css'
import { getMeta, getStructures, getComponents } from '../data/loader.js'
import { createVersionPicker } from '../components/version-picker.js'

const GROUPS = [
  { key: 'user', label: 'User Prompt' },
  { key: 'system', label: 'System Prompt' },
  { key: 'tools', label: 'Tools' },
]

export async function renderDiff(container) {
  const [meta, structures] = await Promise.all([getMeta(), getStructures()])
  const versions = meta.versions.map(v => v.version)

  let versionA = versions[0]
  let versionB = versions[versions.length - 1]
  let selected = null

  container.innerHTML = `
    <div class="diff-controls">
      <div class="picker-labeled" data-picker-a><label>Version A</label></div>
      <div class="picker-labeled" data-picker-b><label>Version B</label></div>
      <button class="btn-primary" type="button">Compare</button>
      <div class="diff-legend" aria-label="Diff states">
        <span><i class="legend-dot legend-modified"></i>Modified</span>
        <span><i class="legend-dot legend-added"></i>Added</span>
        <span><i class="legend-dot legend-removed"></i>Removed</span>
        <span><i class="legend-line"></i>Unchanged</span>
      </div>
    </div>
    <div class="diff-stage">
      <div class="diff-stack-wrap">
        <div class="diff-version-label" data-label-a></div>
        <div class="diff-stack" data-stack-a></div>
      </div>
      <div class="diff-flow-field" data-flow-field>
        <svg class="diff-flow-svg" aria-hidden="true"></svg>
      </div>
      <div class="diff-stack-wrap">
        <div class="diff-version-label" data-label-b></div>
        <div class="diff-stack" data-stack-b></div>
      </div>
      <aside class="diff-reader" aria-live="polite">
        <div class="diff-reader-kicker">Comparison</div>
        <h3>Select a connection</h3>
        <p>Choose a flow or slab to inspect the structural summary first, then open the text evidence.</p>
      </aside>
    </div>
  `

  createVersionPicker(container.querySelector('[data-picker-a]'), versions, versionA, v => { versionA = v })
  createVersionPicker(container.querySelector('[data-picker-b]'), versions, versionB, v => { versionB = v })

  const compare = async () => {
    selected = null
    await drawComparison(container, structures, versionA, versionB, selected)
  }

  container.querySelector('.btn-primary').addEventListener('click', compare)
  await compare()
}

async function drawComparison(container, structures, versionA, versionB, selected) {
  const stackA = container.querySelector('[data-stack-a]')
  const stackB = container.querySelector('[data-stack-b]')
  const svg = container.querySelector('.diff-flow-svg')
  const reader = container.querySelector('.diff-reader')

  container.querySelector('[data-label-a]').textContent = versionA
  container.querySelector('[data-label-b]').textContent = versionB

  const rows = buildRows(structures[versionA], structures[versionB])
  stackA.innerHTML = renderStack(rows, 'a')
  stackB.innerHTML = renderStack(rows, 'b')

  const selectItem = async (id) => {
    const row = rows.find(r => r.id === id)
    if (!row) return
    container.querySelectorAll('[data-diff-id]').forEach(el => {
      el.classList.toggle('selected', el.dataset.diffId === id)
    })
    await renderReader(reader, row, versionA, versionB)
  }

  container.querySelectorAll('[data-diff-id]').forEach(el => {
    el.addEventListener('click', () => selectItem(el.dataset.diffId))
  })

  requestAnimationFrame(() => {
    drawFlows(container, rows, svg, selectItem)
    if (selected) selectItem(selected)
    else renderSummary(reader, rows, versionA, versionB)
  })
}

function normalizeItems(snapshot, group) {
  if (!snapshot) return []
  if (group === 'user') {
    return (snapshot.user_message || []).map(item => ({
      id: item.key || `${item.kind}/${item.index ?? 0}`,
      title: item.title || item.kind || item.key,
      size: item.char_count || 0,
      group,
    }))
  }
  if (group === 'system') {
    return (snapshot.system_message || snapshot.sections || []).map(item => ({
      id: item.title,
      title: item.title,
      size: item.char_count || 0,
      group,
    }))
  }
  return (snapshot.tools || []).map(item => ({
    id: item.title,
    title: item.title,
    size: item.total_chars || 0,
    group,
    prose: item.prose_chars || 0,
    schema: item.schema_chars || 0,
  }))
}

function buildRows(snapshotA, snapshotB) {
  const rows = []
  GROUPS.forEach(group => {
    const aItems = normalizeItems(snapshotA, group.key)
    const bItems = normalizeItems(snapshotB, group.key)
    const aMap = new Map(aItems.map(item => [item.id, item]))
    const bMap = new Map(bItems.map(item => [item.id, item]))
    const ids = [...new Set([...aMap.keys(), ...bMap.keys()])]

    ids.forEach(id => {
      const a = aMap.get(id)
      const b = bMap.get(id)
      let status = 'unchanged'
      if (a && !b) status = 'removed'
      else if (!a && b) status = 'added'
      else if ((a?.size || 0) !== (b?.size || 0)) status = 'modified'
      rows.push({
        id: `${group.key}:${id}`,
        key: id,
        group: group.key,
        groupLabel: group.label,
        title: a?.title || b?.title || id,
        a,
        b,
        status,
        delta: (b?.size || 0) - (a?.size || 0),
      })
    })
  })
  return rows
}

function renderStack(rows, side) {
  return GROUPS.map(group => {
    const groupRows = rows.filter(row => row.group === group.key)
    return `
      <div class="diff-group" data-group="${group.key}">
        <div class="diff-group-label">${group.label}</div>
        ${groupRows.map(row => {
          const item = side === 'a' ? row.a : row.b
          const present = Boolean(item)
          const orphan = (side === 'a' && row.status === 'removed') || (side === 'b' && row.status === 'added')
          const label = item?.title || row.title
          return `
            <button class="diff-slab ${row.status} ${present ? 'present' : 'absent'} ${orphan ? 'orphan' : ''}"
              type="button"
              data-diff-id="${row.id}"
              data-side="${side}"
              ${present ? '' : 'aria-disabled="true"'}
              title="${escapeHtml(label)}">
              <span>${escapeHtml(label)}</span>
              ${orphan ? `<b>${row.status}</b>` : ''}
            </button>
          `
        }).join('')}
      </div>
    `
  }).join('')
}

function drawFlows(container, rows, svg, onSelect) {
  const field = container.querySelector('[data-flow-field]')
  const rect = field.getBoundingClientRect()
  svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`)
  svg.innerHTML = ''

  rows.filter(row => row.a && row.b).forEach(row => {
    const a = container.querySelector(`[data-diff-id="${CSS.escape(row.id)}"][data-side="a"]`)
    const b = container.querySelector(`[data-diff-id="${CSS.escape(row.id)}"][data-side="b"]`)
    if (!a || !b) return

    const ar = a.getBoundingClientRect()
    const br = b.getBoundingClientRect()
    const y1 = ar.top + ar.height / 2 - rect.top
    const y2 = br.top + br.height / 2 - rect.top
    const x1 = 8
    const x2 = rect.width - 8
    const c = Math.max(34, rect.width * 0.36)

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', `M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`)
    path.setAttribute('class', `diff-flow ${row.status}`)
    path.dataset.diffId = row.id
    path.addEventListener('click', () => onSelect(row.id))
    svg.appendChild(path)
  })
}

function renderSummary(reader, rows, versionA, versionB) {
  const counts = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1
    return acc
  }, {})
  reader.innerHTML = `
    <div class="diff-reader-kicker">Comparison</div>
    <h3>${versionA} to ${versionB}</h3>
    <div class="reader-stat-grid">
      <span><b>${counts.modified || 0}</b> modified</span>
      <span><b>${counts.added || 0}</b> added</span>
      <span><b>${counts.removed || 0}</b> removed</span>
      <span><b>${counts.unchanged || 0}</b> unchanged</span>
    </div>
    <p>Faint lines show continuity. Stronger lines mark changed components; orphan slabs mark additions and removals.</p>
  `
}

async function renderReader(reader, row, versionA, versionB) {
  const [compA, compB] = await Promise.all([
    getComponents(versionA).catch(() => null),
    getComponents(versionB).catch(() => null),
  ])
  const textA = getComponentText(compA, row)
  const textB = getComponentText(compB, row)
  const statusText = row.status === 'modified'
    ? `${row.delta > 0 ? '+' : ''}${row.delta.toLocaleString()} chars`
    : row.status

  reader.innerHTML = `
    <div class="diff-reader-kicker">${row.groupLabel}</div>
    <h3>${escapeHtml(row.title)}</h3>
    <div class="reader-meta">
      <span>${statusText}</span>
      <span>${versionA}: ${(row.a?.size || 0).toLocaleString()} chars</span>
      <span>${versionB}: ${(row.b?.size || 0).toLocaleString()} chars</span>
    </div>
    <div class="stack-tabs">
      <button class="stack-tab active" type="button" data-reader-tab="summary">Summary</button>
      <button class="stack-tab" type="button" data-reader-tab="diff">Text diff</button>
      <button class="stack-tab" type="button" data-reader-tab="a">Raw A</button>
      <button class="stack-tab" type="button" data-reader-tab="b">Raw B</button>
    </div>
    <div class="reader-page" data-reader-page="summary">
      <p>${summaryFor(row)}</p>
    </div>
    <pre class="reader-page hidden" data-reader-page="diff">${escapeHtml(simpleDiff(textA, textB))}</pre>
    <pre class="reader-page hidden" data-reader-page="a">${escapeHtml(textA || 'No text available in Version A.')}</pre>
    <pre class="reader-page hidden" data-reader-page="b">${escapeHtml(textB || 'No text available in Version B.')}</pre>
  `

  reader.querySelectorAll('[data-reader-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.readerTab
      reader.querySelectorAll('[data-reader-tab]').forEach(b => b.classList.toggle('active', b === btn))
      reader.querySelectorAll('[data-reader-page]').forEach(page => {
        page.classList.toggle('hidden', page.dataset.readerPage !== tab)
      })
    })
  })
}

function getComponentText(components, row) {
  if (!components) return ''
  if (row.group === 'system') return components.system_message?.[row.key]?.text || ''
  if (row.group === 'tools') {
    const tool = components.tools?.[row.key]
    if (!tool) return ''
    return [tool.prose, tool.schema].filter(Boolean).join('\n\n')
  }
  return components.user_message?.[row.key]?.text || ''
}

function summaryFor(row) {
  if (row.status === 'added') return `This component appears in Version B and is absent from Version A.`
  if (row.status === 'removed') return `This component exists in Version A and is absent from Version B.`
  if (row.status === 'unchanged') return `This component is structurally present in both versions with the same recorded size.`
  const direction = row.delta > 0 ? 'grew' : 'shrunk'
  return `This component ${direction} by ${Math.abs(row.delta).toLocaleString()} characters between the selected versions. Use Text diff for line-level evidence.`
}

function simpleDiff(a, b) {
  if (!a && !b) return 'No text available for this component.'
  if (a === b) return 'No line-level text changes detected.'
  const aLines = (a || '').split('\n')
  const bLines = (b || '').split('\n')
  const max = Math.max(aLines.length, bLines.length)
  const out = []
  for (let i = 0; i < max; i += 1) {
    if (aLines[i] === bLines[i]) {
      if (aLines[i]) out.push(`  ${aLines[i]}`)
    } else {
      if (aLines[i] !== undefined) out.push(`- ${aLines[i]}`)
      if (bLines[i] !== undefined) out.push(`+ ${bLines[i]}`)
    }
    if (out.length > 240) {
      out.push('... diff truncated for panel readability ...')
      break
    }
  }
  return out.join('\n')
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
