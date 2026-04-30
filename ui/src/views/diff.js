import { getMeta, getStructures, getDiffs, getComponents } from '../data/loader.js'
import { createVersionPicker } from '../components/version-picker.js'

export async function renderDiff(container) {
  const [meta, structures, diffs] = await Promise.all([getMeta(), getStructures(), getDiffs()])
  const versions = meta.versions.map(v => v.version)

  let versionA = versions[0]
  let versionB = versions[versions.length - 1]

  // Controls row
  const controls = document.createElement('div')
  controls.className = 'diff-controls'

  const aWrap = document.createElement('div')
  aWrap.className = 'picker-labeled'
  aWrap.innerHTML = '<label>Version A</label>'
  createVersionPicker(aWrap, versions, versionA, v => { versionA = v })

  const bWrap = document.createElement('div')
  bWrap.className = 'picker-labeled'
  bWrap.innerHTML = '<label>Version B</label>'
  createVersionPicker(bWrap, versions, versionB, v => { versionB = v })

  const compareBtn = document.createElement('button')
  compareBtn.className = 'btn-primary'
  compareBtn.textContent = 'Compare'

  controls.appendChild(aWrap)
  controls.appendChild(bWrap)
  controls.appendChild(compareBtn)
  container.appendChild(controls)

  const result = document.createElement('div')
  result.className = 'diff-result'
  container.appendChild(result)

  compareBtn.addEventListener('click', async () => {
    result.innerHTML = '<p class="loading">Loading...</p>'
    await runComparison(versionA, versionB, result, structures, diffs)
  })
}

async function runComparison(vA, vB, result, structures, diffs) {
  // Try to load components for hash comparison; fall back gracefully
  let compA = null, compB = null
  try { compA = await import('../data/loader.js').then(m => m.getComponents(vA)) } catch {}
  try { compB = await import('../data/loader.js').then(m => m.getComponents(vB)) } catch {}

  const sA = structures[vA]
  const sB = structures[vB]

  if (!sA || !sB) {
    result.innerHTML = '<p class="error">Structure data missing for one or both versions.</p>'
    return
  }

  result.innerHTML = ''

  // Find the diff record between vA and vB if it exists
  const diffRecord = diffs.find(d => d.from === vA && d.to === vB) || buildSyntheticDiff(sA, sB)

  // Summary chips
  const summary = document.createElement('div')
  summary.className = 'diff-summary'
  summary.innerHTML = '<h3>Summary</h3>'
  const chips = document.createElement('div')
  chips.className = 'chips-row'

  const addChips = (items, cls, prefix) => {
    items.forEach(item => {
      const c = document.createElement('span')
      c.className = `chip ${cls}`
      c.textContent = `${prefix} ${item}`
      chips.appendChild(c)
    })
  }

  addChips(diffRecord.added_sections || [], 'chip-added', '+ section:')
  addChips(diffRecord.removed_sections || [], 'chip-removed', '- section:')
  if (diffRecord.reordered_sections) {
    const c = document.createElement('span')
    c.className = 'chip chip-changed'
    c.textContent = 'sections reordered'
    chips.appendChild(c)
  }
  addChips(diffRecord.added_tools || [], 'chip-added', '+ tool:')
  addChips(diffRecord.removed_tools || [], 'chip-removed', '- tool:')
  if (diffRecord.reordered_tools) {
    const c = document.createElement('span')
    c.className = 'chip chip-changed'
    c.textContent = 'tools reordered'
    chips.appendChild(c)
  }

  if (chips.children.length === 0) {
    const c = document.createElement('span')
    c.className = 'chip chip-neutral'
    c.textContent = 'No structural changes'
    chips.appendChild(c)
  }

  summary.appendChild(chips)
  result.appendChild(summary)

  // Side-by-side comparison
  const comparison = document.createElement('div')
  comparison.className = 'diff-comparison'

  const secCol = buildComparisonColumn('Sections', sA.sections, sB.sections, 'char_count',
    compA?.sections, compB?.sections)
  const toolCol = buildComparisonColumn('Tools', sA.tools, sB.tools, 'total_chars',
    compA?.tools, compB?.tools)

  comparison.appendChild(secCol)
  comparison.appendChild(toolCol)
  result.appendChild(comparison)
}

function buildSyntheticDiff(sA, sB) {
  const titlesA = new Set(sA.sections.map(s => s.title))
  const titlesB = new Set(sB.sections.map(s => s.title))
  const toolsA = new Set(sA.tools.map(t => t.title))
  const toolsB = new Set(sB.tools.map(t => t.title))

  return {
    added_sections: [...titlesB].filter(t => !titlesA.has(t)),
    removed_sections: [...titlesA].filter(t => !titlesB.has(t)),
    reordered_sections: false,
    added_tools: [...toolsB].filter(t => !toolsA.has(t)),
    removed_tools: [...toolsA].filter(t => !toolsB.has(t)),
    reordered_tools: false,
    added_xml_tags: [],
    removed_xml_tags: []
  }
}

function buildComparisonColumn(title, itemsA, itemsB, countKey, compA, compB) {
  const col = document.createElement('div')
  col.className = 'diff-col'
  col.innerHTML = `<h3>${title}</h3>`

  const mapA = new Map(itemsA.map(i => [i.title, i]))
  const mapB = new Map(itemsB.map(i => [i.title, i]))
  const allTitles = [...new Set([...mapA.keys(), ...mapB.keys()])]

  allTitles.forEach(t => {
    const inA = mapA.get(t)
    const inB = mapB.get(t)
    const row = document.createElement('div')
    row.className = 'diff-item'

    let cls = ''
    let extra = ''

    if (inA && !inB) {
      cls = 'diff-only-a'
      extra = '<span class="diff-badge">only in A</span>'
    } else if (!inA && inB) {
      cls = 'diff-only-b'
      extra = '<span class="diff-badge">only in B</span>'
    } else if (inA && inB) {
      // Try hash comparison from component data
      const hashA = compA?.[t]?.hash || compA?.[t]?.prose_hash
      const hashB = compB?.[t]?.hash || compB?.[t]?.prose_hash

      if (hashA && hashB && hashA === hashB) {
        cls = 'diff-same'
        extra = '<span class="diff-badge">unchanged</span>'
      } else {
        const delta = inB[countKey] - inA[countKey]
        const sign = delta > 0 ? '+' : ''
        cls = 'diff-changed'
        extra = `<span class="diff-badge">${sign}${delta} chars</span>`
      }
    }

    row.className = `diff-item ${cls}`
    row.innerHTML = `<span class="diff-item-title">${t}</span>${extra}`
    col.appendChild(row)
  })

  return col
}
