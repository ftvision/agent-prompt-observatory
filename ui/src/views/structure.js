import * as THREE from 'three'
import { marked } from 'marked'
import { getMeta, getStructures } from '../data/loader.js'
import { createVersionPicker } from '../components/version-picker.js'

marked.setOptions({ breaks: true })

// Module-level Three.js state — cleaned up on each re-render
let _renderer = null
let _animId = null

function _cleanup() {
  if (_animId) { cancelAnimationFrame(_animId); _animId = null }
  if (_renderer) { _renderer.dispose(); _renderer = null }
}

// Stack color palettes — deep to light (bottom to top of each stack)
const PALETTES = {
  system_prompt: [0x1e3a8a, 0x1d4ed8, 0x2563eb, 0x3b82f6, 0x60a5fa, 0x93c5fd, 0xbfdbfe, 0xdbeafe],
  tools:         [0x2e1065, 0x4c1d95, 0x5b21b6, 0x6d28d9, 0x7c3aed, 0x8b5cf6, 0xa78bfa, 0xc4b5fd],
  user_message:  [0x7c2d12, 0x9a3412, 0xc2410c, 0xea580c, 0xf97316, 0xfb923c, 0xfed7aa, 0xfff7ed],
}

function _darken(hex, f) {
  return (
    (Math.round(((hex >> 16) & 0xff) * f) << 16) |
    (Math.round(((hex >> 8)  & 0xff) * f) << 8)  |
     Math.round( (hex        & 0xff) * f)
  )
}

// Bake a label texture onto a canvas — text on a solid color background
function _makeLabelTex(text, baseColor) {
  const W = 420, H = 240
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d')

  // Background fill
  const r = (baseColor >> 16) & 0xff
  const g = (baseColor >> 8)  & 0xff
  const b =  baseColor        & 0xff
  ctx.fillStyle = `rgb(${r},${g},${b})`
  ctx.fillRect(0, 0, W, H)

  // Subtle inner border
  ctx.strokeStyle = `rgba(255,255,255,0.15)`
  ctx.lineWidth = 4
  ctx.strokeRect(6, 6, W - 12, H - 12)

  // Label text
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Fit text to width
  let fontSize = 44
  ctx.font = `600 ${fontSize}px system-ui, sans-serif`
  while (ctx.measureText(text).width > W - 32 && fontSize > 14) {
    fontSize -= 2
    ctx.font = `600 ${fontSize}px system-ui, sans-serif`
  }
  ctx.fillText(text, W / 2, H / 2)

  return new THREE.CanvasTexture(c)
}

// Floating stack-title sprite above each stack
function _makeTitleSprite(text) {
  const W = 512, H = 96
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#ffffff'
  ctx.font = '700 44px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, W / 2, H / 2)
  const tex = new THREE.CanvasTexture(c)
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(5.5, 1.0, 1)
  return sprite
}

// Build one stack; push hit-testable entries into `registry`
function _buildStack(scene, stackDef, snap, registry) {
  const { id, label, x, items } = stackDef
  const palette = PALETTES[id]
  const BOX_W = 4.2, BOX_D = 2.4, GAP = 0.07
  const MAX_H = 1.6, MIN_H = 0.22

  const maxSize = Math.max(...items.map(i => i.size), 1)
  let y = 0

  items.forEach((item, idx) => {
    // Square-root scaling so large sections don't dwarf small ones
    const h = MIN_H + (MAX_H - MIN_H) * Math.sqrt(item.size / maxSize)
    const baseColor = palette[idx % palette.length]
    const tex = _makeLabelTex(item.title, baseColor)

    // Six-face material array: +x, -x, +y(top), -y, +z, -z
    const mats = [
      new THREE.MeshPhongMaterial({ color: _darken(baseColor, 0.72) }),          // right
      new THREE.MeshPhongMaterial({ color: _darken(baseColor, 0.60) }),          // left
      new THREE.MeshPhongMaterial({ map: tex, color: baseColor }),                // top ← label
      new THREE.MeshPhongMaterial({ color: _darken(baseColor, 0.35) }),          // bottom
      new THREE.MeshPhongMaterial({ color: _darken(baseColor, 0.82) }),          // front
      new THREE.MeshPhongMaterial({ color: _darken(baseColor, 0.50) }),          // back
    ]

    const geo  = new THREE.BoxGeometry(BOX_W, h, BOX_D)
    const mesh = new THREE.Mesh(geo, mats)
    mesh.position.set(x, y + h / 2, 0)
    scene.add(mesh)

    registry.push({
      mesh,
      stackLabel: label,
      item,
      baseColors: mats.map(m => m.color.getHex()),
    })

    y += h + GAP
  })

  // Floating title above the stack
  const sprite = _makeTitleSprite(label)
  sprite.position.set(x, y + 0.9, 0)
  scene.add(sprite)
}

