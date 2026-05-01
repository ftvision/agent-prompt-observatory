"""Extractor for the System Prompt section."""

from __future__ import annotations

import hashlib
import re

from ...models import Component, Diagnostic, MarkdownSection


# ── Shared helpers ────────────────────────────────────────────────────────────

def _normalize(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [l.rstrip() for l in text.split("\n")]
    text = "\n".join(lines)
    text = re.sub(r"/tmp/claude-[^\s]+", "/tmp/claude-<session>", text)
    text = re.sub(r"(/\.claude/projects/)[^/\s]+", r"\1<project>", text)
    return text.strip()


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


# ── Recursive section builder ─────────────────────────────────────────────────

def _build_section_component(
    section: MarkdownSection,
    parent_id: str,
    parent_path: list[str],
    kind: str,
    diagnostics: list[Diagnostic],
    depth: int,
) -> Component:
    """
    Recursively build a Component for *section* and all its children.

    depth=1  → direct children of system_prompt  (kind="system_prompt_section")
    depth=2  → grandchildren                      (kind="system_prompt_section")
    depth>2  → emit unexpected_heading_depth and still recurse
    """
    comp_id = f"{parent_id}/{section.title}"
    comp_path = parent_path + [section.title]

    children: dict[str, Component] = {}
    for child in section.children:
        # depth >= 1 means we are already at the grandchild level (depth=1 → iterating
        # over grandchildren of system_prompt).  If any of those grandchildren themselves
        # have children, that is depth > 2, which is unexpected.
        if depth >= 1 and child.children:
            diagnostics.append(
                Diagnostic(
                    level="warning",
                    code="unexpected_heading_depth",
                    message=(
                        f"Heading '{child.title}' under '{section.title}' has children "
                        f"(depth > 2 under system_prompt)."
                    ),
                    line=child.line_start,
                )
            )
        child_comp = _build_section_component(
            section=child,
            parent_id=comp_id,
            parent_path=comp_path,
            kind="system_prompt_section",
            diagnostics=diagnostics,
            depth=depth + 1,
        )
        children[child_comp.id] = child_comp

    norm = _normalize(section.raw)
    return Component(
        id=comp_id,
        kind=kind,
        title=section.title,
        path=comp_path,
        raw=section.raw,
        normalized=norm,
        hash=_hash(norm),
        line_start=section.line_start,
        line_end=section.line_end,
        children=children,
    )


# ── Public extractor ──────────────────────────────────────────────────────────

def extract_system_prompt(
    section: MarkdownSection,
    diagnostics: list[Diagnostic],
) -> Component:
    """
    Build the top-level ``system_prompt`` Component from a MarkdownSection.

    Each direct child of *section* (i.e. each ``##`` sub-section) becomes a
    child Component with ``kind="system_prompt_section"``.  Deeper headings
    are recursed into; if any grandchild has its own children a
    ``unexpected_heading_depth`` diagnostic is emitted.

    Any non-empty body text appearing before the first ``##`` child is
    surfaced as a synthetic ``"Preamble"`` child so it isn't dropped.
    """
    base_id = "system_prompt"
    base_path = ["System Prompt"]

    children: dict[str, Component] = {}

    # Preamble: text between the System Prompt heading and its first H2 child.
    preamble_raw = section.body or ""
    preamble_norm = _normalize(preamble_raw)
    if preamble_norm:
        preamble_id = f"{base_id}/Preamble"
        preamble_end = (
            section.children[0].line_start - 1
            if section.children
            else section.line_end
        )
        preamble_comp = Component(
            id=preamble_id,
            kind="system_prompt_section",
            title="Preamble",
            path=base_path + ["Preamble"],
            raw=preamble_raw,
            normalized=preamble_norm,
            hash=_hash(preamble_norm),
            line_start=section.line_start,
            line_end=max(preamble_end, section.line_start),
            children={},
        )
        children[preamble_id] = preamble_comp

    for child in section.children:
        child_comp = _build_section_component(
            section=child,
            parent_id=base_id,
            parent_path=base_path,
            kind="system_prompt_section",
            diagnostics=diagnostics,
            depth=1,
        )
        children[child_comp.id] = child_comp

    norm = _normalize(section.raw)
    return Component(
        id=base_id,
        kind="system_prompt",
        title="System Prompt",
        path=base_path,
        raw=section.raw,
        normalized=norm,
        hash=_hash(norm),
        line_start=section.line_start,
        line_end=section.line_end,
        children=children,
    )
