# Structured Component Analyzer Plan

## Goal

Build a Claude Code prompt analyzer that records each version as a structured snapshot and supports online queries for diffs, component lifetimes, and structure changes.

This analyzer should be purpose-built for Claude Code prompt captures, not a general prompt-drift classifier. The primary structure is:

```text
version
├─ user_message
├─ system_prompt
└─ tools
```

The analyzer should preserve raw text, produce stable component IDs and hashes, and keep unrecognized content instead of dropping it.

## Design Principles

1. Parse by real Claude Code structure.
   The main components are `User Message`, `System Prompt`, and `Tools`.

2. Separate parsing from interpretation.
   The parser should identify regions and components. Higher-level code can decide how to compare, render, or summarize them.

3. Store per-version snapshots, not precomputed pairwise diffs.
   Diffs should be computed online from indexed snapshots.

4. Treat unknown structure as data.
   If a future version adds or changes headings, schemas, or nesting, the analyzer should emit diagnostics and preserve the raw region.

5. Make soft assumptions recoverable.
   Expected headings and formats should guide extraction, but failures should not break parsing.

## Snapshot Model

Each raw markdown file should produce one structured snapshot.

```json
{
  "version": "2.1.49",
  "release_date": "2026-02-19",
  "source": "data/raw/2.1.49.md",
  "manifest": {},
  "components": {},
  "diagnostics": []
}
```

The three top-level components are mandatory in the model, even if a source file is missing one of them.

```json
{
  "components": {
    "user_message": {},
    "system_prompt": {},
    "tools": {}
  }
}
```

Each component should include:

```json
{
  "id": "tools/Bash/schema",
  "kind": "tool_schema",
  "title": "Bash",
  "path": ["Tools", "Bash", "schema"],
  "raw": "...",
  "normalized": "...",
  "hash": "...",
  "line_start": 282,
  "line_end": 446,
  "children": {}
}
```

## Component IDs

Use stable path-like component IDs:

```text
user_message
user_message/system_reminders/0
user_message/system_reminders/1
user_message/actual_prompt

system_prompt
system_prompt/System
system_prompt/Doing tasks
system_prompt/Executing actions with care
system_prompt/Using your tools
system_prompt/Tone and style
system_prompt/auto memory
system_prompt/Environment

tools
tools/Bash
tools/Bash/prose
tools/Bash/schema
tools/Bash/subsections/Committing changes with git
tools/Bash/subsections/Creating pull requests
tools/Edit
tools/Edit/schema
```

IDs should prefer structural paths. For renamed or moved components, later online matching can use title similarity, content fingerprints, and parent context.

## Parser Layers

### 1. Markdown Block Parser

This layer is generic and should only know markdown structure.

Responsibilities:

- Scan for XML-like tag boundaries (`<tag>` ... `</tag>`) before processing headings.
- Treat any markdown heading found inside an XML tag span as belonging to that tag's content, not to the outer heading tree.
- Read headings and heading levels outside XML tag spans.
- Preserve line ranges.
- Preserve raw body text.
- Build a heading tree.
- Record content outside headings.

XML tags take precedence over heading detection. A `## heading` inside a `<system-reminder>` block is part of the system-reminder node, not a sibling heading in the parent tree.

Output: a markdown region tree where XML tag spans are opaque leaf nodes.

### 2. Claude Code Structural Parser

This layer maps known top-level headings into the three-component model.

Recognized top-level headings:

- `User Message`
- `System Prompt`
- `Tools`

The version title and release date are metadata, not components.

Unknown top-level headings should become components under:

```text
unknown/top_level/<heading>
```

### 3. Component Extractors

Extractors operate inside known components.

`user_message` extractor:

- Preserve full raw block.
- Extract `<system-reminder>` XML tag nodes as individual blocks (there may be more than one; each gets its own component entry).
- Extract named context blocks (such as `## currentDate`) from within their containing XML tag node, not from the outer heading tree.
- Extract the remaining actual user prompt (text outside all XML tag spans).

`system_prompt` extractor:

- Preserve full raw block.
- Treat `##` sections under `System Prompt` as child components.
- Preserve deeper headings as nested children.

`tools` extractor:

- Preserve full raw block.
- Treat each `##` under `Tools` as a tool component.
- Split each tool into prose, schema, and subsections.
- The schema is the last contiguous JSON block at the end of the tool section (before the next `##` heading). Everything before it is prose and subsections.
- Parse the schema JSON structurally when possible.
- Preserve schema text even if JSON parsing fails.

### 4. Diagnostics

Diagnostics should report surprises without stopping the pipeline.

Examples:

```json
{
  "level": "warning",
  "code": "unknown_top_level_heading",
  "message": "Unexpected top-level heading: Runtime Policies",
  "line": 151
}
```

Useful diagnostic codes:

- `missing_top_level_component`
- `unknown_top_level_heading`
- `content_outside_known_component`
- `unexpected_heading_depth`
- `tool_without_schema`
- `tool_schema_parse_failed`
- `duplicate_tool_name`
- `system_prompt_section_renamed_candidate`

## Manifest

Each snapshot should include a structural manifest for quick structure comparison.

```json
{
  "top_level_headings": ["User Message", "System Prompt", "Tools"],
  "system_prompt_sections": [
    "System",
    "Doing tasks",
    "Executing actions with care",
    "Using your tools",
    "Tone and style",
    "auto memory",
    "Environment"
  ],
  "tools": [
    "AskUserQuestion",
    "Bash",
    "Edit",
    "EnterPlanMode"
  ],
  "unknown_top_level_headings": [],
  "diagnostic_count": 0
}
```

