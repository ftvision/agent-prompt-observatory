# Claude Code Prompt Observatory

[![Refresh](https://github.com/ftvision/claude-system-evolution/actions/workflows/update-data.yml/badge.svg)](https://github.com/ftvision/claude-system-evolution/actions/workflows/update-data.yml)
[![Deploy](https://github.com/ftvision/claude-system-evolution/actions/workflows/deploy.yml/badge.svg)](https://github.com/ftvision/claude-system-evolution/actions/workflows/deploy.yml)

Live: <https://ftvision.github.io/claude-system-evolution/>

This repository contains a small static web UI for exploring how Claude Code system prompts evolve across the latest five available releases.

## What it does

The analyzer pulls prompt markdown from `cchistory.mariozechner.at`, parses the prompt into:

- top-level sections
- subsection paths
- unit-level text fragments

It then computes:

- pairwise diffs between consecutive versions
- N-back diffs inside the same five-version window
- anchor diffs from the oldest version in the window to the newest
- stable subsection paths that persist through the full window
- exact persistent units that survive across versions

The UI renders those results as a compact exploratory surface rather than a raw unified diff.

## Design goals

### 1. Favor semantic labels over parser jargon

Internally the parser works with markdown heading levels, but the UI avoids showing `H1` and `H2`.

- `H1` is presented as a `top-level section`
- `H2` is presented as a `subsection` or `subsection path`
- diffs are described as `subsection drift` and `shared subsection drift`

The point is to make the interface read like an analysis tool, not like a markdown parser.

### 2. Show structure before text churn

Most prompt evolution is easier to understand structurally first.

The page therefore starts with:

- version snapshot cards
- an N-back matrix
- stable subsection paths

Only after that does it show:

- pairwise transition details
- unit-level samples inside changed shared sections
- persistent exact-line motifs

This ordering helps distinguish real policy/tooling changes from low-value textual noise.

### 3. Keep the UI static and dependency-free

The app is plain HTML, CSS, and JavaScript:

- `index.html`
- `styles.css`
- `app.js`

There is no framework, build step, or package manager requirement. A simple local HTTP server is enough.

That keeps iteration cheap and makes the data artifacts easy to inspect directly.

### 4. Make the five-version window feel editorial, not dashboard-generic

The visual language is intentionally warm and print-like:

- parchment background
- serif display type
- monospaced metadata accents
- large cards and subsection chips

The goal is to make prompt history feel like a narrative artifact rather than a generic analytics screen.

## Data flow

### Analyzer

`analyze_prompts.py` fetches the latest five prompt versions and writes:

- `.context/latest5-prototype/analysis.json`
- `.context/latest5-prototype/parsed_versions.json`
- `.context/latest5-prototype/summary.md`

`analysis.json` contains the compact view model for the UI:

- `versions`
- `pairwise_diffs`
- `n_back_diffs`
- `anchor_diff`
- `section_presence`
- `global_duplicates`

`parsed_versions.json` contains the richer section tree used by the version browser.

### UI

The page loads both JSON files client-side and renders:

1. Overview metrics
2. Version snapshot cards
3. N-back matrix
4. Stable subsection paths
5. Pairwise transition inspector
6. Version section browser
7. Persistent exact-line motifs

## Noise handling

The analyzer normalizes a few runtime-specific values so the UI is not dominated by session artifacts:

- temporary working directories under `/tmp/claude-history-*`
- auto-memory project directories under `/root/.claude/projects/*/memory/`

It also excludes the synthetic `User Message / currentDate` section from shared-section churn so the UI highlights prompt evolution rather than per-run timestamps.

## Current limitations

- The motif detector currently surfaces exact persistent units, not fuzzy paraphrase clusters.
- The parser treats heading structure literally; it does not yet infer section renames or semantic moves.
- Cross-section reuse is not yet modeled as a lineage graph.
- The UI is scoped to the latest five versions, not an arbitrary history range.

These are deliberate tradeoffs for the first usable prototype.

## Run it

Regenerate the latest-five analysis:

```bash
python3 analyze_prompts.py
```

Serve the repository root:

```bash
python3 -m http.server 4173
```

Open:

```text
http://127.0.0.1:4173/
```

## File map

- `analyze_prompts.py`: fetch, parse, normalize, diff, and write analysis artifacts
- `index.html`: page structure
- `styles.css`: visual system and layout
- `app.js`: data loading and UI rendering
- `.context/latest5-prototype/*`: generated analysis outputs
