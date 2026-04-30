"""Top-level coordinator: parse a Claude Code prompt capture into a Snapshot.

Public API
----------
    parse_snapshot(path: str) -> Snapshot
    build_manifest(components, regions, diagnostics) -> Manifest
"""

from __future__ import annotations

from .models import Component, Diagnostic, Manifest, Snapshot, StructuralRegions
from .parsers import parse_markdown, parse_structural
from .parsers.extractors import extract_user_message, extract_system_prompt, extract_tools


# ---------------------------------------------------------------------------
# Empty-placeholder factory
# ---------------------------------------------------------------------------

def _empty_component(component_id: str, title: str) -> Component:
    """Return a zero-content placeholder Component for a missing top-level region."""
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
    """Build a :class:`Manifest` summary from the assembled components.

    Parameters
    ----------
    components:
        The fully-extracted top-level component mapping (keys are component ids).
    regions:
        The structural regions produced by the structural parser; used to
        reconstruct document order and collect unknown heading titles.
    diagnostics:
        The accumulated diagnostics list; its length becomes ``diagnostic_count``.

    Returns
    -------
    Manifest
    """
    # top_level_headings: all known + unknown sections ordered by line_start.
    ordered_sections: list[tuple[int, str]] = []
    for section in [regions.user_message, regions.system_prompt, regions.tools]:
        if section is not None:
            ordered_sections.append((section.line_start, section.title))
    for section in regions.unknown:
        ordered_sections.append((section.line_start, section.title))
    ordered_sections.sort(key=lambda t: t[0])
    top_level_headings = [title for _, title in ordered_sections]

    # system_prompt_sections: titles of direct children of the system_prompt component.
    system_prompt_sections: list[str] = []
    sp = components.get("system_prompt")
    if sp is not None:
        system_prompt_sections = [child.title for child in sp.children.values()]

    # tools: titles of direct children of the tools component.
    tools_titles: list[str] = []
    tools_comp = components.get("tools")
    if tools_comp is not None:
        tools_titles = [child.title for child in tools_comp.children.values()]

    # unknown_top_level_headings: titles from regions.unknown.
    unknown_top_level_headings = [s.title for s in regions.unknown]

    return Manifest(
        top_level_headings=top_level_headings,
        system_prompt_sections=system_prompt_sections,
        tools=tools_titles,
        unknown_top_level_headings=unknown_top_level_headings,
        diagnostic_count=len(diagnostics),
    )


# ---------------------------------------------------------------------------
# parse_snapshot
# ---------------------------------------------------------------------------

def parse_snapshot(path: str) -> Snapshot:
    """Parse the Claude Code prompt capture at *path* and return a :class:`Snapshot`.

    Steps
    -----
    1. Read the file at *path*.
    2. Call ``parse_markdown`` to produce a ``MarkdownDoc``.
    3. Call ``parse_structural`` to produce ``StructuralRegions``.
    4. For each known region (user_message, system_prompt, tools):
       - If the region is ``None``, emit a ``missing_top_level_component``
         warning and use an empty placeholder :class:`Component`.
       - Otherwise call the matching extractor.
    5. For each unknown section in ``regions.unknown``, emit an
       ``unknown_top_level_heading`` warning.
    6. Build a :class:`Manifest` and return a :class:`Snapshot`.

    Parameters
    ----------
    path:
        Absolute or relative filesystem path to a ``.md`` capture file.

    Returns
    -------
    Snapshot
    """
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

    # ── System Prompt ─────────────────────────────────────────────────────────
    if regions.system_prompt is None:
        diagnostics.append(
            Diagnostic(
                level="warning",
                code="missing_top_level_component",
                message="Top-level component 'System Prompt' is missing from the document.",
            )
        )
        system_prompt_comp = _empty_component("system_prompt", "System Prompt")
    else:
        system_prompt_comp = extract_system_prompt(regions.system_prompt, diagnostics)

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

    # ── Unknown sections ──────────────────────────────────────────────────────
    for unknown_section in regions.unknown:
        diagnostics.append(
            Diagnostic(
                level="warning",
                code="unknown_top_level_heading",
                message=(
                    f"Unrecognised top-level heading '{unknown_section.title}' "
                    f"at line {unknown_section.line_start}."
                ),
                line=unknown_section.line_start,
            )
        )

    components: dict[str, Component] = {
        "user_message": user_message_comp,
        "system_prompt": system_prompt_comp,
        "tools": tools_comp,
    }

    manifest = build_manifest(components, regions, diagnostics)

    return Snapshot(
        version=regions.version,
        release_date=regions.release_date,
        source=path,
        manifest=manifest,
        components=components,
        diagnostics=diagnostics,
    )

