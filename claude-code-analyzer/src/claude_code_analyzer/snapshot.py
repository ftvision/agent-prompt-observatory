"""Top-level coordinator: parse a Claude Code prompt capture into a Snapshot.

Public API
----------
    parse_snapshot(path: str) -> Snapshot
    build_manifest(components, regions, diagnostics) -> Manifest
"""

from __future__ import annotations

from .models import Component, Diagnostic, Manifest, Snapshot, StructuralRegions
from .parsers import parse_markdown, parse_structural
from .parsers.extractors import (
    extract_h1_section,
    extract_tools,
    extract_user_message,
)


# ---------------------------------------------------------------------------
# Empty-placeholder factory
# ---------------------------------------------------------------------------

def _empty_component(component_id: str, title: str) -> Component:
    return Component(
        id=component_id,
        kind=component_id,
        title=title,
        path=[title],
        raw="",
        normalized="",
        hash="",
        line_start=0,
        line_end=0,
        children={},
    )


# ---------------------------------------------------------------------------
# build_manifest
# ---------------------------------------------------------------------------

def build_manifest(
    components: dict[str, Component],
    regions: StructuralRegions,
    diagnostics: list[Diagnostic],
) -> Manifest:
    """Build a :class:`Manifest` summary from the assembled components."""
    ordered_sections: list[tuple[int, str]] = []
    if regions.user_message is not None:
        ordered_sections.append((regions.user_message.line_start, regions.user_message.title))
    for section in regions.h1_sections.values():
        ordered_sections.append((section.line_start, section.title))
    if regions.tools is not None:
        ordered_sections.append((regions.tools.line_start, regions.tools.title))
    ordered_sections.sort(key=lambda t: t[0])
    top_level_headings = [title for _, title in ordered_sections]

    h1_subsections: dict[str, list[str]] = {}
    for slug in regions.h1_sections:
        comp = components.get(slug)
        if comp is None:
            continue
        h1_subsections[slug] = [child.title for child in comp.children.values()]

    tools_titles: list[str] = []
    tools_comp = components.get("tools")
    if tools_comp is not None:
        tools_titles = [child.title for child in tools_comp.children.values()]

    return Manifest(
        top_level_headings=top_level_headings,
        h1_subsections=h1_subsections,
        tools=tools_titles,
        diagnostic_count=len(diagnostics),
    )


# ---------------------------------------------------------------------------
# parse_snapshot
# ---------------------------------------------------------------------------

def parse_snapshot(path: str) -> Snapshot:
    """Parse the Claude Code prompt capture at *path* and return a :class:`Snapshot`."""
    with open(path, encoding="utf-8") as fh:
        text = fh.read()

    doc = parse_markdown(text)
    regions = parse_structural(doc)

    diagnostics: list[Diagnostic] = []

    # ── User Message ──────────────────────────────────────────────────────────
    if regions.user_message is None:
        diagnostics.append(
            Diagnostic(
                level="warning",
                code="missing_top_level_component",
                message="Top-level component 'User Message' is missing from the document.",
            )
        )
        user_message_comp = _empty_component("user_message", "User Message")
    else:
        user_message_comp = extract_user_message(regions.user_message, diagnostics)

    # ── Tools ─────────────────────────────────────────────────────────────────
    if regions.tools is None:
        diagnostics.append(
            Diagnostic(
                level="warning",
                code="missing_top_level_component",
                message="Top-level component 'Tools' is missing from the document.",
            )
        )
        tools_comp = _empty_component("tools", "Tools")
    else:
        tools_comp = extract_tools(regions.tools, diagnostics)

    # ── H1 sections (System Prompt + any newly-promoted H1) ──────────────────
    h1_components: dict[str, Component] = {}
    for slug, section in regions.h1_sections.items():
        h1_components[slug] = extract_h1_section(section, slug, diagnostics)

    # Assemble in document order: User Message, then each H1 section in source
    # order, then Tools. Insertion order survives in Python dicts and JSON.
    components: dict[str, Component] = {"user_message": user_message_comp}
    for slug, comp in h1_components.items():
        components[slug] = comp
    components["tools"] = tools_comp

    manifest = build_manifest(components, regions, diagnostics)

    return Snapshot(
        version=regions.version,
        release_date=regions.release_date,
        source=path,
        manifest=manifest,
        components=components,
        diagnostics=diagnostics,
    )
