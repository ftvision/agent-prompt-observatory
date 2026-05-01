const BASE = import.meta.env.BASE_URL

// Cache the in-flight promise (not just the resolved value) so two callers
// racing for the same path share one fetch. Without this, Structure and
// Evolution mounting in parallel each issue their own request for
// structures.json on cold load.
const cache = new Map()

function fetchJSON(path) {
  let entry = cache.get(path)
  if (entry) return entry
  entry = fetch(BASE + path).then(res => {
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`)
    return res.json()
  }).catch(err => {
    cache.delete(path)
    throw err
  })
  cache.set(path, entry)
  return entry
}

export const getMeta = () => fetchJSON('data/meta.json')
export const getStructures = () => fetchJSON('data/structures.json')
export const getDiffs = () => fetchJSON('data/diffs.json')
export const getComponents = (version) => fetchJSON(`data/components/${version}.json`)

// Slim file containing only the latest version's structure. Used by the
// Structure view's first paint so we don't block on the 816 KB structures.json
// (which only Evolution actually needs all of).
export const getLatestStructure = () => fetchJSON('data/latest.json')
