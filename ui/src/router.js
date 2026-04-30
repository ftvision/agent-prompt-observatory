const routes = {}

export function registerRoute(hash, renderFn) {
  routes[hash] = renderFn
}

export function navigate(hash) {
  window.location.hash = hash
}

export function initRouter() {
  function dispatch() {
    const hash = window.location.hash || '#/'
    const fn = routes[hash] || routes['#/']
    if (fn) fn()
  }
  window.addEventListener('hashchange', dispatch)
  dispatch()
}
