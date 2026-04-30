# claude-code-analyzer

Structured snapshot analyzer for Claude Code prompt captures. Parses raw markdown version files into a structured component tree and runs structural diagnostics across versions.

## Setup

```bash
cd claude-code-analyzer
uv sync
```

## CLI

The `cca` command is the main entry point.

### `cca diagnose`

Parse all version files in a directory and report structural changes across versions.

```bash
uv run cca diagnose ../data/raw
```

**Options**

| Flag | Description |
|---|---|
| `--only-changes` | Skip versions with no structural changes (cleaner output) |
| `--since VERSION` | Only show changes from a specific version onward |
| `--no-summary` | Omit the XML tags / sections / tools summary tables |

**Examples**

```bash
# Show all structural changes, concise
uv run cca diagnose ../data/raw --only-changes

# Show what changed since 2.1.33
uv run cca diagnose ../data/raw --only-changes --since 2.1.33

# Just the structural events, no summary tables
uv run cca diagnose ../data/raw --only-changes --no-summary
```

**What it reports**

*Structural changes* (compared version-to-version):

```
2.1.33:
  [system_prompt] +section: System, Executing actions with care, Using your tools, auto memory, Environment
  [system_prompt] -section: Task Management, Code References, Professional objectivity

2.1.69:
  [user_message] +xml_tag: available_deferred_tools
  [user_message] -xml_tag: system_reminder
  [tools] +tool: ToolSearch
  [tools] -tool: Agent, Bash, Edit, …
```

*Parse warnings* — only on first occurrence (e.g. a tool gains or loses a JSON schema).

*Summary tables* — each XML tag, system prompt section, and tool with `first_seen`, `last_seen`, and how many versions it appears in:

```
=== TOOLS ===
  Bash         first=1.0.0   last=2.1.77   257/261 versions (98%)
  ToolSearch   first=2.1.69  last=2.1.77     9/261 versions  (3%)
```

## Python API

```python
from claude_code_analyzer import parse_snapshot

snap = parse_snapshot("data/raw/2.1.49.md")

snap.version           # "2.1.49"
snap.release_date      # "2026-02-19"
snap.manifest.tools    # ["AskUserQuestion", "Bash", "Edit", …]
snap.manifest.system_prompt_sections  # ["System", "Doing tasks", …]
snap.diagnostics       # list of Diagnostic(level, code, message, line)

# Component tree
um = snap.components["user_message"]
sp = snap.components["system_prompt"]
tc = snap.components["tools"]

# Each component has: id, kind, title, path, raw, normalized, hash,
#                     line_start, line_end, children
bash = tc.children["tools/Bash"]
bash.children["tools/Bash/prose"].raw
bash.children["tools/Bash/schema"].raw   # JSON schema text
```

## Package layout

```
src/claude_code_analyzer/
├── models.py                  # shared dataclasses (Snapshot, Component, …)
├── snapshot.py                # parse_snapshot() — top-level entry point
├── diagnose.py                # structural diff and timeline logic
├── cli.py                     # cca CLI
└── parsers/
    ├── markdown.py            # Layer 1: XML-aware markdown parser
    ├── structural.py          # Layer 2: maps headings to user_message / system_prompt / tools
    └── extractors/
        ├── user_message.py    # XML tag children + actual_prompt
        ├── system_prompt.py   # recursive section tree
        └── tools.py           # prose / schema / subsection split per tool
```

## Running tests

```bash
uv run pytest
```
