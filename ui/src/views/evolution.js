import './evolution.css'
import { getMeta, getStructures, getComponents } from '../data/loader.js'

const MIN_LABEL_PX = 56

// Claude model releases that fall within the Claude Code 1.0 → 2.x history.
// Anchored to the first version whose release_date is on or after the model's
// launch date, so the marker reads "this is the version where {model} became
// available."
const MODEL_RELEASES = [
  { date: '2025-05-22', label: 'Claude 4' },
  { date: '2025-08-05', label: 'Opus 4.1' },
  { date: '2025-09-29', label: 'Sonnet 4.5' },
  { date: '2025-10-15', label: 'Haiku 4.5' },
  { date: '2025-11-24', label: 'Opus 4.5' },
  { date: '2026-02-04', label: 'Opus 4.6' },
  { date: '2026-02-17', label: 'Sonnet 4.6' },
  { date: '2026-04-16', label: 'Opus 4.7' },
]

function esc(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtNumber(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(value || 0))
}

function renderSurfaceState(container, kind, message) {
  container.classList.add('evo-surface')
  container.innerHTML = ''
  const wrap = document.createElement('div')
  wrap.className = `evo-state evo-state-${kind}`
  wrap.setAttribute('role', kind === 'error' ? 'alert' : 'status')
  const title = document.createElement('div')
  title.className = 'evo-state-title'
  title.textContent = kind === 'error' ? 'Could not load evolution data' : 'No evolution data available'
  const body = document.createElement('p')
  body.className = 'evo-state-body'
  body.textContent = message
  wrap.appendChild(title)
  wrap.appendChild(body)
  if (kind === 'error') {
    const retry = document.createElement('button')
    retry.type = 'button'
    retry.className = 'evo-state-retry'
    retry.textContent = 'Retry'
    retry.addEventListener('click', () => {
      container.classList.remove('evo-surface')
      container.innerHTML = ''
      renderEvolution(container)
    })
    wrap.appendChild(retry)
  }
  container.appendChild(wrap)
}

