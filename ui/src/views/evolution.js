import './evolution.css'
import { getMeta, getStructures } from '../data/loader.js'

const MIN_LABEL_PX = 56

export async function renderEvolution(container) {
  const [meta, structures] = await Promise.all([getMeta(), getStructures()])
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
    allVersions.forEach(v => {
      const item = getItem(v, type, title)
      const count = item ? charCount(item, type) : null
      if (count !== null && prev === null) {
        entries.push({ version: v, event: 'added', count })
      } else if (count === null && prev !== null) {
        entries.push({ version: v, event: 'removed' })
      } else if (count !== null && prev !== null && count !== prev) {
        entries.push({ version: v, event: 'changed', count, delta: count - prev })
      }
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
  marker.textContent = '3'
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

  let activeCell = null

  function fmtDelta(d) {
    if (d == null) return null
    if (d === 0) return 'no change'
    const sign = d > 0 ? '+' : ''
    return `${sign}${d.toLocaleString()} chars`
  }

  function renderTooltip(info) {
    const date = info.date ? `<span class="evo-tt-date">${info.date}</span>` : ''
    const head = `<div class="evo-tt-head"><span class="evo-tt-version">${info.version}</span>${date}</div>`
    if (info.kind === 'total') {
      if (info.value == null) {
        return head + `<div class="evo-tt-empty">No prompt data for this release</div>`
      }
      return head +
        `<div class="evo-tt-row"><span>Total</span><b>${info.value.toLocaleString()} chars</b></div>` +
        `<div class="evo-tt-sub"><span>User Message</span><span>${info.user.toLocaleString()}</span></div>` +
        `<div class="evo-tt-sub"><span>System Prompt</span><span>${info.system.toLocaleString()}</span></div>` +
        `<div class="evo-tt-sub"><span>Tools</span><span>${info.tools.toLocaleString()}</span></div>`
    }
    const title = `<div class="evo-tt-title">${info.title}</div>`
    if (info.value == null) {
      return head + title + `<div class="evo-tt-empty">Section not present in this release</div>`
    }
    const delta = fmtDelta(info.delta)
    const deltaRow = delta ? `<div class="evo-tt-sub"><span>Δ from previous</span><span>${delta}</span></div>` : ''
    return head + title +
      `<div class="evo-tt-row"><span>Size</span><b>${info.value.toLocaleString()} chars</b></div>` +
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
    tableWrap.querySelectorAll('.evo-row.selected').forEach(r => r.classList.remove('selected'))
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
    currChars.textContent = latestChars != null ? `${latestChars.toLocaleString()} chars` : 'Not present'
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
          desc.textContent = `${sign}${entry.delta.toLocaleString()} chars`
        }

        main.appendChild(top)
        main.appendChild(desc)
        row.appendChild(dot)
        row.appendChild(main)
        log.appendChild(row)
      })
    }

    return frag
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
    URL.revokeObjectURL(url)
  }

  // --- Draw ---
  function draw() {
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
      th.title = versionMeta[v]?.release_date || v
      hrow.appendChild(th)
    })
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
      displayVers.forEach(v => {
        const td = document.createElement('td')
        td.className = 'evo-cell'
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
      displayVers.forEach(v => {
        const td = document.createElement('td')
        td.className = 'evo-cell'
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

      displayVers.forEach(v => {
        const td = document.createElement('td')
        td.className = 'evo-cell'
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

      const tr = document.createElement('tr')
      tr.className = 'evo-user-row'

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

      let lastPresent = null
      displayVers.forEach(v => {
        const td = document.createElement('td')
        td.className = 'evo-cell'
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
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      const w = tableWrap.clientWidth
      if (w !== lastWidth) { lastWidth = w; draw() }
    }, 120)
  })
}
