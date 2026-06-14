"""Extractor for any non-special H1 section (System Prompt, Executing
actions with care, Text output …, etc.).

A non-special H1 is one that isn't User Message or Tools. They all share the
same shape: an optional preamble (text before the first H2), followed by H2
subsections, occasionally with H3 nesting underneath.
"""

from __future__ import annotations

from ...models import Component, Diagnostic, MarkdownSection
from .normalize import content_hash as _hash, normalize as _normalize


# ── Recursive section builder ─────────────────────────────────────────────────

def _build_subsection_component(
    section: MarkdownSection,
    parent_id: str,
    parent_path: list[str],
    h1_slug: str,
    diagnostics: list[Diagnostic],
    depth: int,
) -> Component:
    """
    Recursively build a Component for *section* and all its children.

    depth=1  → direct H2 children of the H1
    depth=2  → grandchildren (H3)
    depth>2  → emit unexpected_heading_depth and still recurse
    """
    comp_id = f"{parent_id}/{section.title}"
    comp_path = parent_path + [section.title]

    children: dict[str, Component] = {}
    for child in section.children:
        if depth >= 1 and child.children:
            diagnostics.append(
                Diagnostic(
                    level="warning",
                    code="unexpected_heading_depth",
                    message=(
                        f"Heading '{child.title}' under '{section.title}' has children "
                        f"(depth > 2 under {h1_slug})."
                    ),
                    line=child.line_start,
                )
            )
        child_comp = _build_subsection_component(
            section=child,
            parent_id=comp_id,
            parent_path=comp_path,
            h1_slug=h1_slug,
            diagnostics=diagnostics,
            depth=depth + 1,
        )
        children[child_comp.id] = child_comp

    norm = _normalize(section.raw)
    return Component(
        id=comp_id,
        kind="h1_subsection",
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

def extract_h1_section(
    section: MarkdownSection,
    slug: str,
    diagnostics: list[Diagnostic],
) -> Component:
    """Build a top-level :class:`Component` for an H1 section.

    Each direct H2 child becomes a child Component with ``kind='h1_subsection'``.
    Deeper headings recurse; if any grandchild has its own children a
    ``unexpected_heading_depth`` diagnostic is emitted.

    Any non-empty body text appearing before the first H2 child is surfaced
    as a synthetic child component whose title equals the H1's own title.
    This naming makes the H1's introductory prose share row-identity with
    any historical H2 of the same name (e.g. when an H2 is later promoted
    to its own H1, its prose lives on under the H1's preamble path and the
    Evolution view treats both incarnations as one continuous row).
    """
    base_id = slug
    base_path = [section.title]

    children: dict[str, Component] = {}

    # The H1's introductory prose (text before the first H2) is exposed as a
    # synthetic subsection. We title it with the H1's own display title so
    # row-identity in Evolution naturally bridges the historical case where
    # the same prose lived as an H2 of the same name under another H1
    # (e.g. "Executing actions with care" was an H2 of System Prompt before
    # being promoted to its own H1 with this content as the preamble).
    preamble_raw = section.body or ""
    preamble_norm = _normalize(preamble_raw)
    if preamble_norm:
        preamble_title = section.title
        preamble_id = f"{base_id}/{preamble_title}"
        preamble_end = (
            section.children[0].line_start - 1
            if section.children
            else section.line_end
        )
        preamble_comp = Component(
            id=preamble_id,
            kind="h1_subsection",
            title=preamble_title,
            path=base_path + [preamble_title],
            raw=preamble_raw,
            normalized=preamble_norm,
            hash=_hash(preamble_norm),
            line_start=section.line_start,
            line_end=max(preamble_end, section.line_start),
            children={},
        )
        children[preamble_id] = preamble_comp

    for child in section.children:
        child_comp = _build_subsection_component(
            section=child,
            parent_id=base_id,
            parent_path=base_path,
            h1_slug=slug,
            diagnostics=diagnostics,
            depth=1,
        )
        children[child_comp.id] = child_comp

    norm = _normalize(section.raw)
    return Component(
        id=base_id,
        kind=slug,
        title=section.title,
        path=base_path,
        raw=section.raw,
        normalized=norm,
        hash=_hash(norm),
        line_start=section.line_start,
        line_end=section.line_end,
        children=children,
    )


# Backwards-compat shim for any caller still importing the old name.
def extract_system_prompt(
    section: MarkdownSection,
    diagnostics: list[Diagnostic],
) -> Component:
    return extract_h1_section(section, "system_prompt", diagnostics)
