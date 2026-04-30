"""Shared data types for all parser layers."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


# ── Layer 1 output: Markdown AST ──────────────────────────────────────────────

@dataclass
class XmlSpan:
    """A <tag>...</tag> region found inside markdown body text."""
    tag: str
    raw: str      # full text including open/close tags
    inner: str    # text between the tags
    line_start: int
    line_end: int


@dataclass
class MarkdownSection:
    """A heading plus all content before the next same-or-higher heading."""
    level: int
    title: str
    raw: str      # full text from heading line through end of section
    body: str     # text between this heading and first child heading
    line_start: int
    line_end: int
    children: list[MarkdownSection] = field(default_factory=list)
    xml_spans: list[XmlSpan] = field(default_factory=list)


@dataclass
class MarkdownDoc:
    """Root of the parsed markdown document."""
    raw: str
    preamble: str                    # text before the first heading
    sections: list[MarkdownSection]  # top-level sections


# ── Layer 2 output: Structural regions ────────────────────────────────────────

@dataclass
class StructuralRegions:
    """Top-level regions identified by the structural parser."""
    version: str
    release_date: str
    user_message: MarkdownSection | None
    system_prompt: MarkdownSection | None
    tools: MarkdownSection | None
    unknown: list[MarkdownSection] = field(default_factory=list)


# ── Final output: Snapshot model ──────────────────────────────────────────────

@dataclass
class Diagnostic:
    level: Literal["info", "warning", "error"]
    code: str
    message: str
    line: int | None = None


@dataclass
class Component:
    id: str
    kind: str
    title: str
    path: list[str]
    raw: str
    normalized: str
    hash: str
    line_start: int
    line_end: int
    children: dict[str, Component] = field(default_factory=dict)


@dataclass
class Manifest:
    top_level_headings: list[str]
    system_prompt_sections: list[str]
    tools: list[str]
    unknown_top_level_headings: list[str]
    diagnostic_count: int


@dataclass
class Snapshot:
    version: str
    release_date: str
    source: str
    manifest: Manifest
    components: dict[str, Component]
    diagnostics: list[Diagnostic]
