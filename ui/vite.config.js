import { defineConfig } from 'vite'

// Deploys to https://ccprompt.feitong.phd/ (custom domain via ui/public/CNAME).
// Base stays at '/' for both dev and build because the custom domain serves
// at its own root, no repo subpath.
export default defineConfig({
  base: '/',
})