Online structure queries can compare manifests across versions.

## Normalization

Store both raw and normalized text.

Normalization should be conservative:

- Normalize line endings.
- Trim trailing whitespace.
- Collapse volatile session paths.
- Canonicalize parsed JSON schemas.
- Preserve markdown structure.

Do not normalize away meaningful wording, headings, ordering, or examples.

Potential volatile patterns:

```text
/tmp/claude-history-<session>
/root/.claude/projects/<project>/memory/
currentDate blocks
primary working directory
```

The caller should be able to choose whether volatile fields participate in hashes.

## Indexes

Generate per-version snapshots and global indexes.

```text
data/structured/
├─ versions/
│  ├─ 2.1.49.json
│  └─ ...
└─ indexes/
   ├─ components.json
   ├─ manifests.json
   ├─ tools.json
   └─ versions.json
```

### components.json

Maps component IDs to appearances.

```json
{
  "tools/Bash/schema": {
    "appearances": [
      {
        "version": "2.1.49",
        "hash": "...",
        "line_start": 282,
        "line_end": 446
      }
    ]
  }
}
```

### manifests.json

Stores each version manifest for structure-change queries.

### tools.json

Stores tool timelines:

```json
{
  "Bash": {
    "first_seen": "2.1.1",
    "last_seen": "2.1.49",
    "versions": ["..."],
    "schema_hashes": ["..."],
    "prose_hashes": ["..."]
  }
}
```

## Online Queries

The system should compute diffs and lifetimes on demand.

Useful commands or API functions:

```text
show-version 2.1.49
show-component 2.1.49 tools/Bash/schema
diff 2.1.48 2.1.49
diff 2.1.48 2.1.49 --component tools/Bash
lifetime tools/Bash/schema
changes --component system_prompt/Using your tools
tools-timeline
structure-changes
```

## Online Diff Behavior

A diff request should:

1. Load two version snapshots.
2. Select all components or a requested component subtree.
3. Compare component inventories.
4. Compare hashes for matching component IDs.
5. Render text diffs for changed raw or normalized text.
6. Render structural diffs for parsed schemas.

Diff result categories:

```text
added
removed
unchanged
changed_text
changed_schema
renamed_or_moved_candidate
unknown
```

## Component Lifetime Behavior

A lifetime request should scan the component index and return:

```text
component_id
first_seen
last_seen
versions_present
versions_changed
distinct_hashes
possible_renames_or_moves
```

For exact component IDs, use direct index lookup.

For renamed or moved candidates, use:

- same normalized hash
- high title similarity
- same kind
- nearby parent path
- schema shape similarity for tools

## Future Structure Change Detection

The analyzer should detect future structural changes through manifest and diagnostic comparisons.

Examples:

- A new top-level heading appears.
- `Tools` is renamed or split.
- Tool sections move from `##` to `###`.
- A tool no longer has a JSON schema.
- A new schema format appears.
- Content appears between top-level sections.
- System prompt sections are reordered, renamed, added, or removed.

These should be queryable:

```text
structure-changes
structure-changes --since 2.1.40
structure-changes --component tools
```

## Relationship To Existing Analyzer

The current `analyzer/` pipeline is broader than this plan. It includes unit-level parsing, layer classification, fuzzy matching, lineage construction, cross references, stability, and genome metrics.

This new analyzer should reuse only the parts that fit:

- Markdown heading parsing ideas.
- Normalization rules.
- Stable hashing.
- Source line or character offsets.

It should avoid these concepts in the first pass:

- Functional layer classification.
- Policy tightening or relaxation classification.
- Sentence-level units as primary data.
- Precomputed pairwise transitions.
- Genome-level aggregate metrics.

Those can be added later as optional analysis layers on top of structured snapshots.

## Implementation Phases

### Phase 1: Snapshot Parser

- Parse raw markdown into heading regions.
- Extract version and release date.
- Build `user_message`, `system_prompt`, and `tools`.
- Preserve unknown headings.
- Emit diagnostics.
- Write `data/structured/versions/<version>.json`.

### Phase 2: Component Index

- Walk all snapshots.
- Build `components.json`, `manifests.json`, `tools.json`, and `versions.json`.
- Store hashes and line ranges.

### Phase 3: Online Query CLI

- Add commands for version display, component display, component lifetime, and online diff.
- Start with JSON output.
- Add readable markdown output after behavior stabilizes.

### Phase 4: Schema-Aware Tool Diff

- Parse tool schemas as JSON when possible.
- Canonicalize schema JSON.
- Show structural schema diffs separately from prose diffs.

### Phase 5: Rename And Move Candidates

- Add optional matching for renamed or moved components.
- Use same-hash, same-kind, title similarity, and parent-context signals.
- Keep candidate matching explainable.

## Open Questions

1. ~~Should `currentDate` and environment blocks be excluded from default hashes?~~ Resolved: volatile fields are excluded from hashes by default and included only in raw storage. The caller can opt in to hash-volatile behavior.
2. Should tool schemas be required, or only expected?
3. Should online diffs default to raw text or normalized text?
4. Should unknown components appear in normal views by default, or only in diagnostics?
5. Should the new implementation live inside `analyzer/` or under a separate package for the Claude Code-specific analyzer?