// Slide-in detail panel (HTML overlay on top of canvas)
function _buildPanel(container) {
  const panel = document.createElement('div')
  panel.className = 'stack-panel'
  container.appendChild(panel)
  return panel
}

async function _openPanel(panel, reg, version) {
  const { item, stackLabel } = reg

  // Render skeleton immediately so the panel opens without delay
  panel.innerHTML = `
    <div class="stack-panel-head">
      <span class="stack-panel-tag">${stackLabel}</span>
      <button class="stack-panel-close">×</button>
    </div>
    <div class="stack-panel-title">${item.title}</div>
    <div class="stack-panel-meta stack-panel-loading">Loading…</div>
    <div class="stack-panel-body"></div>
  `
  panel.classList.add('open')
  panel.querySelector('.stack-panel-close').onclick = () => panel.classList.remove('open')

  // Lazily fetch the component detail for this version
  let detail = null
  try {
    const { getComponents } = await import('../data/loader.js')
    detail = await getComponents(version)
  } catch (_) {}

  const meta  = panel.querySelector('.stack-panel-meta')
  const body  = panel.querySelector('.stack-panel-body')

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
    const d = detail.sections?.[item.title]
    if (!d) { meta.textContent = `${item.size.toLocaleString()} chars`; return }
    meta.textContent = `${d.char_count?.toLocaleString() ?? item.size.toLocaleString()} chars`
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
    const body = t.md
      ? `<div class="stack-panel-md${hidden}" data-page="${i}">${marked.parse(t.content)}</div>`
      : `<pre class="stack-panel-text${hidden}" data-page="${i}">${_esc(t.content)}</pre>`
    return body
  }).join('')

  return `<div class="stack-tabs">${tabsHtml}</div>${pagesHtml}`
}

