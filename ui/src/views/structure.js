import * as d3 from 'd3'
import { getMeta, getStructures } from '../data/loader.js'
import { createVersionPicker } from '../components/version-picker.js'

export async function renderStructure(container) {
  const [meta, structures] = await Promise.all([getMeta(), getStructures()])
  const versions = meta.versions.map(v => v.version)
  let currentVersion = versions[versions.length - 1]

  // Header row with version picker
  const header = document.createElement('div')
  header.className = 'view-header'
  header.innerHTML = '<h2>Prompt Structure</h2>'
  const pickerWrap = document.createElement('div')
  pickerWrap.className = 'picker-wrap'
  createVersionPicker(pickerWrap, versions, currentVersion, (v) => {
    currentVersion = v
    renderContent()
  })
  header.appendChild(pickerWrap)
  container.appendChild(header)

  // Content area
  const content = document.createElement('div')
  content.className = 'structure-content'
  container.appendChild(content)

  function renderContent() {
    content.innerHTML = ''
    const data = structures[currentVersion]
    if (!data) {
      content.innerHTML = '<p class="error">No data for version ' + currentVersion + '</p>'
      return
    }

    // Two-column layout
    const cols = document.createElement('div')
    cols.className = 'structure-cols'

    // Sections column
    const secCol = document.createElement('div')
    secCol.className = 'structure-col'
    secCol.innerHTML = '<h3>System Prompt Sections</h3>'
    const secMax = d3.max(data.sections, d => d.char_count) || 1
    renderBarList(secCol, data.sections, 'char_count', secMax, '#60a5fa')
    cols.appendChild(secCol)

    // Tools column
    const toolCol = document.createElement('div')
    toolCol.className = 'structure-col'
    toolCol.innerHTML = '<h3>Tools</h3>'
    const toolMax = d3.max(data.tools, d => d.total_chars) || 1
    renderBarList(toolCol, data.tools, 'total_chars', toolMax, '#a78bfa')
    cols.appendChild(toolCol)

    content.appendChild(cols)

    // XML tags
    if (data.xml_tags && data.xml_tags.length > 0) {
      const tagSection = document.createElement('div')
      tagSection.className = 'xml-tags-section'
      tagSection.innerHTML = '<h3>XML Tags</h3>'
      const chips = document.createElement('div')
      chips.className = 'chips-row'
      data.xml_tags.forEach(tag => {
        const chip = document.createElement('span')
        chip.className = 'chip chip-neutral'
        chip.textContent = tag
        chips.appendChild(chip)
      })
      tagSection.appendChild(chips)
      content.appendChild(tagSection)
    }
  }

  function renderBarList(parent, items, countKey, maxVal, color) {
    const list = document.createElement('div')
    list.className = 'bar-list'

    items.forEach((item, i) => {
      const row = document.createElement('div')
      row.className = 'bar-row'

      const label = document.createElement('div')
      label.className = 'bar-label'
      label.textContent = item.title

      const barWrap = document.createElement('div')
      barWrap.className = 'bar-wrap'

      // Use D3 for the bar
      const svg = d3.select(barWrap)
        .append('svg')
        .attr('width', '100%')
        .attr('height', 8)

      const bar = svg.append('rect')
        .attr('y', 0)
        .attr('height', 8)
        .attr('rx', 4)
        .attr('fill', color)
        .attr('opacity', 0.8)
        .attr('width', 0)

      // Animate bar in after a staggered delay
      bar.transition()
        .delay(i * 40)
        .duration(500)
        .attr('width', function() {
          const parentW = barWrap.getBoundingClientRect().width || 300
          return (item[countKey] / maxVal) * parentW
        })

      // Recalculate width on resize
      row._item = item
      row._countKey = countKey
      row._maxVal = maxVal
      row._bar = bar

      row.appendChild(label)
      row.appendChild(barWrap)

      // Detail expand row
      const detail = document.createElement('div')
      detail.className = 'detail-row'
      let detailContent = `<span class="detail-stat">${item[countKey].toLocaleString()} chars</span>`
      if (item.hash) detailContent += `<span class="detail-stat">hash: <code>${item.hash.slice(0, 8)}</code></span>`
      if (countKey === 'total_chars') {
        detailContent += `<span class="detail-stat">prose: ${item.prose_chars} | schema: ${item.schema_chars}</span>`
      }
      detail.innerHTML = detailContent

      let open = false
      row.addEventListener('click', () => {
        open = !open
        detail.classList.toggle('open', open)
        row.classList.toggle('active', open)
      })

      list.appendChild(row)
      list.appendChild(detail)
    })

    parent.appendChild(list)
  }

  renderContent()

  // Handle resize to update bar widths
  let resizeTimer
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(renderContent, 200)
  })
}
