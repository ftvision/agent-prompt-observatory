"""Tests for the Layer 2 structural parser."""

from __future__ import annotations

import pytest

from claude_code_analyzer.models import MarkdownDoc, MarkdownSection, StructuralRegions
from claude_code_analyzer.parsers.structural import parse_structural


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _section(title: str, level: int = 1, body: str = "", line_start: int = 1, line_end: int = 5) -> MarkdownSection:
    """Build a minimal MarkdownSection for testing."""
    return MarkdownSection(
        level=level,
        title=title,
        raw=f"{'#' * level} {title}\n{body}",
        body=body,
        line_start=line_start,
        line_end=line_end,
    )


def _doc(preamble: str = "", sections: list[MarkdownSection] | None = None) -> MarkdownDoc:
    """Build a minimal MarkdownDoc for testing."""
    return MarkdownDoc(
        raw=preamble,
        preamble=preamble,
        sections=sections or [],
    )


# ---------------------------------------------------------------------------
# Test 1: All three known components are present
# ---------------------------------------------------------------------------

def test_all_three_components_extracted():
    """A doc with User Message, System Prompt, and Tools is fully mapped."""
    doc = _doc(sections=[
        _section("User Message", line_start=1, line_end=10),
        _section("System Prompt", line_start=11, line_end=50),
        _section("Tools", line_start=51, line_end=100),
    ])
    result = parse_structural(doc)

    assert isinstance(result, StructuralRegions)
    assert result.user_message is not None
    assert result.user_message.title == "User Message"
    assert result.system_prompt is not None
    assert result.system_prompt.title == "System Prompt"
    assert result.tools is not None
    assert result.tools.title == "Tools"
    assert result.unknown == []


# ---------------------------------------------------------------------------
# Test 2: Missing Tools section → tools is None
# ---------------------------------------------------------------------------

def test_missing_tools_is_none():
    """When Tools is absent, tools should be None and others still mapped."""
    doc = _doc(sections=[
        _section("User Message", line_start=1, line_end=10),
        _section("System Prompt", line_start=11, line_end=50),
    ])
    result = parse_structural(doc)

    assert result.tools is None
    assert result.user_message is not None
    assert result.system_prompt is not None
    assert result.unknown == []


# ---------------------------------------------------------------------------
# Test 3: Unknown top-level heading ends up in unknown list
# ---------------------------------------------------------------------------

def test_unknown_heading_appended_to_unknown():
    """Unrecognised top-level headings are collected in unknown."""
    doc = _doc(sections=[
        _section("System Prompt", line_start=1, line_end=20),
        _section("Experimental Features", line_start=21, line_end=40),
        _section("User Message", line_start=41, line_end=50),
        _section("Debug Info", line_start=51, line_end=60),
    ])
    result = parse_structural(doc)

    assert result.system_prompt is not None
    assert result.user_message is not None
    assert result.tools is None

    unknown_titles = [s.title for s in result.unknown]
    assert "Experimental Features" in unknown_titles
    assert "Debug Info" in unknown_titles
    assert len(result.unknown) == 2


# ---------------------------------------------------------------------------
# Test 4: Version and release date extracted from preamble
# ---------------------------------------------------------------------------

def test_version_and_release_date_from_preamble():
    """Version and release date are extracted from the preamble text."""
    preamble = (
        "# Claude Code Version 2.1.49\n"
        "Release Date: 2025-09-15\n"
        "Some other preamble text.\n"
    )
    doc = _doc(preamble=preamble, sections=[
        _section("System Prompt"),
    ])
    result = parse_structural(doc)

    assert result.version == "2.1.49"
    assert result.release_date == "2025-09-15"


# ---------------------------------------------------------------------------
# Test 5: Version in first section heading, release date in section body
# ---------------------------------------------------------------------------

def test_version_from_section_title_and_release_date_from_body():
    """Version from a top-level heading, release date from that section's body."""
    version_section = MarkdownSection(
        level=1,
        title="Claude Code Version 3.0.0",
        raw="# Claude Code Version 3.0.0\nRelease Date: 2026-01-01\n",
        body="Release Date: 2026-01-01\n",
        line_start=1,
        line_end=3,
    )
    doc = _doc(preamble="", sections=[
        version_section,
        _section("User Message", line_start=4, line_end=10),
        _section("System Prompt", line_start=11, line_end=30),
        _section("Tools", line_start=31, line_end=50),
    ])
    result = parse_structural(doc)

    assert result.version == "3.0.0"
    assert result.release_date == "2026-01-01"
    # The version section itself must NOT appear as a component or in unknown
    assert result.user_message is not None
    assert result.system_prompt is not None
    assert result.tools is not None
    assert result.unknown == []


# ---------------------------------------------------------------------------
# Test 6: Missing version / release date → empty strings
# ---------------------------------------------------------------------------

def test_missing_version_and_release_date_are_empty_strings():
    """When version/release date are absent, both fields default to empty string."""
    doc = _doc(preamble="No version info here.\n", sections=[
        _section("System Prompt"),
    ])
    result = parse_structural(doc)

    assert result.version == ""
    assert result.release_date == ""


# ---------------------------------------------------------------------------
# Test 7: Duplicate known heading — first is kept, warning emitted
# ---------------------------------------------------------------------------

def test_duplicate_known_title_keeps_first(capsys):
    """Duplicate User Message sections: first is kept, warning printed to stderr."""
    first = _section("User Message", line_start=1, line_end=5)
    second = _section("User Message", line_start=6, line_end=10)
    doc = _doc(sections=[first, second])
    result = parse_structural(doc)

    assert result.user_message is first
    captured = capsys.readouterr()
    assert "duplicate" in captured.err.lower() or "User Message" in captured.err


# ---------------------------------------------------------------------------
# Test 8: Empty doc produces all-None / empty-string result
# ---------------------------------------------------------------------------

def test_empty_doc():
    """An empty MarkdownDoc produces a fully-empty StructuralRegions."""
    doc = _doc()
    result = parse_structural(doc)

    assert result.version == ""
    assert result.release_date == ""
    assert result.user_message is None
    assert result.system_prompt is None
    assert result.tools is None
    assert result.unknown == []
