import * as THREE from 'three'
import { marked } from 'marked'
import { getMeta, getStructures } from '../data/loader.js'
import { createVersionPicker } from '../components/version-picker.js'

marked.setOptions({ breaks: true })

let _renderer = null
let _animId = null
let _onResize = null
let _dirty = true
let _meshes = []
const _disposables = []
let _focusedRegIdx = -1

function _cleanup() {
  if (_animId) { cancelAnimationFrame(_animId); _animId = null }
  if (_renderer) { _renderer.dispose(); _renderer = null }
  if (_onResize) { window.removeEventListener('resize', _onResize); _onResize = null }
  _disposables.forEach(d => { try { d.dispose() } catch (_e) {} })
  _disposables.length = 0
  _meshes = []
  _focusedRegIdx = -1
}

// Clean light-mode categorical palettes. Ordered mid→light; material shading
// handles face contrast, so base colors avoid the muddy low-light range.
const SECTION_COLORS = {
  user_message:  [0xc98713, 0xd99924, 0xe8ad3d, 0xf3c46a, 0xf8d998],
  system_prompt: [0x25779a, 0x2d8ab1, 0x45a0c2, 0x6bb8d4, 0x95d0e4, 0xbfe3ee],
  tools:         [0x238761, 0x2f9c73, 0x47b286, 0x6dc79f, 0x9bdcbd, 0xc5ecd8],
}

const LABEL_COLORS = {
  user_message:  '#8a5b08',
  system_prompt: '#225f7a',
  tools:         '#1f6b4d',
}

const SECTION_NAMES = {
  user_message:  'User Messages',
  system_prompt: 'System Message',
  tools:         'Tools',
}

function _darken(hex, f) {
  return (
    (Math.round(((hex >> 16) & 0xff) * f) << 16) |
    (Math.round(((hex >> 8)  & 0xff) * f) << 8)  |
     Math.round( (hex        & 0xff) * f)
  )
}

// Build the detail panel overlay
function _buildPanel(container) {
  const panel = document.createElement('div')
  panel.className = 'stack-panel'
  container.appendChild(panel)
  return panel
}

async function _openPanel(panel, reg, version) {
  const { item, stackLabel } = reg

  panel.innerHTML = `
    <div class="stack-panel-head">
      <span class="stack-panel-tag">${stackLabel}</span>
      <button class="stack-panel-close" aria-label="Close panel">×</button>
    </div>
    <div class="stack-panel-title">${item.title}</div>
    <div class="stack-panel-meta stack-panel-loading">Loading…</div>
    <div class="stack-panel-body"></div>
  `
  panel.classList.add('open')
  panel.querySelector('.stack-panel-close').onclick = () => panel.classList.remove('open')

  let detail = null
  try {
    const { getComponents } = await import('../data/loader.js')
    detail = await getComponents(version)
  } catch (_) {}

  const meta = panel.querySelector('.stack-panel-meta')
  const body = panel.querySelector('.stack-panel-body')
  meta.classList.remove('stack-panel-loading')

  if (!detail) {
    meta.textContent = `${item.size.toLocaleString()} chars`
    body.innerHTML = '<p class="stack-panel-note">No component detail available.</p>'
    return
  }

  if (item.type === 'tool') {
    const d = detail.tools?.[item.title]
    if (!d) { meta.textContent = `${item.size.toLocaleString()} chars`; return }
    meta.textContent = `prose: ${d.prose_chars?.toLocaleString() ?? '—'} · schema: ${d.schema_chars?.toLocaleString() ?? '—'} chars`
    body.innerHTML = _renderToolBody(d)
  } else if (item.type === 'section') {
    const d = detail.system_message?.[item.title]
    if (!d) { meta.textContent = `${item.size.toLocaleString()} chars`; return }
    meta.textContent = `${d.char_count?.toLocaleString() ?? item.size.toLocaleString()} chars`
    body.innerHTML = `<div class="stack-panel-md">${marked.parse(d.text ?? '')}</div>`
  } else if (item.type === 'xml_tag') {
    const key = item.lookupKey ?? item.title
    const d = detail.user_message?.[key]
    if (!d) { meta.textContent = `${item.size.toLocaleString()} chars`; return }
    meta.textContent = `${d.char_count?.toLocaleString()} chars`
    body.innerHTML = `<div class="stack-panel-md">${marked.parse(d.text ?? '')}</div>`
  } else {
    meta.textContent = `${item.size.toLocaleString()} chars`
  }
}

