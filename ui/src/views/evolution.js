import * as d3 from 'd3'
import { getMeta, getStructures } from '../data/loader.js'
import { createVersionPicker } from '../components/version-picker.js'

export async function renderEvolution(container) {
  const [meta, structures] = await Promise.all([getMeta(), getStructures()])
  const versions = meta.versions.map(v => v.version)

  let startVersion = versions[Math.max(0, versions.length - 40)]
  let endVersion = versions[versions.length - 1]
  let mode = 'All' // 'User Prompt' | 'System Prompt' | 'Tools' | 'All'

  // Controls
  const controls = document.createElement('div')
  controls.className = 'evolution-controls'

  const startWrap = document.createElement('div')
  startWrap.className = 'picker-labeled'
  startWrap.innerHTML = '<label>Start</label>'
  createVersionPicker(startWrap, versions, startVersion, v => { startVersion = v; draw() })

  const endWrap = document.createElement('div')
  endWrap.className = 'picker-labeled'
  endWrap.innerHTML = '<label>End</label>'
  createVersionPicker(endWrap, versions, endVersion, v => { endVersion = v; draw() })

  const toggleWrap = document.createElement('div')
  toggleWrap.className = 'toggle-group'
  ;['All', 'User Prompt', 'System Prompt', 'Tools'].forEach(m => {
    const btn = document.createElement('button')
    btn.className = 'toggle-btn' + (m === mode ? ' active' : '')
    btn.textContent = m
    btn.addEventListener('click', () => {
      mode = m
      toggleWrap.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      draw()
    })
    toggleWrap.appendChild(btn)
  })

  controls.appendChild(startWrap)
  controls.appendChild(endWrap)
  controls.appendChild(toggleWrap)
  container.appendChild(controls)

  // Tooltip
  const tooltip = document.createElement('div')
  tooltip.className = 'tooltip'
  document.body.appendChild(tooltip)

  // Chart container
  const chartContainer = document.createElement('div')
  chartContainer.className = 'evolution-chart'
  container.appendChild(chartContainer)

  let resizeTimer
  function onResize() {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(draw, 150)
  }
  window.addEventListener('resize', onResize)

  // Clean up tooltip and listener when view changes
  const observer = new MutationObserver(() => {
    if (!document.body.contains(chartContainer)) {
      tooltip.remove()
      window.removeEventListener('resize', onResize)
      observer.disconnect()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })

  function getVersionRange() {
    const si = versions.indexOf(startVersion)
    const ei = versions.indexOf(endVersion)
    if (si < 0 || ei < 0 || si > ei) return versions
    return versions.slice(si, ei + 1)
  }

  function buildRows(range) {
    const rows = []

    if (mode === 'User Prompt' || mode === 'All') {
      const allUser = new Map()
      range.forEach(v => {
        (structures[v]?.user_message || []).forEach(s => allUser.set(s.key || s.title || s.kind, s.title || s.kind || s.key))
      })
      allUser.forEach((label, key) => {
        const values = {}
        range.forEach(v => {
          const item = (structures[v]?.user_message || []).find(s => (s.key || s.title || s.kind) === key)
          if (item) values[v] = item.char_count
        })
        rows.push({ title: label, type: 'user', values })
      })
    }

    if (mode === 'System Prompt' || mode === 'All') {
      // Collect all system message section titles across range
      const allSections = new Set()
      range.forEach(v => {
        (structures[v]?.system_message || []).forEach(s => allSections.add(s.title))
      })
      allSections.forEach(title => {
        const values = {}
        range.forEach(v => {
          const sec = (structures[v]?.system_message || []).find(s => s.title === title)
          if (sec) values[v] = sec.char_count
        })
        rows.push({ title, type: 'section', values })
      })
    }

    if (mode === 'Tools' || mode === 'All') {
      const allTools = new Set()
      range.forEach(v => {
        (structures[v]?.tools || []).forEach(t => allTools.add(t.title))
      })
      allTools.forEach(title => {
        const values = {}
        range.forEach(v => {
          const tool = (structures[v]?.tools || []).find(t => t.title === title)
          if (tool) values[v] = tool.total_chars
        })
        rows.push({ title, type: 'tool', values })
      })
    }

    return rows
  }

  function draw() {
    chartContainer.innerHTML = ''

    const range = getVersionRange()
    const rows = buildRows(range)

    const margin = { top: 20, right: 20, bottom: 60, left: 180 }
    const totalWidth = chartContainer.getBoundingClientRect().width || 900
    const cellH = 28
    const separatorH = (mode === 'All') ? 16 : 0
    const sectionRows = rows.filter(r => r.type === 'section').length
    const userRows = rows.filter(r => r.type === 'user').length
    const innerH = rows.length * cellH + (mode === 'All' ? separatorH * 2 : 0)
    const totalHeight = innerH + margin.top + margin.bottom

    const svg = d3.select(chartContainer)
      .append('svg')
      .attr('width', totalWidth)
      .attr('height', totalHeight)

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`)

    const innerW = totalWidth - margin.left - margin.right

    // X scale
    const xScale = d3.scaleBand()
      .domain(range)
      .range([0, innerW])
      .padding(0.1)

    const tickEvery = Math.max(1, Math.ceil(range.length / 16))
    const visibleTicks = range.filter((_, i) => i % tickEvery === 0 || i === range.length - 1)

    // X axis
    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(d3.axisBottom(xScale).tickValues(visibleTicks))
      .selectAll('text')
      .attr('transform', 'rotate(-45)')
      .attr('text-anchor', 'end')
      .attr('fill', 'var(--text-muted)')
      .attr('font-size', 11)

    g.selectAll('.domain, .tick line').attr('stroke', 'var(--border-default)')

    // Y layout: compute y position for each row
    // In "All" mode, add gaps between the three component groups.
    rows.forEach((row, i) => {
      const extra = mode === 'All'
        ? (row.type === 'section' ? separatorH : row.type === 'tool' ? separatorH * 2 : 0)
        : 0
      row._y = i * cellH + extra
    })

    if (mode === 'All') {
      const separators = [
        userRows ? userRows * cellH + separatorH / 2 : null,
        sectionRows ? (userRows + sectionRows) * cellH + separatorH * 1.5 : null,
      ].filter(Boolean)
      separators.forEach(sepY => {
        g.append('line')
          .attr('x1', 0).attr('x2', innerW)
          .attr('y1', sepY).attr('y2', sepY)
          .attr('stroke', 'var(--border-default)')
          .attr('stroke-dasharray', '4,4')
      })
    }

    // Y axis labels
    rows.forEach(row => {
      g.append('text')
        .attr('x', -8)
        .attr('y', row._y + cellH / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .attr('fill', row.type === 'user' ? 'var(--viz-user)' : row.type === 'section' ? 'var(--viz-system)' : 'var(--viz-tools)')
        .attr('font-size', 11)
        .text(row.title)
    })

    // For each row compute max across range for height scaling
    rows.forEach(row => {
      const vals = Object.values(row.values)
      row._max = d3.max(vals) || 1
    })

    // Draw cells
    rows.forEach((row, rowIdx) => {
      range.forEach((v, vi) => {
        const val = row.values[v]
        if (val === undefined) return

        const x = xScale(v)
        const bw = xScale.bandwidth()
        const fullH = Math.max(4, (val / row._max) * (cellH - 4))
        const color = row.type === 'user' ? 'var(--viz-user)' : row.type === 'section' ? 'var(--viz-system)' : 'var(--viz-tools)'

        const rect = g.append('rect')
          .attr('x', x)
          .attr('y', row._y + (cellH - 0) - 0)
          .attr('width', bw)
          .attr('height', 0)
          .attr('rx', 3)
          .attr('fill', color)
          .attr('opacity', 0.8)

        rect.transition()
          .delay(rowIdx * 30 + vi * 10)
          .duration(500)
          .attr('y', row._y + cellH - fullH)
          .attr('height', fullH)

        // Hover
        rect.on('mousemove', (event) => {
          tooltip.style.opacity = '1'
          tooltip.style.left = (event.clientX + 14) + 'px'
          tooltip.style.top = (event.clientY - 28) + 'px'
          tooltip.innerHTML = `<strong>${v}</strong><br>${row.title}<br>${val.toLocaleString()} chars`
        })
        .on('mouseleave', () => {
          tooltip.style.opacity = '0'
        })
      })
    })
  }

  draw()
}
