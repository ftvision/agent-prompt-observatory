"""Tests for snapshot.py — the top-level coordinator."""

from __future__ import annotations

import os
import tempfile

import pytest

from claude_code_analyzer.models import Component, Manifest, Snapshot
from claude_code_analyzer.snapshot import build_manifest, parse_snapshot
from claude_code_analyzer.parsers import parse_markdown, parse_structural


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_REAL_FILE = os.path.normpath(
    os.path.join(
        os.path.dirname(__file__),
        "..", "..", "data", "raw", "2.1.49.md",
    )
)

# Minimal valid markdown that exercises all three top-level components.
_MINIMAL_MD = """\
# Claude Code Version 1.2.3

Release Date: 2025-01-01

# User Message

Hello world.

# System Prompt

You are an assistant.

## Getting started

Read the docs.

## Doing tasks

Do the work.

# Tools

## Bash

Run shell commands.

{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "command": {"type": "string"}
  }
}
"""


# ---------------------------------------------------------------------------
# Integration test — real file
# ---------------------------------------------------------------------------

class TestIntegrationRealFile:
    """Parse the real 2.1.49.md snapshot and validate key assertions."""

    @pytest.fixture(scope="class")
    def snapshot(self):
        return parse_snapshot(_REAL_FILE)

    def test_version(self, snapshot):
        assert snapshot.version == "2.1.49"

    def test_release_date(self, snapshot):
        assert snapshot.release_date == "2026-02-19"

    def test_user_message_in_components(self, snapshot):
        assert "user_message" in snapshot.components

    def test_system_prompt_in_components(self, snapshot):
        assert "system_prompt" in snapshot.components

    def test_tools_in_components(self, snapshot):
        assert "tools" in snapshot.components

    def test_bash_in_manifest_tools(self, snapshot):
        assert "Bash" in snapshot.manifest.tools

    def test_doing_tasks_in_system_prompt_sections(self, snapshot):
        assert "Doing tasks" in snapshot.manifest.system_prompt_sections

    def test_diagnostic_count_matches_diagnostics(self, snapshot):
        assert snapshot.manifest.diagnostic_count == len(snapshot.diagnostics)

    def test_snapshot_type(self, snapshot):
        assert isinstance(snapshot, Snapshot)

    def test_manifest_type(self, snapshot):
        assert isinstance(snapshot.manifest, Manifest)

    def test_source_is_path(self, snapshot):
        assert snapshot.source == _REAL_FILE


# ---------------------------------------------------------------------------
# Unit tests — minimal in-memory markdown (no disk I/O)
# ---------------------------------------------------------------------------

@pytest.fixture
def minimal_snapshot(tmp_path):
    """Write the minimal markdown to a temp file and parse it."""
    md_file = tmp_path / "test_snapshot.md"
    md_file.write_text(_MINIMAL_MD, encoding="utf-8")
    return parse_snapshot(str(md_file))


class TestMinimalSnapshot:
    """Unit tests using the small in-memory markdown fixture."""

    def test_version_extracted(self, minimal_snapshot):
        assert minimal_snapshot.version == "1.2.3"

    def test_release_date_extracted(self, minimal_snapshot):
        assert minimal_snapshot.release_date == "2025-01-01"

    def test_all_three_components_present(self, minimal_snapshot):
        assert "user_message" in minimal_snapshot.components
        assert "system_prompt" in minimal_snapshot.components
        assert "tools" in minimal_snapshot.components

    def test_no_missing_component_diagnostics(self, minimal_snapshot):
        missing = [
            d for d in minimal_snapshot.diagnostics
            if d.code == "missing_top_level_component"
        ]
        assert missing == []

    def test_system_prompt_sections(self, minimal_snapshot):
        sections = minimal_snapshot.manifest.system_prompt_sections
        assert "Getting started" in sections
        assert "Doing tasks" in sections

    def test_tools_in_manifest(self, minimal_snapshot):
        assert "Bash" in minimal_snapshot.manifest.tools

    def test_top_level_headings_order(self, minimal_snapshot):
        headings = minimal_snapshot.manifest.top_level_headings
        assert headings.index("User Message") < headings.index("System Prompt")
        assert headings.index("System Prompt") < headings.index("Tools")

    def test_diagnostic_count_consistency(self, minimal_snapshot):
        assert minimal_snapshot.manifest.diagnostic_count == len(minimal_snapshot.diagnostics)

    def test_unknown_top_level_headings_empty(self, minimal_snapshot):
        assert minimal_snapshot.manifest.unknown_top_level_headings == []

    def test_component_fields(self, minimal_snapshot):
        sp = minimal_snapshot.components["system_prompt"]
        assert isinstance(sp, Component)
        assert sp.id == "system_prompt"
        assert sp.kind == "system_prompt"
        assert sp.title == "System Prompt"
        assert sp.line_start > 0
        assert sp.line_end >= sp.line_start
        assert sp.hash != ""

    def test_source_equals_path(self, minimal_snapshot, tmp_path):
        expected = str(tmp_path / "test_snapshot.md")
        assert minimal_snapshot.source == expected


# ---------------------------------------------------------------------------
# Unit tests — missing components trigger diagnostics
# ---------------------------------------------------------------------------

_MISSING_TOOLS_MD = """\
# Claude Code Version 0.1.0

Release Date: 2024-06-01

# User Message

Hello.

# System Prompt

You help.

## Core

Be helpful.
"""