function _esc(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function renderStructure(container) {
  _cleanup()

  const [meta, structures] = await Promise.all([getMeta(), getStructures()])
  const versions = meta.versions.map(v => v.version)
  let currentVersion = versions.at(-1)

  container.innerHTML = ''
  container.style.cssText = 'position:relative; height:calc(100vh - 54px); overflow:hidden; background:#0a0a0a'

  // Canvas fills the container
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'display:block; width:100%; height:100%'
  container.appendChild(canvas)

  // Version picker overlay (top-left)
  const pickerWrap = document.createElement('div')
  pickerWrap.className = 'stack-picker-overlay'
  container.appendChild(pickerWrap)
  createVersionPicker(pickerWrap, versions, currentVersion, v => {
    currentVersion = v
    _rebuildScene(currentVersion)
  })

  // Detail panel
  const panel = _buildPanel(container)

  // ── Three.js setup ──────────────────────────────────────────────────────────
  const W = container.clientWidth  || 800
  const H = container.clientHeight || 600

  _renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  _renderer.setSize(W, H, false)
  _renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  _renderer.setClearColor(0x0a0a0a, 1)

  const scene  = new THREE.Scene()
  const aspect = W / H
  const F      = 11   // frustum half-size

  const cam = new THREE.OrthographicCamera(
    -F * aspect, F * aspect, F, -F, 0.1, 200
  )
  cam.position.set(20, 20, 20)
  cam.lookAt(0, 4, 0)

  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.45))
  const key = new THREE.DirectionalLight(0xffffff, 1.1)
  key.position.set(10, 20, 10)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0x6688cc, 0.25)
  fill.position.set(-8, 4, -6)
  scene.add(fill)

  const registry = []   // { mesh, stackLabel, item, baseColors }

  function _rebuildScene(version) {
    // Remove all existing meshes/sprites
    while (scene.children.length > 0) scene.remove(scene.children[0])
    registry.length = 0
    panel.classList.remove('open')

    // Re-add lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.45))
    const k = new THREE.DirectionalLight(0xffffff, 1.1)
    k.position.set(10, 20, 10)
    scene.add(k)
    const f2 = new THREE.DirectionalLight(0x6688cc, 0.25)
    f2.position.set(-8, 4, -6)
    scene.add(f2)

    const snap = structures[version]
    if (!snap) return

    const stacks = [
      {
        id: 'system_prompt',
        label: 'System Prompt',
        x: -6.5,
        items: snap.sections.map(s => ({
          title: s.title, size: s.char_count, type: 'section',
        })),
      },
      {
        id: 'tools',
        label: 'Tools',
        x: 0,
        items: snap.tools.map(t => ({
          title: t.title, size: t.total_chars, type: 'tool',
          prose_chars: t.prose_chars, schema_chars: t.schema_chars,
        })),
      },
      {
        id: 'user_message',
        label: 'User Message',
        x: 6.5,
        items: [
          ...(snap.xml_tags || []).map(tag => ({
            title: tag, size: 600, type: 'xml_tag',
          })),
          { title: 'actual_prompt', size: 300, type: 'actual_prompt' },
        ],
      },
    ]

    stacks.forEach(s => _buildStack(scene, s, snap, registry))
  }

  _rebuildScene(currentVersion)

  // ── Raycaster ──────────────────────────────────────────────────────────────
  const ray   = new THREE.Raycaster()
  const mouse = new THREE.Vector2()
  let hoveredReg = null

  function _pick(e) {
    const r = canvas.getBoundingClientRect()
    mouse.x = ((e.clientX - r.left) / r.width)  *  2 - 1
    mouse.y = ((e.clientY - r.top)  / r.height) * -2 + 1
    ray.setFromCamera(mouse, cam)
    const hits = ray.intersectObjects(registry.map(r => r.mesh))
    return hits.length ? registry.find(r => r.mesh === hits[0].object) : null
  }

  canvas.addEventListener('mousemove', e => {
    // Reset previous hover
    if (hoveredReg) {
      hoveredReg.mesh.material.forEach((m, i) =>
        m.color.setHex(hoveredReg.baseColors[i])
      )
    }
    hoveredReg = _pick(e)
    if (hoveredReg) {
      hoveredReg.mesh.material.forEach(m => {
        m.color.setRGB(
          Math.min(m.color.r * 1.35, 1),
          Math.min(m.color.g * 1.35, 1),
          Math.min(m.color.b * 1.35, 1),
        )
      })
      canvas.style.cursor = 'pointer'
    } else {
      canvas.style.cursor = 'default'
    }
  })

  canvas.addEventListener('click', e => {
    const hit = _pick(e)
    if (hit) _openPanel(panel, hit, currentVersion)
    else panel.classList.remove('open')
  })

  // Tab switching (delegated)
  panel.addEventListener('click', e => {
    const btn = e.target.closest('.stack-tab')
    if (!btn) return
    const idx = +btn.dataset.idx
    panel.querySelectorAll('.stack-tab').forEach((b, i) => b.classList.toggle('active', i === idx))
    panel.querySelectorAll('[data-page]').forEach(p => p.classList.toggle('hidden', +p.dataset.page !== idx))
  })

  // ── Resize ─────────────────────────────────────────────────────────────────
  const onResize = () => {
    if (!_renderer) return
    const nW = container.clientWidth
    const nH = container.clientHeight
    const nA = nW / nH
    _renderer.setSize(nW, nH, false)
    cam.left = -F * nA; cam.right = F * nA
    cam.updateProjectionMatrix()
  }
  window.addEventListener('resize', onResize)

  // ── Render loop ─────────────────────────────────────────────────────────────
  function tick() {
    _animId = requestAnimationFrame(tick)
    _renderer.render(scene, cam)
  }
  tick()
}
