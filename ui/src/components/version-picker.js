export function createVersionPicker(container, versions, selectedVersion, onChange) {
  const select = document.createElement('select')
  select.className = 'version-select'
  select.setAttribute('aria-label', 'Version')

  versions.forEach(v => {
    const opt = document.createElement('option')
    opt.value = v
    opt.textContent = v
    if (v === selectedVersion) opt.selected = true
    select.appendChild(opt)
  })

  select.addEventListener('change', () => onChange(select.value))
  container.appendChild(select)
  return select
}
