import './evolution.css'
import {
  Virtualizer,
  observeElementRect,
  observeElementOffset,
  elementScroll,
} from '@tanstack/virtual-core'
import { getMeta, getStructures, getComponents } from '../data/loader.js'

const MIN_LABEL_PX = 56
// Slide-window cap: the focal viewport shows at most this many cells at a
// time, regardless of how many versions are in the range. Cell width is
// sized so FOCAL_COUNT cells fill the wrap; extra versions extend the table
// past the viewport, and the user slides the window via horizontal scroll.
const FOCAL_COUNT = 100
const MIN_CELL_PX = 8

// Reserved top-level slugs whose row treatment is special.
const USER_SLUG = 'user_message'
const TOOLS_SLUG = 'tools'

const TOTAL_ROW_KEY = 'total:Total'
const USER_ROW_KEY = 'user:User Message'

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

// True iff the slug corresponds to an H1-section group whose children are
// the H2 subsections we want to track in the Evolution matrix.
function isH1SectionSlug(slug) {
  return slug !== USER_SLUG && slug !== TOOLS_SLUG
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
  const topLevelTitles = meta.top_level_titles || {}

  function topLevelTitleFor(slug) {
    return topLevelTitles[slug] || slug
  }

  // Default range: the entire corpus. The matrix renders every version, but
  // the focal viewport only shows FOCAL_COUNT at a time — the rest live off
  // to the left and the user slides the window via horizontal scroll. First
  // paint snaps to the right edge (latest versions visible) via
  // pendingScrollToEnd below.
  let startVersion = allVersions[0]
  let endVersion = allVersions[allVersions.length - 1]
  let granularity = 'all'
  let selectedKey = null
  // Opt-in row selection for focused screenshots. Selection is decoupled
  // from view filtering — checking rows just accumulates them; the user
  // applies the filter explicitly via the Focus toggle below. That decoupling
  // is what makes multi-row selection work (otherwise the first checkbox
  // would hide all other rows along with their checkboxes).
  const selectedRowKeys = new Set()
  let focusMode = false
  // Horizontal-scroll anchoring: snap to the rightmost (latest) version on
  // first paint and after the user changes the range or granularity. Resize
  // redraws preserve the existing scrollLeft.
  let pendingScrollToEnd = true

  // TanStack Virtual handles "render only the cells in the viewport plus a
  // small overscan" for the column axis. Rebuilt on every full draw; its
  // cleanup callback (returned by _didMount) is captured here so we can tear
  // down ResizeObserver / scroll listeners across redraws and on view unmount.
  let columnVirtualizer = null
  let virtualizerCleanup = null

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

  // For a given version, look up which H1 slug currently owns the H2
  // *title*, plus the corresponding entry. Returns {slug, item} or null.
  function findH1Subsection(version, title) {
    const s = structures[version]
    if (!s) return null
    for (const [slug, items] of Object.entries(s)) {
      if (!isH1SectionSlug(slug)) continue
      const arr = Array.isArray(items) ? items : []
      const found = arr.find(x => x.title === title)
      if (found) return { slug, item: found }
    }
    return null
  }

  function getItem(version, type, title) {
    const s = structures[version]
    if (!s) return null
    if (type === 'h1') {
      const hit = findH1Subsection(version, title)
      return hit ? hit.item : null
    }
    if (type === 'tool') return (s.tools || []).find(x => x.title === title) ?? null
    if (type === 'user') {
      const items = s.user_message || []
      if (items.length === 0) return null
      const total = items.reduce((sum, x) => sum + (x.char_count || 0), 0)
      return { char_count: total }
    }
    return null
  }

  function getParentSlug(version, type, title) {
    if (type === 'tool') return TOOLS_SLUG
    if (type === 'user') return USER_SLUG
    if (type === 'h1') {
      const hit = findH1Subsection(version, title)
      return hit ? hit.slug : null
    }
    return null
  }

  function charCount(item, type) {
    if (!item) return 0
    return type === 'tool' ? (item.total_chars ?? 0) : (item.char_count ?? 0)
  }

  // Build a row per unique H2 title across the range, plus tool rows.
  // For each H2 row, its display "current parent" is the slug it lives
  // under in the latest in-range version that contains it.
  function buildDataRows(range) {
    // Iterate the range newest→oldest so the FIRST seen parent for a title
    // is its most-recent parent — the one we want as "current category."
    const titleMeta = new Map() // title -> { currentSlug, firstSeenIdx (within range), lastSeenIdx }
    for (let i = range.length - 1; i >= 0; i--) {
      const v = range[i]
      const s = structures[v]
      if (!s) continue
      for (const [slug, items] of Object.entries(s)) {
        if (!isH1SectionSlug(slug)) continue
        for (const it of (items || [])) {
          if (!titleMeta.has(it.title)) {
            titleMeta.set(it.title, { currentSlug: slug, lastSeenIdx: i, firstSeenIdx: i })
          } else {
            const m = titleMeta.get(it.title)
            m.firstSeenIdx = Math.min(m.firstSeenIdx, i)
          }
        }
      }
    }

    // Stable sort: by current slug's first-seen H1 column position, then by
    // first-seen index of the title within that H1 in the latest version.
    // We approximate that by reading the title's order from the latest in-range
    // version where its current slug is present.
    const slugOrder = new Map() // slug -> ordering index from latest version's keys
    for (let i = range.length - 1; i >= 0; i--) {
      const v = range[i]
      const s = structures[v]
      if (!s) continue
      let oi = 0
      for (const slug of Object.keys(s)) {
        if (!isH1SectionSlug(slug)) continue
        if (!slugOrder.has(slug)) slugOrder.set(slug, oi++)
      }
      // Take only the first version we see (latest in range that has data).
      break
    }

    // Order titles within their current slug by their position in the latest
    // version's list (where they live under that slug now).
    const titleOrder = new Map() // title -> integer
    {
      const latestV = [...range].reverse().find(v => structures[v])
      if (latestV) {
        const s = structures[latestV]
        for (const [slug, items] of Object.entries(s)) {
          if (!isH1SectionSlug(slug)) continue
          (items || []).forEach((it, idx) => {
            if (!titleOrder.has(it.title)) titleOrder.set(it.title, idx)
          })
        }
      }
    }

    const h1Rows = [...titleMeta.entries()]
      .map(([title, m]) => buildH1Row(title, m.currentSlug, range))
      .sort((a, b) => {
        const sa = slugOrder.has(a.currentSlug) ? slugOrder.get(a.currentSlug) : 999
        const sb = slugOrder.has(b.currentSlug) ? slugOrder.get(b.currentSlug) : 999
        if (sa !== sb) return sa - sb
        const ta = titleOrder.has(a.title) ? titleOrder.get(a.title) : 999
        const tb = titleOrder.has(b.title) ? titleOrder.get(b.title) : 999
        if (ta !== tb) return ta - tb
        return a.title.localeCompare(b.title)
      })

    // Tool rows: union across the range, ordered by first appearance.
    const toolTitles = []
    const toolSeen = new Set()
    range.forEach(v => {
      ;(structures[v]?.tools || []).forEach(t => {
        if (!toolSeen.has(t.title)) { toolSeen.add(t.title); toolTitles.push(t.title) }
      })
    })
    const toolRows = toolTitles.map(title => buildToolRow(title, range))

    return { h1Rows, toolRows }
  }

  function buildH1Row(title, currentSlug, range) {
    // values: per-version char count
    // perVersionParent: per-version slug (color encoding)
    const values = {}
    const perVersionParent = {}
    range.forEach(v => {
      const hit = findH1Subsection(v, title)
      if (hit) {
        values[v] = hit.item.char_count || 0
        perVersionParent[v] = hit.slug
      }
    })
    const vals = Object.values(values)
    const max = vals.length ? Math.max(1, ...vals) : 1
    return {
      key: `h1:${title}`,
      type: 'h1',
      title,
      currentSlug,
      values,
      perVersionParent,
      _max: max,
    }
  }

  function buildToolRow(title, range) {
    const values = {}
    range.forEach(v => {
      const t = (structures[v]?.tools || []).find(x => x.title === title)
      if (t) values[v] = t.total_chars || 0
    })
    const vals = Object.values(values)
    const max = vals.length ? Math.max(1, ...vals) : 1
    return {
      key: `tool:${title}`,
      type: 'tool',
      title,
      currentSlug: TOOLS_SLUG,
      values,
      perVersionParent: Object.fromEntries(Object.keys(values).map(v => [v, TOOLS_SLUG])),
      _max: max,
    }
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

  const controls = document.createElement('div')
  controls.className = 'evo-controls'

  const rangeGrp = ctrlGroup('Range')
  const rangeRow = document.createElement('div')
  rangeRow.className = 'evo-range-row'
  const startSelect = makeRangeSelect(allVersions, startVersion, v => { startVersion = v; pendingScrollToEnd = true; draw() })
  const dash = document.createElement('span')
  dash.className = 'evo-range-dash'
  dash.textContent = '–'
  dash.setAttribute('aria-hidden', 'true')
  const endSelect = makeRangeSelect(allVersions, endVersion, v => { endVersion = v; pendingScrollToEnd = true; draw() })
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
  granSel.addEventListener('change', () => { granularity = granSel.value; pendingScrollToEnd = true; draw() })
  granGrp.body.appendChild(granSel)
  controls.appendChild(granGrp.root)

  headerBand.appendChild(controls)

  const selectionPill = document.createElement('div')
  selectionPill.className = 'evo-selection-pill'
  selectionPill.hidden = true
  const selCount = document.createElement('span')
  selCount.className = 'evo-sel-count'
  const selFocus = document.createElement('button')
  selFocus.type = 'button'
  selFocus.className = 'evo-sel-focus'
  selFocus.setAttribute('aria-pressed', 'false')
  selFocus.textContent = 'Focus'
  selFocus.addEventListener('click', () => {
    focusMode = !focusMode
    applyRowVisibility()
    updateSelectionPill()
  })
  const selClear = document.createElement('button')
  selClear.type = 'button'
  selClear.className = 'evo-sel-clear'
  selClear.textContent = 'Clear'
  selClear.addEventListener('click', () => {
    selectedRowKeys.clear()
    focusMode = false
    tableWrap.querySelectorAll('.evo-row-check').forEach(cb => { cb.checked = false })
    applyRowVisibility()
    updateSelectionPill()
  })
  selectionPill.appendChild(selCount)
  selectionPill.appendChild(selFocus)
  selectionPill.appendChild(selClear)
  headerBand.appendChild(selectionPill)

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

  const footnote = document.createElement('div')
  footnote.className = 'evo-footnote'
  footnote.textContent = 'All times in your local timezone'
  container.appendChild(footnote)

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
      let body = `<div class="evo-tt-row"><span>Total</span><b>${fmtNumber(info.value)} chars</b></div>`
      // Show every top-level slug present in this version, in document order.
      for (const [slug, label, sum] of (info.breakdown || [])) {
        body += `<div class="evo-tt-sub"><span>${esc(label)}</span><span>${fmtNumber(sum)}</span></div>`
      }
      return head + body
    }
    const titleLine = info.parentLabel
      ? `<div class="evo-tt-title">${esc(info.parentLabel)} · ${esc(info.title)}</div>`
      : `<div class="evo-tt-title">${esc(info.title)}</div>`
    if (info.value == null) {
      return head + titleLine + `<div class="evo-tt-empty">Section not present in this release</div>`
    }
    const delta = fmtDelta(info.delta)
    const deltaRow = delta ? `<div class="evo-tt-sub"><span>Δ from previous</span><span>${delta}</span></div>` : ''
    return head + titleLine +
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

  function makeRowCheckbox(key, ariaLabel) {
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.className = 'evo-row-check'
    cb.checked = selectedRowKeys.has(key)
    cb.setAttribute('aria-label', `Include ${ariaLabel} in focus selection`)
    // Stop click bubbling so the checkbox doesn't also trigger row activation.
    cb.addEventListener('click', e => e.stopPropagation())
    cb.addEventListener('change', () => {
      if (cb.checked) selectedRowKeys.add(key)
      else selectedRowKeys.delete(key)
      // If the user empties the selection while focused, drop focus mode so
      // the table doesn't go blank with no path back without the pill.
      if (selectedRowKeys.size === 0) focusMode = false
      applyRowVisibility()
      updateSelectionPill()
    })
    return cb
  }

  function applyRowVisibility() {
    const filterActive = focusMode && selectedRowKeys.size > 0
    const tbody = tableWrap.querySelector('tbody')
    if (!tbody) return
    for (const tr of tbody.children) {
      // Inline expand rows piggyback on their preceding row's visibility.
      if (tr.classList.contains('evo-expand-row')) {
        const prev = tr.previousElementSibling
        tr.style.display = prev && prev.style.display === 'none' ? 'none' : ''
        continue
      }
      const k = tr.dataset.key
      if (!k) { tr.style.display = ''; continue }
      tr.style.display = !filterActive || selectedRowKeys.has(k) ? '' : 'none'
    }
  }

  function updateSelectionPill() {
    const n = selectedRowKeys.size
    if (n === 0) {
      selectionPill.hidden = true
      selFocus.setAttribute('aria-pressed', 'false')
      selFocus.textContent = 'Focus'
      return
    }
    selCount.textContent = `${n} selected`
    selectionPill.hidden = false
    selFocus.setAttribute('aria-pressed', focusMode ? 'true' : 'false')
    selFocus.textContent = focusMode ? 'Show all' : 'Focus'
  }

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
    tableWrap.querySelectorAll('.evo-expand-row').forEach(r => {
      r._sizeRo?.disconnect()
      r.remove()
    })
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
    // Span the full grid via the colgroup count rather than the row's child
    // count — the row's children fluctuate as the column virtualizer scrolls.
    const colCount = tableWrap.querySelector('colgroup')?.childElementCount
    td.colSpan = colCount || row.children.length

    // The td spans the full ~6000 px table so the row visually exists across
    // all columns, but content is contained in an inner div sized to the
    // wrap's visible width. Combined with the td's `position: sticky; left: 0`
    // styling, the change log stays anchored at the focal viewport instead
    // of running off into the scrolled-out area.
    const inner = document.createElement('div')
    inner.className = 'evo-expand-inner'
    inner.appendChild(buildHistoryFragment(type, title))
    td.appendChild(inner)
    expandRow.appendChild(td)
    row.insertAdjacentElement('afterend', expandRow)

    const syncWidth = () => {
      // 356 = sticky label column widths (.evo-col-cat 168 + .evo-col-sec 188).
      // Inner is offset to begin just past those, so its width must shrink
      // by the same amount to end at the viewport's right edge. Keep this in
      // sync with `left: 356px` in .evo-expand-inner.
      const focalWidth = Math.max(0, tableWrap.clientWidth - 356)
      inner.style.width = focalWidth + 'px'
    }
    syncWidth()
    // ResizeObserver keeps the inner width in lock-step with the wrap on
    // window resizes, sidebar toggles, etc. Disconnected in closePanel().
    const ro = new ResizeObserver(syncWidth)
    ro.observe(tableWrap)
    expandRow._sizeRo = ro
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
  // can't hang the tab. Above the cap we fall back to naive zip/diff.
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
    if (type === 'h1') {
      // The subsection lives under whichever H1 slug currently owns it.
      // Search every non-special slug.
      for (const [slug, sub] of Object.entries(data)) {
        if (slug === USER_SLUG || slug === TOOLS_SLUG) continue
        if (sub && sub[title]) return sub[title].text ?? null
      }
      return null
    }
    return null
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
        lineEl.textContent = d.l || ' '
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
    const { h1Rows, toolRows } = buildDataRows(range)

    const header = ['Category', 'Section', 'Type', ...displayVers].join(',')
    const lines = []
    h1Rows.forEach(r => {
      const cat = topLevelTitleFor(r.currentSlug)
      lines.push([
        `"${cat.replace(/"/g, '""')}"`,
        `"${r.title.replace(/"/g, '""')}"`,
        'h1',
        ...displayVers.map(v => r.values[v] ?? ''),
      ].join(','))
    })
    toolRows.forEach(r => {
      lines.push([
        '"Tools"',
        `"${r.title.replace(/"/g, '""')}"`,
        'tool',
        ...displayVers.map(v => r.values[v] ?? ''),
      ].join(','))
    })

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
    tooltip.classList.remove('open')
    activeCell = null

    tableWrap.innerHTML = ''
    legend.innerHTML = ''

    const range = getRange()
    const displayVers = applyGranularity(range)
    const { h1Rows, toolRows } = buildDataRows(range)

    const table = document.createElement('table')
    table.className = 'evo-table'

    // Two sticky label columns combined occupy ~356 px. Cell width is sized
    // so the focal view shows at most FOCAL_COUNT versions; once the corpus
    // exceeds that, the matrix overflows and the wrap container scrolls
    // horizontally instead of squeezing every column into the viewport.
    const wrapWidth = tableWrap.clientWidth || 1200
    const matrixWidth = Math.max(0, wrapWidth - 356)
    const focalCols = Math.max(1, Math.min(displayVers.length, FOCAL_COUNT))
    const cellWidth = Math.max(MIN_CELL_PX, Math.floor(matrixWidth / focalCols))
    const labelStep = Math.max(1, Math.ceil(MIN_LABEL_PX / cellWidth))

    const colgroup = document.createElement('colgroup')
    const colCat = document.createElement('col'); colCat.className = 'evo-col-cat'
    const colSec = document.createElement('col'); colSec.className = 'evo-col-sec'
    colgroup.appendChild(colCat)
    colgroup.appendChild(colSec)
    displayVers.forEach(() => {
      const c = document.createElement('col')
      c.className = 'evo-col-v'
      c.style.width = `${cellWidth}px`
      colgroup.appendChild(c)
    })
    table.appendChild(colgroup)

    // Model-release anchors
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

    // RowMeta captures everything fillRow() needs to (re)render a row's
    // version-axis cells given a TanStack-Virtual visible range. Each row
    // contributes one entry (header rows + body rows alike). The cellCache
    // memoizes per-index cell elements so subsequent scrolls just rearrange
    // existing nodes via replaceChildren instead of paying createElement +
    // className + appendChild for each visible cell on every onChange. Cache
    // lives at draw scope; redraws (range/granularity/resize) build fresh
    // metas with empty caches.
    const rowMetas = []

    function pushRowMeta(tr, stickyCount, makeCell) {
      rowMetas.push({ tr, stickyCount, makeCell, cellCache: new Map() })
    }

    const thead = document.createElement('thead')

    if (modelMarkers.length > 0) {
      table.classList.add('has-models')
      const modelRow = document.createElement('tr')
      modelRow.className = 'evo-model-row'
      const thMarker = document.createElement('th')
      thMarker.className = 'evo-th evo-th-cat evo-th-models'
      thMarker.scope = 'col'
      thMarker.colSpan = 2
      thMarker.textContent = 'Models'
      modelRow.appendChild(thMarker)

      const markerByIdx = new Map()
      modelMarkers.forEach(m => {
        const list = markerByIdx.get(m.idx) || []
        list.push(m)
        markerByIdx.set(m.idx, list)
      })

      pushRowMeta(modelRow, 1, i => {
        const th = document.createElement('th')
        th.scope = 'col'
        const events = markerByIdx.get(i)
        const cls = ['evo-model-cell']
        if (modelAnchorIndices.has(i)) cls.push('model-anchor')
        if (events) cls.push('has-marker')
        th.className = cls.join(' ')
        if (events) {
          events.forEach((e, k) => {
            const marker = document.createElement('span')
            marker.className = `evo-model-marker ${e.order % 2 === 0 ? 'upper' : 'lower'}${k > 0 ? ' offset' : ''}`
            marker.textContent = e.label
            marker.title = `${e.label} released ${e.date}`
            th.appendChild(marker)
          })
        }
        return th
      })
      thead.appendChild(modelRow)
    }

    const hrow = document.createElement('tr')
    const thCat = document.createElement('th'); thCat.scope = 'col'; thCat.className = 'evo-th evo-th-cat'; thCat.textContent = 'Category'
    const thSec = document.createElement('th'); thSec.scope = 'col'; thSec.className = 'evo-th evo-th-sec'; thSec.textContent = 'Section'
    hrow.appendChild(thCat)
    hrow.appendChild(thSec)
    pushRowMeta(hrow, 2, i => {
      const v = displayVers[i]
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
      return th
    })
    thead.appendChild(hrow)
    table.appendChild(thead)

    const tbody = document.createElement('tbody')

    function buildBreakdown(version) {
      const s = structures[version]
      if (!s) return null
      const out = []
      let total = 0
      for (const [slug, items] of Object.entries(s)) {
        const label = topLevelTitleFor(slug)
        const arr = Array.isArray(items) ? items : []
        let sum = 0
        if (slug === TOOLS_SLUG) {
          arr.forEach(it => { sum += it.total_chars || 0 })
        } else {
          arr.forEach(it => { sum += it.char_count || 0 })
        }
        if (sum > 0) {
          out.push([slug, label, sum])
          total += sum
        }
      }
      return { total, breakdown: out }
    }

    function addTotalRow() {
      const totals = {}
      const breakdowns = {}
      range.forEach(v => {
        const b = buildBreakdown(v)
        if (b && b.total > 0) {
          totals[v] = b.total
          breakdowns[v] = b.breakdown
        }
      })
      const vals = Object.values(totals)
      if (vals.length === 0) return
      const max = Math.max(...vals)

      const tr = document.createElement('tr')
      tr.className = 'evo-total-row'
      tr.setAttribute('data-key', TOTAL_ROW_KEY)

      const tdCat = document.createElement('td')
      tdCat.className = 'evo-td-cat evo-total-cat'
      tdCat.colSpan = 2
      tdCat.appendChild(makeRowCheckbox(TOTAL_ROW_KEY, 'Total'))
      const label = document.createElement('span')
      label.className = 'evo-total-label'
      label.textContent = 'Total'
      tdCat.appendChild(label)
      tr.appendChild(tdCat)

      pushRowMeta(tr, 1, i => {
        const v = displayVers[i]
        const td = document.createElement('td')
        td.className = 'evo-cell' + (modelAnchorIndices.has(i) ? ' model-anchor' : '')
        const val = totals[v]
        if (val !== undefined) {
          const bar = document.createElement('span')
          bar.className = 'evo-bar total'
          bar.style.height = `${(Math.max(0.06, val / max) * 100).toFixed(1)}%`
          td.appendChild(bar)
        }
        td._info = {
          kind: 'total',
          version: v,
          date: fmtDate(v),
          value: val,
          breakdown: breakdowns[v] || [],
        }
        return td
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

      const key = USER_ROW_KEY
      const tr = document.createElement('tr')
      tr.className = 'evo-row evo-user-row'
      tr.setAttribute('data-key', key)
      tr.setAttribute('tabindex', '0')
      if (key === selectedKey) tr.classList.add('selected')

      const tdCat = document.createElement('td')
      tdCat.className = 'evo-td-cat'
      tdCat.appendChild(makeRowCheckbox(key, 'User Message'))
      const dot = document.createElement('span')
      dot.className = 'evo-cat-dot slug-user_message'
      const catLabel = document.createElement('span')
      catLabel.className = 'evo-cat-label'
      catLabel.textContent = topLevelTitleFor(USER_SLUG)
      tdCat.appendChild(dot)
      tdCat.appendChild(catLabel)
      tr.appendChild(tdCat)

      const tdSec = document.createElement('td')
      tdSec.className = 'evo-td-sec'
      const sec = document.createElement('span')
      sec.className = 'evo-sec-label'
      sec.textContent = 'User Message'
      tdSec.appendChild(sec)
      tr.appendChild(tdSec)

      const activate = () => openPanel(key, 'user', 'User Message')
      tr.addEventListener('click', activate)
      tr.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate() }
      })

      // Precompute the per-index delta (vs last present version). Cells are
      // rendered windowed via TanStack Virtual, so we can't track lastPresent
      // inside the renderer — the loop only sees the visible slice.
      const deltaByIdx = new Array(displayVers.length).fill(null)
      {
        let lastPresent = null
        displayVers.forEach((v, i) => {
          const val = totals[v]
          if (val !== undefined && lastPresent !== null) deltaByIdx[i] = val - lastPresent
          if (val !== undefined) lastPresent = val
        })
      }

      pushRowMeta(tr, 2, i => {
        const v = displayVers[i]
        const td = document.createElement('td')
        td.className = 'evo-cell' + (modelAnchorIndices.has(i) ? ' model-anchor' : '')
        const val = totals[v]
        if (val !== undefined) {
          const bar = document.createElement('span')
          bar.className = 'evo-bar slug-user_message'
          bar.style.height = `${(Math.max(0.06, val / max) * 100).toFixed(1)}%`
          td.appendChild(bar)
        }
        td._info = {
          kind: 'component',
          version: v,
          date: fmtDate(v),
          title: 'User Message',
          parentLabel: topLevelTitleFor(USER_SLUG),
          value: val,
          delta: deltaByIdx[i],
        }
        return td
      })

      tbody.appendChild(tr)
    }

    function addRow(rowData, currentParentLabel) {
      const tr = document.createElement('tr')
      tr.className = 'evo-row'
      tr.setAttribute('data-key', rowData.key)
      tr.setAttribute('tabindex', '0')
      if (rowData.key === selectedKey) tr.classList.add('selected')

      const tdCat = document.createElement('td')
      tdCat.className = 'evo-td-cat'
      tdCat.appendChild(makeRowCheckbox(rowData.key, rowData.title))
      const dot = document.createElement('span')
      dot.className = `evo-cat-dot slug-${rowData.currentSlug}`
      const catLabel = document.createElement('span')
      catLabel.className = 'evo-cat-label'
      catLabel.textContent = currentParentLabel
      catLabel.title = currentParentLabel
      tdCat.appendChild(dot)
      tdCat.appendChild(catLabel)
      tr.appendChild(tdCat)

      const tdSec = document.createElement('td')
      tdSec.className = 'evo-td-sec'
      const compInner = document.createElement('span')
      compInner.className = 'evo-comp-inner'
      const icon = document.createElement('span')
      icon.className = 'evo-row-icon'
      icon.setAttribute('aria-hidden', 'true')
      icon.innerHTML = `<svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 3l3 3-3 3"/></svg>`
      const label = document.createElement('span')
      label.className = 'evo-sec-label'
      label.textContent = rowData.title
      label.title = rowData.title
      compInner.appendChild(icon)
      compInner.appendChild(label)
      tdSec.appendChild(compInner)
      tr.appendChild(tdSec)

      // Precompute deltas — see addUserMessageRow for the rationale.
      const deltaByIdx = new Array(displayVers.length).fill(null)
      {
        let lastPresent = null
        displayVers.forEach((v, i) => {
          const val = rowData.values[v]
          if (val !== undefined && lastPresent !== null) deltaByIdx[i] = val - lastPresent
          if (val !== undefined) lastPresent = val
        })
      }

      pushRowMeta(tr, 2, i => {
        const v = displayVers[i]
        const td = document.createElement('td')
        td.className = 'evo-cell' + (modelAnchorIndices.has(i) ? ' model-anchor' : '')
        const val = rowData.values[v]
        const slugAtVer = rowData.perVersionParent[v] || rowData.currentSlug
        if (val !== undefined) {
          const fill = val / rowData._max
          const bar = document.createElement('span')
          bar.className = `evo-bar slug-${slugAtVer}`
          bar.style.height = `${(Math.max(0.06, fill) * 100).toFixed(1)}%`
          td.appendChild(bar)
        }
        td._info = {
          kind: 'component',
          version: v,
          date: fmtDate(v),
          title: rowData.title,
          parentLabel: topLevelTitleFor(slugAtVer),
          value: val,
          delta: deltaByIdx[i],
        }
        return td
      })

      const activate = () => openPanel(rowData.key, rowData.type, rowData.title)
      tr.addEventListener('click', activate)
      tr.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate() }
      })

      tbody.appendChild(tr)
    }

    addTotalRow()
    addUserMessageRow()

    // H1 subsection rows (already sorted by current parent + position).
    h1Rows.forEach(r => addRow(r, topLevelTitleFor(r.currentSlug)))
    // Tool rows.
    toolRows.forEach(r => addRow(r, topLevelTitleFor(TOOLS_SLUG)))

    table.appendChild(tbody)
    tableWrap.appendChild(table)

    // --- TanStack Virtual: column windowing -----------------------------
    // Rebuild on every draw because displayVers (range/granularity) and
    // cellWidth can change. Old virtualizer's _didMount cleanup is captured
    // in virtualizerCleanup at module scope; tear it down before creating a
    // fresh one so ResizeObservers / scroll listeners don't leak.
    if (virtualizerCleanup) { virtualizerCleanup(); virtualizerCleanup = null }
    columnVirtualizer = null

    const totalCols = displayVers.length

    function makeSpacer(tr, count) {
      // Header rows are <tr> inside <thead>; body rows inside <tbody>. Use
      // <th>/<td> to match so the HTML stays valid.
      const inThead = tr.parentElement?.tagName === 'THEAD'
      const sp = document.createElement(inThead ? 'th' : 'td')
      sp.className = 'evo-spacer'
      sp.colSpan = count
      if (inThead) sp.scope = 'col'
      return sp
    }

    function fillRow(meta, virtualItems) {
      const { tr, stickyCount, makeCell, cellCache } = meta

      const sticky = []
      for (let i = 0; i < stickyCount; i++) sticky.push(tr.children[i])

      const tail = []

      if (virtualItems.length === 0) {
        if (totalCols > 0) tail.push(makeSpacer(tr, totalCols))
      } else {
        const firstIdx = virtualItems[0].index
        if (firstIdx > 0) tail.push(makeSpacer(tr, firstIdx))
        for (const item of virtualItems) {
          // Memoized cell: created once on first visit, reused forever.
          let cell = cellCache.get(item.index)
          if (!cell) {
            cell = makeCell(item.index)
            cellCache.set(item.index, cell)
          }
          tail.push(cell)
        }
        const lastIdx = virtualItems[virtualItems.length - 1].index
        const trailing = totalCols - lastIdx - 1
        if (trailing > 0) tail.push(makeSpacer(tr, trailing))
      }

      // Atomic swap. Cached cells move from being detached to being attached
      // (or just rearrange position) without any creation cost.
      tr.replaceChildren(...sticky, ...tail)
    }

    function fillAllRows(virtualItems) {
      for (const meta of rowMetas) fillRow(meta, virtualItems)
    }

    if (totalCols > 0) {
      columnVirtualizer = new Virtualizer({
        count: totalCols,
        horizontal: true,
        // Larger overscan keeps a buffer of pre-rendered cells on each side
        // of the viewport so fast horizontal scrolls don't reveal blank
        // space before onChange fires the next batch render.
        overscan: 30,
        getScrollElement: () => tableWrap,
        estimateSize: () => cellWidth,
        scrollToFn: elementScroll,
        observeElementRect,
        observeElementOffset,
        onChange: instance => fillAllRows(instance.getVirtualItems()),
      })
      columnVirtualizer._willUpdate()
      virtualizerCleanup = columnVirtualizer._didMount()
      fillAllRows(columnVirtualizer.getVirtualItems())
    } else {
      fillAllRows([])
    }

    // Snap to the rightmost (latest) version after the table has been filled,
    // because scrollWidth only resolves once the colgroup-driven layout has a
    // chance to measure. Browser clamps to scrollWidth - clientWidth; the
    // virtualizer's scroll listener picks this up and re-fills the visible
    // window for the latest range.
    if (pendingScrollToEnd) {
      tableWrap.scrollLeft = tableWrap.scrollWidth
      pendingScrollToEnd = false
    }
    // -------------------------------------------------------------------

    // Legend: one swatch per top-level slug present in the corpus.
    const slugsInCorpus = new Set()
    Object.values(structures).forEach(s => Object.keys(s).forEach(k => slugsInCorpus.add(k)))
    // Order: user_message first, then h1 sections in title-map order, then tools.
    const legendSlugs = []
    if (slugsInCorpus.has(USER_SLUG)) legendSlugs.push(USER_SLUG)
    Object.keys(topLevelTitles).forEach(slug => {
      if (slug !== USER_SLUG && slug !== TOOLS_SLUG && slugsInCorpus.has(slug)) {
        legendSlugs.push(slug)
      }
    })
    if (slugsInCorpus.has(TOOLS_SLUG)) legendSlugs.push(TOOLS_SLUG)

    legend.innerHTML = legendSlugs.map(slug =>
      `<span class="evo-leg"><span class="evo-leg-swatch slug-${slug}"></span>${esc(topLevelTitleFor(slug))}</span>`
    ).join('') +
      `<span class="evo-leg evo-leg-note">Bar height = character count · color = parent section in that release · empty cell = absent</span>`

    // Restore selection if a row was open before redraw
    if (selectedKey) {
      const [type, title] = selectedKey.split(/:(.*)/)
      const restoreKey = selectedKey
      selectedKey = null
      openPanel(restoreKey, type, title)
    }

    applyRowVisibility()
    updateSelectionPill()
  }

  draw()

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
  cleanupFns.push(() => {
    if (virtualizerCleanup) { virtualizerCleanup(); virtualizerCleanup = null }
    columnVirtualizer = null
  })
}