class TestMissingComponentDiagnostics:
    """When a top-level component is absent, a warning diagnostic is emitted."""

    @pytest.fixture
    def snapshot_no_tools(self, tmp_path):
        md_file = tmp_path / "no_tools.md"
        md_file.write_text(_MISSING_TOOLS_MD, encoding="utf-8")
        return parse_snapshot(str(md_file))

    def test_missing_tools_warning_emitted(self, snapshot_no_tools):
        codes = [d.code for d in snapshot_no_tools.diagnostics]
        assert "missing_top_level_component" in codes

    def test_tools_component_is_placeholder(self, snapshot_no_tools):
        tools = snapshot_no_tools.components["tools"]
        assert tools.raw == ""
        assert tools.hash == ""
        assert tools.line_start == 0
        assert tools.line_end == 0
        assert tools.children == {}

    def test_diagnostic_count_includes_warning(self, snapshot_no_tools):
        assert snapshot_no_tools.manifest.diagnostic_count == len(snapshot_no_tools.diagnostics)
        assert snapshot_no_tools.manifest.diagnostic_count >= 1


# ---------------------------------------------------------------------------
# Unit tests — unknown top-level heading
# ---------------------------------------------------------------------------

_UNKNOWN_HEADING_MD = """\
# Claude Code Version 9.9.9

Release Date: 2030-12-31

# User Message

Test.

# System Prompt

Answer.

# Tools

## Read

Read files.

{"type": "object"}

# Experimental Features

Some secret stuff.
"""


class TestUnknownHeadingDiagnostics:
    """Unknown top-level headings produce a warning and appear in the manifest."""

    @pytest.fixture
    def snapshot_with_unknown(self, tmp_path):
        md_file = tmp_path / "unknown_heading.md"
        md_file.write_text(_UNKNOWN_HEADING_MD, encoding="utf-8")
        return parse_snapshot(str(md_file))

    def test_unknown_heading_warning_emitted(self, snapshot_with_unknown):
        codes = [d.code for d in snapshot_with_unknown.diagnostics]
        assert "unknown_top_level_heading" in codes

    def test_unknown_heading_in_manifest(self, snapshot_with_unknown):
        assert "Experimental Features" in snapshot_with_unknown.manifest.unknown_top_level_headings

    def test_diagnostic_count_consistency(self, snapshot_with_unknown):
        assert snapshot_with_unknown.manifest.diagnostic_count == len(snapshot_with_unknown.diagnostics)


# ---------------------------------------------------------------------------
# Unit tests — build_manifest directly
# ---------------------------------------------------------------------------

def test_build_manifest_direct():
    """build_manifest correctly populates all Manifest fields."""
    from claude_code_analyzer.models import Diagnostic

    doc = parse_markdown(_MINIMAL_MD)
    regions = parse_structural(doc)

    # Build stubs: just need the children to have `.title`
    sp_child_a = Component(
        id="system_prompt/Getting started",
        kind="system_prompt_section",
        title="Getting started",
        path=["System Prompt", "Getting started"],
        raw="",
        normalized="",
        hash="",
        line_start=1,
        line_end=5,
    )
    sp_child_b = Component(
        id="system_prompt/Doing tasks",
        kind="system_prompt_section",
        title="Doing tasks",
        path=["System Prompt", "Doing tasks"],
        raw="",
        normalized="",
        hash="",
        line_start=6,
        line_end=10,
    )
    tools_child = Component(
        id="tools/Bash",
        kind="tool",
        title="Bash",
        path=["Tools", "Bash"],
        raw="",
        normalized="",
        hash="",
        line_start=1,
        line_end=5,
    )
    sp_comp = Component(
        id="system_prompt",
        kind="system_prompt",
        title="System Prompt",
        path=["System Prompt"],
        raw="",
        normalized="",
        hash="",
        line_start=1,
        line_end=10,
        children={
            "system_prompt/Getting started": sp_child_a,
            "system_prompt/Doing tasks": sp_child_b,
        },
    )
    tools_comp = Component(
        id="tools",
        kind="tools",
        title="Tools",
        path=["Tools"],
        raw="",
        normalized="",
        hash="",
        line_start=11,
        line_end=20,
        children={"tools/Bash": tools_child},
    )
    um_comp = Component(
        id="user_message",
        kind="user_message",
        title="User Message",
        path=["User Message"],
        raw="",
        normalized="",
        hash="",
        line_start=0,
        line_end=0,
    )

    components = {
        "user_message": um_comp,
        "system_prompt": sp_comp,
        "tools": tools_comp,
    }
    diags: list[Diagnostic] = [
        Diagnostic(level="info", code="test", message="x"),
        Diagnostic(level="warning", code="test2", message="y"),
    ]

    manifest = build_manifest(components, regions, diags)

    assert isinstance(manifest, Manifest)
    assert "User Message" in manifest.top_level_headings
    assert "System Prompt" in manifest.top_level_headings
    assert "Tools" in manifest.top_level_headings
    assert "Getting started" in manifest.system_prompt_sections
    assert "Doing tasks" in manifest.system_prompt_sections
    assert "Bash" in manifest.tools
    assert manifest.unknown_top_level_headings == []
    assert manifest.diagnostic_count == 2
