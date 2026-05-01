# Claude Code Prompt Observatory

[![Refresh](https://github.com/ftvision/agent-prompt-observatory/actions/workflows/update-data.yml/badge.svg)](https://github.com/ftvision/agent-prompt-observatory/actions/workflows/update-data.yml)
[![Deploy](https://github.com/ftvision/agent-prompt-observatory/actions/workflows/deploy.yml/badge.svg)](https://github.com/ftvision/agent-prompt-observatory/actions/workflows/deploy.yml)

Live: <https://ccprompt.feitong.phd/>

A research interface for exploring how Claude Code's system prompt has evolved across all 289 published versions (1.0.0 → 2.1.112). Prompt captures come from [cchistory.mariozechner.at](https://cchistory.mariozechner.at/); a Python analyzer parses them into a structured model, and a Vite static UI renders that model as two views.

## Views

**Structure** — single-version inspector. The current prompt rendered as a 3D layered model: User Prompt slabs at the top, System Prompt sections in the middle, Tools at the bottom. Click any slab to read its prose / schema / metadata in the side panel.

**Evolution** — temporal stream graph across the entire 289-version range. Each row is a component (User Message total, System Prompt sections, every individual tool); the bar at each version's column has height proportional to character count. Empty cells mark releases where a section was absent. A model-release axis above the version axis labels Claude 4 → 4.7 launches with vertical guides threading through the matrix, so you can see when prompt changes correlate with model releases. Click any component name to expand a change-log timeline below it; click any change-log entry to see the line-level diff of that version against its predecessor.

## Project layout

```
claude-code-analyzer/    Python package + `cca` CLI (parser, exporter, tests)
data/raw/                Captured *.md prompt files, one per version
data/versions_meta.json  {version, release_date} index for the corpus
ui/                      Vite app (single-page, no framework)
  src/views/             structure.js / evolution.js + per-view CSS
  src/components/        version-picker
  src/data/loader.js     fetch wrapper for ui/public/data/*
  public/data/           JSON output the UI reads at runtime
scripts/fetch_versions.py    pulls new captures from upstream
.github/workflows/
  update-data.yml        cron: fetch + re-export + commit
  deploy.yml             on push: vite build + GitHub Pages deploy
```

## Data flow

Two stages, both fully scripted:

1. `scripts/fetch_versions.py` polls the upstream `versions.json`, downloads any new `.md` captures into `data/raw/`, and updates `data/versions_meta.json`.
2. `cca export data/raw --output-dir ui/public/data` parses each capture into structured components (system_message sections including the prompt preamble, tools with prose+schema, user_message xml_tags) and writes:
   - `meta.json` — version index with release dates
   - `structures.json` — per-version skeletons (titles + char_counts, no prose)
   - `components/{version}.json` — full prose/schema text per component, used for inline diffs
   - `diffs.json` — pairwise structural deltas

The UI loads `meta.json` + `structures.json` upfront, then fetches `components/{version}.json` lazily when the user opens a diff.

## Continuous update + deploy

`.github/workflows/update-data.yml` runs daily at 06:00 UTC:

1. Runs `fetch_versions.py` to pick up new upstream captures.
2. Runs `cca export` so `ui/public/data/` reflects the new corpus.
3. If anything changed, commits `data/` + `ui/public/data/` to master and pushes.

The push triggers `.github/workflows/deploy.yml`, which runs `npm ci && npm run build` in `ui/` and publishes `ui/dist/` to GitHub Pages via `actions/deploy-pages`.

End-to-end, a new upstream version becomes a deployed page update with no human in the loop.

## Run locally

Need: Node 20+, Python 3.11+, [uv](https://docs.astral.sh/uv/).

**Pull the data:**

```bash
uv run python scripts/fetch_versions.py
```

**Generate the UI's structured data:**

```bash
cd claude-code-analyzer
uv sync
uv run cca export ../data/raw --output-dir ../ui/public/data
```

**Run the UI:**

```bash
cd ui
npm install
npm run dev          # opens http://localhost:5173/
```

For a production-style preview:

```bash
npm run build && npm run preview
```

**Run the analyzer tests:**

```bash
cd claude-code-analyzer
uv run pytest
```

## Architecture notes

- **No framework.** The UI is plain JS, CSS, and HTML wired together with Vite. ~1200 lines of view code.
- **OKLCH everywhere.** Color tokens (`--viz-user`, `--viz-system`, `--viz-tools`) drive both the 3D slabs in Structure and the bars in Evolution; one source of truth.
- **The diff is line-level LCS** with a fallback to a linear naive diff above 2M cells, so a pathological 5000-line schema diff can't lock the tab.
- **Hardened error paths.** Both top-level data load and individual section render failures show recovery UI with retry, not a blank screen.
- **Forced-colors mode preserves the data viz** by opting bars + legend swatches out of color forcing while still adopting `Highlight` / `Mark` system colors for selection states.

## Credit

Prompt captures: [cchistory.mariozechner.at](https://cchistory.mariozechner.at/) — without that archive this project would have nothing to look at.
