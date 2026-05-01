import { defineConfig } from 'vite'

// Repo deploys to https://ftvision.github.io/agent-prompt-observatory/ via GH Pages.
// In dev the base path is `/`; in build we use the repo subpath so asset URLs and
// the data/ fetches all resolve correctly under the subdirectory.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/agent-prompt-observatory/' : '/',
}))