export async function renderEvolution(container) {
  container._evoCleanup?.()
  container._evoCleanup = null

  let meta, structures
  try {
    ;[meta, structures] = await Promise.all([getMeta(), getStructures()])
  } catch (err) {
    console.error('Evolution: failed to load data', err)
    renderSurfaceState(container, 'error', 'Network or parse error while loading version metadata. Check the dev server and refresh.')
    return
  }
  if (!meta?.versions?.length || !structures || Object.keys(structures).length === 0) {
    renderSurfaceState(container, 'empty', 'No prompt captures were found. Run the analyzer export to populate /data/.')
    return
  }
  const allVersions = meta.versions.map(v => v.version)
  const versionMeta = Object.fromEntries(meta.versions.map(v => [v.version, v]))

  let startVersion = allVersions[0]
  let endVersion = allVersions[allVersions.length - 1]
  let granularity = 'all'
  let selectedKey = null
  const collapsedGroups = new Set()

  function getRange() {
    const si = allVersions.indexOf(startVersion)
    const ei = allVersions.indexOf(endVersion)
    if (si < 0 || ei < 0 || si > ei) return allVersions.slice(-40)
    return allVersions.slice(si, ei + 1)
  }

  function applyGranularity(range) {
    if (granularity === 'all') return range
    const step = granularity === 'major' ? 5 : 10
    return range.filter((_, i) => i % step === 0 || i === range.length - 1)
  }

  function getItem(version, type, title) {
    const s = structures[version]
    if (!s) return null
    if (type === 'system') return (s.system_message || []).find(x => x.title === title) ?? null
    if (type === 'tool')   return (s.tools || []).find(x => x.title === title) ?? null
    if (type === 'user') {
      const items = s.user_message || []
      if (items.length === 0) return null
      const total = items.reduce((sum, x) => sum + (x.char_count || 0), 0)
      return { char_count: total }
    }
    return null
  }

  function charCount(item, type) {
    if (!item) return 0
    return type === 'tool' ? (item.total_chars ?? 0) : (item.char_count ?? 0)
  }

  function buildDataRows(range) {
    const systemTitles = [], systemSeen = new Set()
    range.forEach(v => {
      ;(structures[v]?.system_message || []).forEach(s => {
        if (!systemSeen.has(s.title)) { systemSeen.add(s.title); systemTitles.push(s.title) }
      })
    })
    const systemRows = systemTitles.map(title => buildRow('system', title, range))

    const toolTitles = [], toolSeen = new Set()
    range.forEach(v => {
      ;(structures[v]?.tools || []).forEach(t => {
        if (!toolSeen.has(t.title)) { toolSeen.add(t.title); toolTitles.push(t.title) }
      })
    })
    const toolRows = toolTitles.map(title => buildRow('tool', title, range))

    return { systemRows, toolRows }
  }

  function buildRow(type, title, range) {
    const values = {}
    range.forEach(v => {
      const item = getItem(v, type, title)
      if (item) values[v] = charCount(item, type)
    })
    const vals = Object.values(values)
    const max = vals.length ? Math.max(1, ...vals) : 1
    return { key: `${type}:${title}`, type, title, values, _max: max }
  }

  function computeHistory(type, title) {
    const entries = []
    let prev = null
    let prevVer = null
    allVersions.forEach(v => {
      const item = getItem(v, type, title)
      const count = item ? charCount(item, type) : null
      if (count !== null && prev === null) {
        entries.push({ version: v, event: 'added', count, prevVer: null })
      } else if (count === null && prev !== null) {
        entries.push({ version: v, event: 'removed', prevVer })
      } else if (count !== null && prev !== null && count !== prev) {
        entries.push({ version: v, event: 'changed', count, delta: count - prev, prevVer })
      }
      if (count !== null) prevVer = v
      prev = count
    })
    return entries.reverse()
  }

  function fmtDate(version) {
    const raw = versionMeta[version]?.release_date
    if (!raw) return null
    const d = new Date(raw)
    if (isNaN(d)) return raw
    return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' })
  }

  // --- Surface scaffold ---
  container.classList.add('evo-surface')
  container.innerHTML = ''

  const headerBand = document.createElement('div')
  headerBand.className = 'evo-header-band'

  // Eyebrow (section marker + title block)
  const eyebrow = document.createElement('div')
  eyebrow.className = 'evo-eyebrow'
  const marker = document.createElement('span')
  marker.className = 'evo-eyebrow-num'
  marker.textContent = '2'
  marker.setAttribute('aria-hidden', 'true')
  const titleBlock = document.createElement('div')
  titleBlock.className = 'evo-title-block'
  const titleEl = document.createElement('h2')
  titleEl.className = 'evo-title'
  titleEl.textContent = 'Evolution'
  const subEl = document.createElement('div')
  subEl.className = 'evo-subtitle'
  subEl.textContent = 'Track changes across versions'
  titleBlock.appendChild(titleEl)
  titleBlock.appendChild(subEl)
  eyebrow.appendChild(marker)
  eyebrow.appendChild(titleBlock)
  headerBand.appendChild(eyebrow)

  // Controls
  const controls = document.createElement('div')
  controls.className = 'evo-controls'

  const rangeGrp = ctrlGroup('Range')
  const rangeRow = document.createElement('div')
  rangeRow.className = 'evo-range-row'
  const startSelect = makeRangeSelect(allVersions, startVersion, v => { startVersion = v; draw() })
  const dash = document.createElement('span')
  dash.className = 'evo-range-dash'
  dash.textContent = '–'
  dash.setAttribute('aria-hidden', 'true')
  const endSelect = makeRangeSelect(allVersions, endVersion, v => { endVersion = v; draw() })
  rangeRow.appendChild(startSelect)
  rangeRow.appendChild(dash)
  rangeRow.appendChild(endSelect)
  rangeGrp.body.appendChild(rangeRow)
  controls.appendChild(rangeGrp.root)

  const granGrp = ctrlGroup('Granularity')
  const granSel = document.createElement('select')
  granSel.className = 'evo-select'
  ;[['all', 'All versions'], ['major', 'Every 5th'], ['coarse', 'Every 10th']].forEach(([v, l]) => {
    const o = document.createElement('option')
    o.value = v; o.textContent = l
    if (v === granularity) o.selected = true
    granSel.appendChild(o)
  })
  granSel.addEventListener('change', () => { granularity = granSel.value; draw() })
  granGrp.body.appendChild(granSel)
  controls.appendChild(granGrp.root)

  headerBand.appendChild(controls)

  const exportBtn = document.createElement('button')
  exportBtn.type = 'button'
  exportBtn.className = 'evo-export'
  exportBtn.innerHTML = `
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M8 2v8.5"/><path d="M4.7 7.3 8 10.5l3.3-3.2"/><path d="M3 13.2h10"/>
    </svg>
    <span>Export</span>
    <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M6 3.5 10.5 8 6 12.5"/>
    </svg>
  `
  exportBtn.addEventListener('click', exportCSV)
  headerBand.appendChild(exportBtn)

  container.appendChild(headerBand)

  // Body
  const body = document.createElement('div')
  body.className = 'evo-body'
  container.appendChild(body)

  const ledger = document.createElement('div')
  ledger.className = 'evo-ledger'
  body.appendChild(ledger)

  const tableWrap = document.createElement('div')
  tableWrap.className = 'evo-table-wrap'
  ledger.appendChild(tableWrap)

  const legend = document.createElement('div')
  legend.className = 'evo-legend'
  ledger.appendChild(legend)


  // Surface footer
  const footnote = document.createElement('div')
  footnote.className = 'evo-footnote'
  footnote.textContent = 'All times in your local timezone'
  container.appendChild(footnote)

  // Tooltip
  const tooltip = document.createElement('div')
  tooltip.className = 'evo-tooltip'
  tooltip.setAttribute('role', 'tooltip')
  tooltip.setAttribute('aria-hidden', 'true')
  document.body.appendChild(tooltip)
  const cleanupFns = [() => tooltip.remove()]
  container._evoCleanup = () => {
    cleanupFns.forEach(fn => fn())
    container._evoCleanup = null
  }

  let activeCell = null

  function fmtDelta(d) {
    if (d == null) return null
    if (d === 0) return 'no change'
    const sign = d > 0 ? '+' : ''
    return `${sign}${fmtNumber(d)} chars`
  }

  function renderTooltip(info) {
    const date = info.date ? `<span class="evo-tt-date">${esc(info.date)}</span>` : ''
    const head = `<div class="evo-tt-head"><span class="evo-tt-version">${esc(info.version)}</span>${date}</div>`
    if (info.kind === 'total') {
      if (info.value == null) {
        return head + `<div class="evo-tt-empty">No prompt data for this release</div>`
      }
      return head +
        `<div class="evo-tt-row"><span>Total</span><b>${fmtNumber(info.value)} chars</b></div>` +
        `<div class="evo-tt-sub"><span>User Message</span><span>${fmtNumber(info.user)}</span></div>` +
        `<div class="evo-tt-sub"><span>System Prompt</span><span>${fmtNumber(info.system)}</span></div>` +
        `<div class="evo-tt-sub"><span>Tools</span><span>${fmtNumber(info.tools)}</span></div>`
    }
    const title = `<div class="evo-tt-title">${esc(info.title)}</div>`
    if (info.value == null) {
      return head + title + `<div class="evo-tt-empty">Section not present in this release</div>`
    }
    const delta = fmtDelta(info.delta)
    const deltaRow = delta ? `<div class="evo-tt-sub"><span>Δ from previous</span><span>${delta}</span></div>` : ''
    return head + title +
      `<div class="evo-tt-row"><span>Size</span><b>${fmtNumber(info.value)} chars</b></div>` +
      deltaRow
  }

  function positionTooltip(x, y) {
    const r = tooltip.getBoundingClientRect()
    const margin = 8
    let nx = x - r.width / 2
    let ny = y - r.height - 14
    if (nx < margin) nx = margin
    if (nx + r.width > window.innerWidth - margin) nx = window.innerWidth - r.width - margin
    if (ny < margin) ny = y + 16
    tooltip.style.transform = `translate(${nx}px, ${ny}px)`
  }

  tableWrap.addEventListener('mousemove', e => {
    const cell = e.target.closest('.evo-cell')
    if (!cell || !cell._info) {
      if (activeCell) { tooltip.classList.remove('open'); activeCell = null }
      return
    }
    if (cell !== activeCell) {
      activeCell = cell
      tooltip.innerHTML = renderTooltip(cell._info)
      tooltip.classList.add('open')
    }
    positionTooltip(e.clientX, e.clientY)
  })

  tableWrap.addEventListener('mouseleave', () => {
    tooltip.classList.remove('open')
    activeCell = null
  })

  function ctrlGroup(label) {
    const root = document.createElement('div')
    root.className = 'evo-ctrl-grp'
    const lab = document.createElement('span')
    lab.className = 'evo-ctrl-label'
    lab.textContent = label
    const bod = document.createElement('div')
    bod.className = 'evo-ctrl-body'
    root.appendChild(lab)
    root.appendChild(bod)
    return { root, body: bod }
  }

  function makeRangeSelect(versions, current, onChange) {
    const sel = document.createElement('select')
    sel.className = 'evo-select evo-select-version'
    sel.setAttribute('aria-label', 'Version')
    versions.forEach(v => {
      const opt = document.createElement('option')
      opt.value = v
      opt.textContent = v
      if (v === current) opt.selected = true
      sel.appendChild(opt)
    })
    sel.addEventListener('change', () => onChange(sel.value))
    return sel
  }

  // --- Inline expansion ---
  function closePanel() {
    selectedKey = null
    tableWrap.querySelectorAll('tr.selected').forEach(r => r.classList.remove('selected'))
    tableWrap.querySelectorAll('.evo-expand-row').forEach(r => r.remove())
  }

  function openPanel(key, type, title) {
    if (selectedKey === key) { closePanel(); return }
    closePanel()
    selectedKey = key

    const row = tableWrap.querySelector(`tr[data-key="${CSS.escape(key)}"]`)
    if (!row) return
    row.classList.add('selected')

    const expandRow = document.createElement('tr')
    expandRow.className = 'evo-expand-row'
    const td = document.createElement('td')
    td.className = 'evo-expand-td'
    td.colSpan = row.children.length
    td.appendChild(buildHistoryFragment(type, title))
    expandRow.appendChild(td)
    row.insertAdjacentElement('afterend', expandRow)
  }

  function buildHistoryFragment(type, title) {
    const frag = document.createDocumentFragment()

    const latestV = allVersions[allVersions.length - 1]
    const latestItem = getItem(latestV, type, title)
    const latestChars = latestItem ? charCount(latestItem, type) : null

    const head = document.createElement('div')
    head.className = 'evo-expand-head'

    const summary = document.createElement('div')
    summary.className = 'evo-curr'
    const currVerLine = document.createElement('div')
    currVerLine.className = 'evo-curr-line'
    currVerLine.textContent = `Current (${latestV})`
    const currChars = document.createElement('div')
    currChars.className = 'evo-curr-chars'
    currChars.textContent = latestChars != null ? `${fmtNumber(latestChars)} chars` : 'Not present'
    summary.appendChild(currVerLine)
    summary.appendChild(currChars)
    const currDate = fmtDate(latestV)
    if (currDate) {
      const d = document.createElement('div')
      d.className = 'evo-curr-date'
      d.textContent = `Updated ${currDate}`
      summary.appendChild(d)
    }
    head.appendChild(summary)

    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'evo-panel-close'
    closeBtn.setAttribute('aria-label', 'Close detail')
    closeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>`
    closeBtn.addEventListener('click', e => { e.stopPropagation(); closePanel() })
    head.appendChild(closeBtn)
    frag.appendChild(head)

    const logHd = document.createElement('div')
    logHd.className = 'evo-log-hd'
    logHd.textContent = 'Change log'
    frag.appendChild(logHd)

    const log = document.createElement('div')
    log.className = 'evo-log'
    frag.appendChild(log)

    const history = computeHistory(type, title)
    if (history.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'evo-log-empty'
      empty.textContent = 'No recorded changes in version history.'
      log.appendChild(empty)
    } else {
      history.forEach((entry, i) => {
        const row = document.createElement('div')
        row.className = 'evo-log-row'

        const isInitial = entry.event === 'added' && i === history.length - 1
        const dotKind = isInitial ? 'initial'
          : entry.event === 'added' ? 'added'
          : entry.event === 'removed' ? 'removed'
          : 'changed'
        const dot = document.createElement('span')
        dot.className = `evo-log-dot evo-log-dot-${dotKind}`

        const main = document.createElement('div')
        main.className = 'evo-log-main'

        const top = document.createElement('div')
        top.className = 'evo-log-top'
        const ver = document.createElement('span')
        ver.className = 'evo-log-ver'
        ver.textContent = entry.version
        const date = fmtDate(entry.version)
        if (date) {
          const dateEl = document.createElement('span')
          dateEl.className = 'evo-log-date'
          dateEl.textContent = date
          top.appendChild(ver)
          top.appendChild(dateEl)
        } else {
          top.appendChild(ver)
        }

        const desc = document.createElement('div')
        desc.className = 'evo-log-desc'
        if (isInitial) desc.textContent = 'Initial version'
        else if (entry.event === 'added') desc.textContent = 'Re-added'
        else if (entry.event === 'removed') desc.textContent = 'Removed'
        else if (entry.delta != null) {
          const sign = entry.delta > 0 ? '+' : ''
          desc.textContent = `${sign}${fmtNumber(entry.delta)} chars`
        }

        main.appendChild(top)
        main.appendChild(desc)
        row.appendChild(dot)
        row.appendChild(main)

        row.classList.add('evo-log-clickable')
        row.setAttribute('role', 'button')
        row.setAttribute('tabindex', '0')
        const verLabel = entry.version + (fmtDate(entry.version) ? ' (' + fmtDate(entry.version) + ')' : '')
        row.setAttribute('aria-label', `Show diff for ${verLabel}`)
        const activate = () => toggleDiff(row, log, type, title, entry)
        row.addEventListener('click', activate)
        row.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate() }
        })

        log.appendChild(row)
      })
    }

    return frag
  }

  // O(m·n) cap so a pathological diff (5000-line schema vs 5000-line schema = 25M cells)
  // can't hang the tab. Above the cap we fall back to naive zip/diff: pairwise compare lines
  // up to the shorter side, then mark the rest add/del. Loses LCS optimality but stays linear.
  const LCS_MAX_CELLS = 2_000_000

  function naiveDiff(a, b) {
    const A = a.split('\n')
    const B = b.split('\n')
    const out = []
    const min = Math.min(A.length, B.length)
    for (let i = 0; i < min; i++) {
      if (A[i] === B[i]) out.push({ t: 'eq', l: A[i] })
      else { out.push({ t: 'del', l: A[i] }); out.push({ t: 'add', l: B[i] }) }
    }
    for (let i = min; i < A.length; i++) out.push({ t: 'del', l: A[i] })
    for (let i = min; i < B.length; i++) out.push({ t: 'add', l: B[i] })
    return out
  }

  // Linear-time-friendly LCS line diff. Returns an array of { t: 'eq'|'add'|'del', l: line }.
  function lineDiff(a, b) {
    const A = a.split('\n')
    const B = b.split('\n')
    const m = A.length, n = B.length
    if ((m + 1) * (n + 1) > LCS_MAX_CELLS) return naiveDiff(a, b)
    const dp = Array(m + 1).fill(null).map(() => new Int32Array(n + 1))
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = A[i - 1] === B[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
    const out = []
    let i = m, j = n
    while (i > 0 && j > 0) {
      if (A[i - 1] === B[j - 1]) { out.push({ t: 'eq', l: A[i - 1] }); i--; j-- }
      else if (dp[i - 1][j] >= dp[i][j - 1]) { out.push({ t: 'del', l: A[i - 1] }); i-- }
      else { out.push({ t: 'add', l: B[j - 1] }); j-- }
    }
    while (i > 0) { out.push({ t: 'del', l: A[i - 1] }); i-- }
    while (j > 0) { out.push({ t: 'add', l: B[j - 1] }); j-- }
    return out.reverse()
  }

  async function fetchComponentText(version, type, title) {
    const data = await getComponents(version)
    if (!data) return null
    if (type === 'tool') {
      const t = data.tools?.[title]
      if (!t) return null
      const parts = []
      if (t.prose) parts.push(t.prose)
      if (t.schema) parts.push('\n--- Schema ---\n' + t.schema)
      return parts.join('\n')
    }
    if (type === 'user') {
      const um = data.user_message || {}
      const keys = Object.keys(um)
      if (keys.length === 0) return null
      return keys.map(k => `=== ${k} ===\n${um[k].text || ''}`).join('\n\n')
    }
    return data.system_message?.[title]?.text ?? null
  }

  async function toggleDiff(row, log, type, title, entry) {
    const existing = row.nextElementSibling
    if (existing && existing.classList.contains('evo-diff')) {
      existing.remove()
      row.classList.remove('expanded')
      return
    }

    log.querySelectorAll('.evo-diff').forEach(d => d.remove())
    log.querySelectorAll('.evo-log-row.expanded').forEach(r => r.classList.remove('expanded'))
    row.classList.add('expanded')

    const diffEl = document.createElement('div')
    diffEl.className = 'evo-diff loading'
    diffEl.textContent = 'Loading content…'
    row.insertAdjacentElement('afterend', diffEl)

    // Race guard — if the user clicks another entry (or closes this one) while
    // our fetch is in flight, the diffEl is detached or replaced. Bail before
    // painting into it.
    const isStale = () => !diffEl.isConnected || row.nextElementSibling !== diffEl

    try {
      const [aText, bText] = await Promise.all([
        entry.prevVer ? fetchComponentText(entry.prevVer, type, title) : Promise.resolve(''),
        entry.event === 'removed' ? Promise.resolve('') : fetchComponentText(entry.version, type, title),
      ])
      if (isStale()) return

      diffEl.textContent = ''
      diffEl.classList.remove('loading')

      const isInitial = entry.event === 'added' && !entry.prevVer
      const meta = document.createElement('div')
      meta.className = 'evo-diff-meta'
      if (isInitial) {
        meta.textContent = `${entry.version}: initial version`
      } else if (entry.event === 'removed') {
        meta.textContent = `${entry.prevVer} → ${entry.version}: removed`
      } else if (entry.event === 'added') {
        meta.textContent = `${entry.prevVer} → ${entry.version}: re-added`
      } else {
        meta.textContent = `${entry.prevVer} → ${entry.version}`
      }
      diffEl.appendChild(meta)

      const body = document.createElement('div')
      body.className = 'evo-diff-body'
      diffEl.appendChild(body)

      const a = aText || ''
      const b = bText || ''
      const lines = isInitial
        ? b.split('\n').map(l => ({ t: 'init', l }))
        : entry.event === 'removed'
          ? a.split('\n').map(l => ({ t: 'del', l }))
          : lineDiff(a, b)

      lines.forEach(d => {
        const lineEl = document.createElement('div')
        lineEl.className = `evo-diff-line evo-diff-${d.t}`
        lineEl.textContent = d.l || ' '
        body.appendChild(lineEl)
      })

      if (lines.length === 0 || (lines.every(d => d.t === 'eq'))) {
        const note = document.createElement('div')
        note.className = 'evo-diff-empty'
        note.textContent = 'No textual change.'
        body.appendChild(note)
      }
    } catch (err) {
      if (isStale()) return
      console.error('Evolution diff: load failed', err)
      diffEl.textContent = 'Could not load content for this version. Try again.'
      diffEl.classList.remove('loading')
      diffEl.classList.add('error')
    }
  }

  // --- Export ---
  function exportCSV() {
    const range = getRange()
    const displayVers = applyGranularity(range)
    const { systemRows, toolRows } = buildDataRows(range)

    const header = ['Component', 'Type', ...displayVers].join(',')
    const lines = [...systemRows, ...toolRows].map(r =>
      [`"${r.title.replace(/"/g, '""')}"`, r.type, ...displayVers.map(v => r.values[v] ?? '')].join(',')
    )

    const csv = [header, ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `evolution-${startVersion}-to-${endVersion}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  // --- Draw ---
  function draw() {
    // Tear down any tooltip pointing at a cell we're about to delete.
    tooltip.classList.remove('open')
    activeCell = null

    tableWrap.innerHTML = ''
    legend.innerHTML = ''

    const range = getRange()
    const displayVers = applyGranularity(range)
    const { systemRows, toolRows } = buildDataRows(range)

    const table = document.createElement('table')
    table.className = 'evo-table'

    // Compute label density from the matrix width so labels never crowd.
    const wrapWidth = tableWrap.clientWidth || 1200
    const matrixWidth = Math.max(0, wrapWidth - 196 /* Component column */)
    const maxLabels = Math.max(2, Math.floor(matrixWidth / MIN_LABEL_PX))
    const labelStep = Math.max(1, Math.ceil(displayVers.length / maxLabels))

    const colgroup = document.createElement('colgroup')
    const colComp = document.createElement('col'); colComp.className = 'evo-col-comp'
    colgroup.appendChild(colComp)
    displayVers.forEach(() => {
      const c = document.createElement('col'); c.className = 'evo-col-v'
      colgroup.appendChild(c)
    })
    table.appendChild(colgroup)

    // Compute model-release anchors first so we can tag both the version-axis
    // cells and the data cells with .model-anchor for a continuous guide line.
    // Each release lands on the first displayed version with release_date >= launch date.
    // `order` (chronological index) drives the upper/lower lane assignment so
    // adjacent releases never share a lane.
    const modelMarkers = MODEL_RELEASES.map((event, order) => {
      const target = new Date(event.date).getTime()
      let idx = -1
      for (let i = 0; i < displayVers.length; i++) {
        const verDate = versionMeta[displayVers[i]]?.release_date
        if (!verDate) continue
        if (new Date(verDate).getTime() >= target) { idx = i; break }
      }
      return idx >= 0 ? { ...event, idx, order } : null
    }).filter(Boolean)

    const modelAnchorIndices = new Set(modelMarkers.map(m => m.idx))

    const thead = document.createElement('thead')
    const hrow = document.createElement('tr')
    const thComp = document.createElement('th'); thComp.scope = 'col'; thComp.className = 'evo-th evo-th-comp'; thComp.textContent = 'Component'
    hrow.appendChild(thComp)

    displayVers.forEach((v, i) => {
      const th = document.createElement('th')
      th.scope = 'col'
      th.className = 'evo-th evo-th-v'
      const isLast = i === displayVers.length - 1
      const labeled = i % labelStep === 0 || isLast
      if (labeled) {
        th.classList.add('labeled')
        const span = document.createElement('span')
        span.className = 'evo-th-v-label'
        span.textContent = v
        th.appendChild(span)
      }
      if (modelAnchorIndices.has(i)) th.classList.add('model-anchor')
      th.title = versionMeta[v]?.release_date || v
      hrow.appendChild(th)
    })

    if (modelMarkers.length > 0) {
      const modelRow = document.createElement('tr')
      modelRow.className = 'evo-model-row'
      const thMarker = document.createElement('th')
      thMarker.className = 'evo-th evo-th-comp evo-th-models'
      thMarker.scope = 'col'
      thMarker.textContent = 'Models'
      modelRow.appendChild(thMarker)

      const markerByIdx = new Map()
      modelMarkers.forEach(m => {
        const list = markerByIdx.get(m.idx) || []
        list.push(m)
        markerByIdx.set(m.idx, list)
      })

      displayVers.forEach((_, i) => {
        const th = document.createElement('th')
        th.scope = 'col'
        th.className = 'evo-model-cell' + (modelAnchorIndices.has(i) ? ' model-anchor' : '')
        const events = markerByIdx.get(i)
        if (events) {
          events.forEach((e, k) => {
            const marker = document.createElement('span')
            // Alternate lanes by chronological order, so adjacent releases never share one.
            marker.className = `evo-model-marker ${e.order % 2 === 0 ? 'upper' : 'lower'}${k > 0 ? ' offset' : ''}`
            marker.textContent = e.label
            marker.title = `${e.label} released ${e.date}`
            th.appendChild(marker)
          })
        }
        modelRow.appendChild(th)
      })

      thead.appendChild(modelRow)
    }

    thead.appendChild(hrow)
    table.appendChild(thead)

    const tbody = document.createElement('tbody')

    function addGroupRow(label, groupKey, dotClass) {
      // Per-version section totals
      const totals = {}
      range.forEach(v => {
        const s = structures[v]
        if (!s) return
        let sum = 0
        if (groupKey === 'system') {
          ;(s.system_message || []).forEach(item => { sum += item.char_count || 0 })
        } else if (groupKey === 'tools') {
          ;(s.tools || []).forEach(item => { sum += item.total_chars || 0 })
        }
        if (sum > 0) totals[v] = sum
      })
      const vals = Object.values(totals)
      const max = vals.length ? Math.max(...vals) : 1

      const isCollapsed = collapsedGroups.has(groupKey)
      const row = document.createElement('tr')
      row.className = 'evo-group-row'
      row.setAttribute('aria-expanded', String(!isCollapsed))
      row.setAttribute('role', 'button')
      row.setAttribute('tabindex', '0')
      row.setAttribute('aria-label', `${isCollapsed ? 'Expand' : 'Collapse'} ${label}`)

      const tdComp = document.createElement('td')
      tdComp.className = 'evo-td-comp evo-group-comp'

      const chev = document.createElement('span')
      chev.className = 'evo-group-chev' + (isCollapsed ? ' collapsed' : '')
      chev.setAttribute('aria-hidden', 'true')
      chev.innerHTML = `<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5l3 3 3-3"/></svg>`

      const dot = document.createElement('span')
      dot.className = `evo-group-dot ${dotClass}`

      const name = document.createElement('span')
      name.className = 'evo-group-name'
      name.textContent = label

      tdComp.appendChild(chev)
      tdComp.appendChild(dot)
      tdComp.appendChild(name)
      row.appendChild(tdComp)

      const barClass = dotClass === 'sys' ? 'sys' : 'tool'
      let lastPresent = null
      displayVers.forEach((v, i) => {
        const td = document.createElement('td')
        td.className = 'evo-cell' + (modelAnchorIndices.has(i) ? ' model-anchor' : '')
        const val = totals[v]
        if (val !== undefined) {
          const bar = document.createElement('span')
          bar.className = `evo-bar ${barClass}`
          bar.style.height = `${(Math.max(0.06, val / max) * 100).toFixed(1)}%`
          td.appendChild(bar)
        }
        td._info = {
          kind: 'component',
          version: v,
          date: fmtDate(v),
          title: label,
          value: val,
          delta: val !== undefined && lastPresent !== null ? val - lastPresent : null,
        }
        if (val !== undefined) lastPresent = val
        row.appendChild(td)
      })

      row.addEventListener('click', () => {
        if (collapsedGroups.has(groupKey)) collapsedGroups.delete(groupKey)
        else collapsedGroups.add(groupKey)
        draw()
      })
      row.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        if (collapsedGroups.has(groupKey)) collapsedGroups.delete(groupKey)
        else collapsedGroups.add(groupKey)
        draw()
      })
      tbody.appendChild(row)
      return isCollapsed
    }

    function addComponentRow(rowData) {
      const tr = document.createElement('tr')
      tr.className = 'evo-row'
      tr.setAttribute('data-key', rowData.key)
      tr.setAttribute('tabindex', '0')
      if (rowData.key === selectedKey) tr.classList.add('selected')

      const tdComp = document.createElement('td')
      tdComp.className = 'evo-td-comp'
      const compInner = document.createElement('span')
      compInner.className = 'evo-comp-inner'
      const icon = document.createElement('span')
      icon.className = 'evo-row-icon'
      icon.setAttribute('aria-hidden', 'true')
      icon.innerHTML = `<svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 3l3 3-3 3"/></svg>`
      const label = document.createElement('span')
      label.className = 'evo-comp-label'
      label.textContent = rowData.title
      label.title = rowData.title
      compInner.appendChild(icon)
      compInner.appendChild(label)
      tdComp.appendChild(compInner)
      tr.appendChild(tdComp)

      const typeClass = rowData.type === 'tool' ? 'tool' : 'sys'
      let lastPresent = null
      displayVers.forEach((v, i) => {
        const td = document.createElement('td')
        td.className = 'evo-cell' + (modelAnchorIndices.has(i) ? ' model-anchor' : '')
        const val = rowData.values[v]
        if (val !== undefined) {
          const fill = val / rowData._max
          const bar = document.createElement('span')
          bar.className = `evo-bar ${typeClass}`
          bar.style.height = `${(Math.max(0.06, fill) * 100).toFixed(1)}%`
          td.appendChild(bar)
        }
        td._info = {
          kind: 'component',
          version: v,
          date: fmtDate(v),
          title: rowData.title,
          value: val,
          delta: val !== undefined && lastPresent !== null ? val - lastPresent : null,
        }
        if (val !== undefined) lastPresent = val
        tr.appendChild(td)
      })

      const activate = () => openPanel(rowData.key, rowData.type, rowData.title)
      tr.addEventListener('click', activate)
      tr.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate() }
      })

      tbody.appendChild(tr)
    }

    function addTotalRow() {
      const totals = {}
      range.forEach(v => {
        const s = structures[v]
        if (!s) return
        let sum = 0
        ;(s.user_message || []).forEach(item => { sum += item.char_count || 0 })
        ;(s.system_message || []).forEach(item => { sum += item.char_count || 0 })
        ;(s.tools || []).forEach(item => { sum += item.total_chars || 0 })
        if (sum > 0) totals[v] = sum
      })
      const vals = Object.values(totals)
      const max = vals.length ? Math.max(...vals) : 1

      const tr = document.createElement('tr')
      tr.className = 'evo-total-row'

      const tdComp = document.createElement('td')
      tdComp.className = 'evo-td-comp evo-total-comp'
      const label = document.createElement('span')
      label.className = 'evo-total-label'
      label.textContent = 'Total'
      tdComp.appendChild(label)
      tr.appendChild(tdComp)

      displayVers.forEach((v, i) => {
        const td = document.createElement('td')
        td.className = 'evo-cell' + (modelAnchorIndices.has(i) ? ' model-anchor' : '')
        const val = totals[v]
        if (val !== undefined) {
          const bar = document.createElement('span')
          bar.className = 'evo-bar total'
          bar.style.height = `${(Math.max(0.06, val / max) * 100).toFixed(1)}%`
          td.appendChild(bar)
        }
        const s = structures[v]
        const userSum = s ? (s.user_message || []).reduce((a, x) => a + (x.char_count || 0), 0) : 0
        const sysSum = s ? (s.system_message || []).reduce((a, x) => a + (x.char_count || 0), 0) : 0
        const toolsSum = s ? (s.tools || []).reduce((a, x) => a + (x.total_chars || 0), 0) : 0
        td._info = {
          kind: 'total',
          version: v,
          date: fmtDate(v),
          value: val,
          user: userSum,
          system: sysSum,
          tools: toolsSum,
        }
        tr.appendChild(td)
      })

      tbody.appendChild(tr)
    }

    function addUserMessageRow() {
      const totals = {}
      range.forEach(v => {
        const s = structures[v]
        if (!s) return
        const sum = (s.user_message || []).reduce((a, x) => a + (x.char_count || 0), 0)
        if (sum > 0) totals[v] = sum
      })
      const vals = Object.values(totals)
      if (vals.length === 0) return
      const max = Math.max(...vals)

      const key = 'user:User Message'
      const tr = document.createElement('tr')
      tr.className = 'evo-user-row'
      tr.setAttribute('data-key', key)
      tr.setAttribute('tabindex', '0')
      if (key === selectedKey) tr.classList.add('selected')

      const tdComp = document.createElement('td')
      tdComp.className = 'evo-td-comp evo-user-comp'
      const dot = document.createElement('span')
      dot.className = 'evo-group-dot user'
      const label = document.createElement('span')
      label.className = 'evo-user-label'
      label.textContent = 'User Message'
      tdComp.appendChild(dot)
      tdComp.appendChild(label)
      tr.appendChild(tdComp)

      const activate = () => openPanel(key, 'user', 'User Message')
      tr.addEventListener('click', activate)
      tr.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate() }
      })

      let lastPresent = null
      displayVers.forEach((v, i) => {
        const td = document.createElement('td')
        td.className = 'evo-cell' + (modelAnchorIndices.has(i) ? ' model-anchor' : '')
        const val = totals[v]
        if (val !== undefined) {
          const bar = document.createElement('span')
          bar.className = 'evo-bar user'
          bar.style.height = `${(Math.max(0.06, val / max) * 100).toFixed(1)}%`
          td.appendChild(bar)
        }
        td._info = {
          kind: 'component',
          version: v,
          date: fmtDate(v),
          title: 'User Message',
          value: val,
          delta: val !== undefined && lastPresent !== null ? val - lastPresent : null,
        }
        if (val !== undefined) lastPresent = val
        tr.appendChild(td)
      })

      tbody.appendChild(tr)
    }

    addTotalRow()
    addUserMessageRow()

    const sysCollapsed = addGroupRow('System Prompt', 'system', 'sys')
    if (!sysCollapsed) systemRows.forEach(r => addComponentRow(r))

    const toolsCollapsed = addGroupRow('Tools', 'tools', 'tool')
    if (!toolsCollapsed) toolRows.forEach(r => addComponentRow(r))

    table.appendChild(tbody)
    tableWrap.appendChild(table)

    legend.innerHTML = `
      <span class="evo-leg"><span class="evo-leg-swatch user"></span>User Message</span>
      <span class="evo-leg"><span class="evo-leg-swatch sys"></span>System Prompt</span>
      <span class="evo-leg"><span class="evo-leg-swatch tool"></span>Tools</span>
      <span class="evo-leg evo-leg-note">Bar height = character count · empty cell = section absent in that release</span>`

    // Restore selection if a row was open before redraw
    if (selectedKey) {
      const [type, title] = selectedKey.split(/:(.*)/)
      const restoreKey = selectedKey
      selectedKey = null
      openPanel(restoreKey, type, title)
    }
  }

  draw()

  // Re-render on resize so the label density tracks the actual matrix width.
  let resizeTimer = null
  let lastWidth = tableWrap.clientWidth
  const onResize = () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      const w = tableWrap.clientWidth
      if (w !== lastWidth) { lastWidth = w; draw() }
    }, 120)
  }
  window.addEventListener('resize', onResize)
  cleanupFns.push(() => window.removeEventListener('resize', onResize))
  cleanupFns.push(() => clearTimeout(resizeTimer))
}
