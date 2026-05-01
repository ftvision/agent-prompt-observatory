#!/usr/bin/env node
// Carve a `latest.json` out of structures.json so the Structure view's first
// paint only fetches ~500 bytes of data instead of waiting for the 816 KB
// full corpus that Evolution needs. Runs before `vite build` (and before
// `vite dev`, via package.json scripts).

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', 'public', 'data')
const structuresPath = join(dataDir, 'structures.json')
const metaPath = join(dataDir, 'meta.json')
const outPath = join(dataDir, 'latest.json')

if (!existsSync(structuresPath)) {
  console.warn(`[build-latest] ${structuresPath} not found, skipping`)
  process.exit(0)
}

const structures = JSON.parse(readFileSync(structuresPath, 'utf8'))
const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : null

const latestVer = meta?.versions?.at(-1)?.version
  ?? Object.keys(structures).at(-1)

if (!latestVer || !structures[latestVer]) {
  console.error(`[build-latest] could not resolve latest version`)
  process.exit(1)
}

writeFileSync(outPath, JSON.stringify({
  version: latestVer,
  structure: structures[latestVer],
}))
console.log(`[build-latest] wrote ${outPath} for ${latestVer}`)