function _renderToolBody(d) {
  const tabs = []
  if (d.prose)  tabs.push({ label: 'Prose',  content: d.prose,  chars: d.prose_chars,  md: true })
  if (d.schema) tabs.push({ label: 'Schema', content: d.schema, chars: d.schema_chars, md: false })
  if (!tabs.length) return '<p class="stack-panel-note">No content available.</p>'

  const tabsHtml = tabs.map((t, i) =>
    `<button class="stack-tab ${i === 0 ? 'active' : ''}" data-idx="${i}">${t.label} <span class="stack-tab-count">${t.chars?.toLocaleString()}</span></button>`
  ).join('')

  const pagesHtml = tabs.map((t, i) => {
    const hidden = i === 0 ? '' : ' hidden'
    return t.md
      ? `<div class="stack-panel-md${hidden}" data-page="${i}">${marked.parse(t.content)}</div>`
      : `<pre class="stack-panel-text${hidden}" data-page="${i}">${_esc(t.content)}</pre>`
  }).join('')

  return `<div class="stack-tabs">${tabsHtml}</div>${pagesHtml}`
}

function _esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function renderStructure(container) {
  _cleanup()

  const [meta, structures] = await Promise.all([getMeta(), getStructures()])
  const versions = meta.versions.map(v => v.version)
  const structureKeys = Object.keys(structures)
  let currentVersion = versions.findLast(v => structureKeys.includes(v)) || structureKeys.at(-1) || versions.at(-1)

  container.innerHTML = ''
  container.style.cssText = 'position:relative; height:min(72vh, 760px); min-height:560px; overflow:hidden; background:oklch(97.5% 0.006 70); border-top:1px solid var(--border-subtle)'

  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'display:block; width:100%; height:100%'
  canvas.setAttribute('role', 'application')
  canvas.setAttribute('aria-label', 'Claude Code prompt structure as stacked layers. Arrow keys navigate, Enter opens detail, Escape closes.')
  canvas.setAttribute('tabindex', '0')
  container.appendChild(canvas)

  const ariaLive = document.createElement('div')
  ariaLive.setAttribute('aria-live', 'polite')
  ariaLive.setAttribute('aria-atomic', 'true')
  ariaLive.className = 'sr-only'
  container.appendChild(ariaLive)

  // HTML label overlay — positioned by projecting 3D slab edges to screen
  const labelContainer = document.createElement('div')
  labelContainer.className = 'label-container'
  container.appendChild(labelContainer)

  const pickerWrap = document.createElement('div')
  pickerWrap.className = 'stack-picker-overlay'
  container.appendChild(pickerWrap)
  createVersionPicker(pickerWrap, versions, currentVersion, v => {
    currentVersion = v
    _rebuildScene(currentVersion)
  })

  const panel = _buildPanel(container)

  const W = container.clientWidth  || 800
  const H = container.clientHeight || 600

  _renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  _renderer.setSize(W, H, false)
  _renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  _renderer.setClearColor(0xf8f5ee, 1)

  const scene  = new THREE.Scene()
  const aspect = W / H
  const F = 9

  const cam = new THREE.OrthographicCamera(-F * aspect, F * aspect, F, -F, 0.1, 200)
  // Front view: camera almost directly ahead, ~15° above horizontal.
  // lookAt shifted left so building appears right-of-center, giving labels room.
  cam.position.set(0, 10, 22)
  cam.lookAt(-1.5, 4, 0)

  // Lights — boost ambient for front view where the front face dominates
  scene.add(new THREE.AmbientLight(0xffffff, 0.90))
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.50)
  keyLight.position.set(4, 12, 20)
  scene.add(keyLight)
  const fillLight = new THREE.DirectionalLight(0xfff8f0, 0.20)
  fillLight.position.set(-6, 8, -4)
  scene.add(fillLight)

  const registry = []
  let labelDefs = []  // { el, worldPos: THREE.Vector3 }

  // Flat slab dimensions
  const BOX_W = 7.5, BOX_D = 5.5
  const GAP = 0.08         // gap between slabs within a section
  const SECT_GAP = 0.45    // extra gap between section groups
  const MAX_H = 0.60, MIN_H = 0.12

  function _rebuildScene(version) {
    _disposables.forEach(d => { try { d.dispose() } catch (_e) {} })
    _disposables.length = 0

    const toRemove = scene.children.filter(c => c.isMesh || c.isSprite)
    toRemove.forEach(c => scene.remove(c))
    registry.length = 0
    _meshes = []
    _focusedRegIdx = -1
    panel.classList.remove('open')

    // Clear labels
    while (labelContainer.firstChild) labelContainer.removeChild(labelContainer.firstChild)
    labelDefs = []

    const snap = structures[version]
    if (!snap) return

    // structures.json uses arrays for all three fields.
    // Order in the building: Tools (bottom) → System Message → User Messages (top).
    const toolsItems = (snap.tools || []).map(t => ({
      title: t.title, size: t.total_chars, type: 'tool', sectionType: 'tools',
      prose_chars: t.prose_chars, schema_chars: t.schema_chars,
    }))

    const spItems = (snap.system_message || []).map(s => ({
      title: s.title, size: s.char_count, type: 'section', sectionType: 'system_prompt',
    }))

    // user_message items carry key/kind/index. actual_prompt is always implied and appended.
    const xmlItems = (snap.user_message || []).map(tag => ({
      title: tag.index === 0 ? tag.kind : `${tag.kind} #${tag.index + 1}`,
      lookupKey: tag.key, size: tag.char_count, type: 'xml_tag', sectionType: 'user_message',
    }))
    const umItems = [
      ...xmlItems,
      { title: 'actual_prompt', lookupKey: 'actual_prompt', size: 300, type: 'xml_tag', sectionType: 'user_message' },
    ]

    const sections = [
      { type: 'tools',         items: toolsItems },
      { type: 'system_prompt', items: spItems    },
      { type: 'user_message',  items: umItems    },
    ]

    let y = 0
    let firstSection = true

    sections.forEach(section => {
      if (!firstSection) y += SECT_GAP
      firstSection = false

      const palette = SECTION_COLORS[section.type]
      const maxSize = Math.max(...section.items.map(i => i.size), 1)
      const pLen    = palette.length
      const n       = section.items.length

      // Pre-compute slab heights so we can place top-to-bottom within the section.
      const heights = section.items.map(item =>
        MIN_H + (MAX_H - MIN_H) * Math.sqrt(item.size / maxSize)
      )
      const totalSectH = heights.reduce((s, h) => s + h + GAP, -GAP)

      // yTop = world Y of the top surface of this section's first (topmost) slab.
      // We place item[0] at the top and work downward.
      let yCursor = y + totalSectH  // start at the top of the section

      section.items.forEach((item, idxInSection) => {
        const h = heights[idxInSection]
        yCursor -= h  // bottom of this slab
        const yCenterWorld = yCursor + h / 2

        // Lighter colors at top (item 0) → darker at bottom (item n-1).
        const colorIdx = Math.round((idxInSection / Math.max(n - 1, 1)) * (pLen - 1))
        const baseColor = palette[colorIdx]

        const mats = [
          new THREE.MeshPhongMaterial({ color: _darken(baseColor, 0.76) }),  // +x right
          new THREE.MeshPhongMaterial({ color: _darken(baseColor, 0.66) }),  // -x left
          new THREE.MeshPhongMaterial({ color: baseColor }),                   // +y top
          new THREE.MeshPhongMaterial({ color: _darken(baseColor, 0.48) }),  // -y bottom
          new THREE.MeshPhongMaterial({ color: _darken(baseColor, 0.86) }),  // +z front
          new THREE.MeshPhongMaterial({ color: _darken(baseColor, 0.58) }),  // -z back
        ]
        mats.forEach(m => _disposables.push(m))

        const geo = new THREE.BoxGeometry(BOX_W, h, BOX_D)
        _disposables.push(geo)

        const mesh = new THREE.Mesh(geo, mats)
        mesh.position.set(0, yCenterWorld, 0)
        scene.add(mesh)

        const regEntry = {
          mesh,
          stackLabel: SECTION_NAMES[section.type],
          item,
          baseColors: mats.map(m => m.color.getHex()),
          targetX: 0,       // lerp target for slide-out animation
          yCenterWorld,     // used by _syncLabels to track moving anchors
        }
        registry.push(regEntry)

        const labelEl = document.createElement('div')
        labelEl.className = 'layer-label'
        labelEl.textContent = item.title
        labelEl.style.color = LABEL_COLORS[section.type]
        labelEl.style.pointerEvents = 'auto'
        labelEl.style.cursor = 'pointer'

        const regIdx = registry.length - 1
        labelEl.addEventListener('click', () => _openPanel(panel, registry[regIdx], currentVersion))
        labelEl.addEventListener('mouseenter', () => {
          const r = registry[regIdx]
          if (!r) return
          r.targetX = 0.6
          r.mesh.material.forEach(m => {
            m.color.setRGB(Math.min(m.color.r * 1.22, 1), Math.min(m.color.g * 1.22, 1), Math.min(m.color.b * 1.22, 1))
          })
          _dirty = true
        })
        labelEl.addEventListener('mouseleave', () => {
          const r = registry[regIdx]
          if (!r) return
          r.targetX = 0
          r.mesh.material.forEach((m, i) => m.color.setHex(r.baseColors[i]))
          _dirty = true
        })
        labelContainer.appendChild(labelEl)

        // reg reference lets _syncLabels read mesh.position.x as the slab slides.
        labelDefs.push({ el: labelEl, reg: regEntry })

        yCursor -= GAP
      })

      y += totalSectH
    })

    _meshes = registry.map(r => r.mesh)
    _dirty = true
  }

  // Labels are fixed to the base slab position (not the animated x).
  // xAnchor uses z=BOX_D/2 (front-left corner) for screen-X boundary.
  // yAnchor uses z=0 (slab center depth) for accurate screen-Y in the nearly-horizontal camera.
  const _vx = new THREE.Vector3()
  const _vy = new THREE.Vector3()
  function _syncLabels() {
    const cW = canvas.offsetWidth
    const cH = canvas.offsetHeight
    if (cW === 0 || cH === 0) return

    labelDefs.forEach(({ el, reg }) => {
      const y = reg.yCenterWorld
      _vx.set(-BOX_W / 2, y, BOX_D / 2).project(cam)
      _vy.set(-BOX_W / 2, y, 0).project(cam)
      const sx = Math.round((_vx.x + 1) / 2 * cW)
      const sy = Math.round((-_vy.y + 1) / 2 * cH)
      el.style.left      = '0'
      el.style.width     = `${Math.max(sx - 8, 40)}px`
      el.style.top       = `${sy}px`
      el.style.transform = 'translateY(-50%)'
      el.style.textAlign = 'right'
    })
  }

  _rebuildScene(currentVersion)

  const ray   = new THREE.Raycaster()
  const mouse = new THREE.Vector2()
  let hoveredReg = null

  function _pick(clientX, clientY) {
    const rect = canvas.getBoundingClientRect()
    mouse.x = ((clientX - rect.left) / rect.width)  *  2 - 1
    mouse.y = ((clientY - rect.top)  / rect.height) * -2 + 1
    ray.setFromCamera(mouse, cam)
    const hits = ray.intersectObjects(_meshes)
    return hits.length ? registry.find(e => e.mesh === hits[0].object) : null
  }

  canvas.addEventListener('mousemove', e => {
    if (hoveredReg) {
      hoveredReg.targetX = 0
      hoveredReg.mesh.material.forEach((m, i) => m.color.setHex(hoveredReg.baseColors[i]))
    }
    hoveredReg = _pick(e.clientX, e.clientY)
    if (hoveredReg) {
      hoveredReg.targetX = 0.6
      hoveredReg.mesh.material.forEach(m => {
        m.color.setRGB(Math.min(m.color.r * 1.22, 1), Math.min(m.color.g * 1.22, 1), Math.min(m.color.b * 1.22, 1))
      })
      canvas.style.cursor = 'pointer'
    } else {
      canvas.style.cursor = 'default'
    }
    _dirty = true
  })

  canvas.addEventListener('click', e => {
    const hit = _pick(e.clientX, e.clientY)
    if (hit) _openPanel(panel, hit, currentVersion)
    else panel.classList.remove('open')
  })

  canvas.addEventListener('touchend', e => {
    e.preventDefault()
    const touch = e.changedTouches[0]
    if (!touch) return
    const hit = _pick(touch.clientX, touch.clientY)
    if (hit) _openPanel(panel, hit, currentVersion)
    else panel.classList.remove('open')
  }, { passive: false })

  canvas.addEventListener('keydown', e => {
    if (!registry.length) return
    const navKeys = ['ArrowUp', 'ArrowDown', 'Enter', 'Escape']
    if (!navKeys.includes(e.key)) return
    e.preventDefault()

    if (e.key === 'Escape') { panel.classList.remove('open'); return }
    if (e.key === 'Enter') {
      if (_focusedRegIdx >= 0) _openPanel(panel, registry[_focusedRegIdx], currentVersion)
      return
    }

    const prevIdx = _focusedRegIdx
    if (e.key === 'ArrowDown') {
      _focusedRegIdx = _focusedRegIdx < registry.length - 1 ? _focusedRegIdx + 1 : 0
    } else {
      _focusedRegIdx = _focusedRegIdx > 0 ? _focusedRegIdx - 1 : registry.length - 1
    }

    if (prevIdx >= 0 && registry[prevIdx]) {
      const prev = registry[prevIdx]
      prev.mesh.material.forEach((m, i) => m.color.setHex(prev.baseColors[i]))
    }
    const focused = registry[_focusedRegIdx]
    if (focused) {
      focused.mesh.material.forEach(m => {
        m.color.setRGB(Math.min(m.color.r * 1.22, 1), Math.min(m.color.g * 1.22, 1), Math.min(m.color.b * 1.22, 1))
      })
      ariaLive.textContent = `${focused.stackLabel}: ${focused.item.title}, ${focused.item.size.toLocaleString()} chars`
    }
    _dirty = true
  })

  panel.addEventListener('click', e => {
    const btn = e.target.closest('.stack-tab')
    if (!btn) return
    const idx = +btn.dataset.idx
    panel.querySelectorAll('.stack-tab').forEach((b, i) => b.classList.toggle('active', i === idx))
    panel.querySelectorAll('[data-page]').forEach(p => p.classList.toggle('hidden', +p.dataset.page !== idx))
  })

  _onResize = () => {
    if (!_renderer) return
    const nW = container.clientWidth
    const nH = container.clientHeight
    const nA = nW / nH
    _renderer.setSize(nW, nH, false)
    cam.left = -F * nA; cam.right = F * nA
    cam.updateProjectionMatrix()
    _dirty = true
  }
  window.addEventListener('resize', _onResize)

  function tick() {
    _animId = requestAnimationFrame(tick)
    // Lerp each slab toward its targetX; keep rendering until all settle.
    let animating = false
    registry.forEach(r => {
      const dx = r.targetX - r.mesh.position.x
      if (Math.abs(dx) > 0.001) {
        r.mesh.position.x += dx * 0.18
        animating = true
      } else if (dx !== 0) {
        r.mesh.position.x = r.targetX
      }
    })
    if (!_dirty && !animating) return
    _dirty = false
    _renderer.render(scene, cam)
    _syncLabels()
  }
  tick()
}
