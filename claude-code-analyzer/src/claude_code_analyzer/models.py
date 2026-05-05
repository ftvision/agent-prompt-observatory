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
    """Top-level regions identified by the structural parser.

    ``user_message`` and ``tools`` are treated specially because they have
    dedicated extractors. Every other H1 in the document — System Prompt,
    Executing actions with care, Text output (does not apply to tool calls),
    or any future addition — lands in ``h1_sections`` keyed by slug, in
    document order.
    """
    version: str
    release_date: str
    user_message: MarkdownSection | None
    tools: MarkdownSection | None
    h1_sections: dict[str, MarkdownSection] = field(default_factory=dict)


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
    top_level_headings: list[str]                  # H1 titles in document order
    h1_subsections: dict[str, list[str]]           # slug → H2 child titles for each non-special H1
    tools: list[str]                               # tool titles in order
    diagnostic_count: int


@dataclass
class Snapshot:
    version: str
    release_date: str
    source: str
    manifest: Manifest
    components: dict[str, Component]
    diagnostics: list[Diagnostic]
