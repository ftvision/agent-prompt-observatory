const cache = new Map()

async function fetchJSON(path) {
  if (cache.has(path)) return cache.get(path)
  const res = await fetch(path)
  const data = await res.json()
  cache.set(path, data)
  return data
}

export const getMeta = () => fetchJSON('/data/meta.json')
export const getStructures = () => fetchJSON('/data/structures.json')
export const getDiffs = () => fetchJSON('/data/diffs.json')
export const getComponents = (version) => fetchJSON(`/data/components/${version}.json`)
