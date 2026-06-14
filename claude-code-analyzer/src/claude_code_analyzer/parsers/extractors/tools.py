"""Extractor for the Tools section."""

from __future__ import annotations

import json
import re

from ...models import Component, Diagnostic, MarkdownSection
from .normalize import content_hash as _hash, normalize as _normalize


# ── JSON-block extractor ──────────────────────────────────────────────────────

def _split_prose_and_schema(body: str) -> tuple[str, str | None]:
    """
    Return ``(prose, schema_text)`` where *schema_text* is the last contiguous
    outermost JSON object (``{…}``) found at the end of *body*, or ``None`` if
    no such block exists.

    Strategy: scan lines from the end to find the closing ``}`` of an outermost
    brace-balanced block, then walk back to its matching opening ``{``.
    """
    lines = body.split("\n")
    n = len(lines)

    # Find the last non-empty, non-horizontal-rule line
    last_content = n - 1
    while last_content >= 0 and (
        not lines[last_content].strip()
        or re.fullmatch(r"-{3,}|={3,}|\*{3,}", lines[last_content].strip())
    ):
        last_content -= 1

    if last_content < 0 or not lines[last_content].strip().endswith("}"):
        return body, None

    # Walk upward counting braces to find the matching open-brace line
    depth = 0
    schema_start: int | None = None
    for i in range(last_content, -1, -1):
        line = lines[i]
        depth += line.count("}") - line.count("{")
        if depth <= 0:
            # Check that this line actually starts (or contains) an opening brace
            stripped = line.lstrip()
            if stripped.startswith("{"):
                schema_start = i
            break

    if schema_start is None:
        return body, None

    schema_lines = lines[schema_start : last_content + 1]
    prose_lines = lines[:schema_start]

    schema_text = "\n".join(schema_lines).strip()
    prose_text = "\n".join(prose_lines).strip()

    # Quick sanity-check: the block must be valid outermost JSON
    # (we try parsing; if it fails we still return it so the caller can diagnose)
    return prose_text, schema_text


# ── Per-tool builder ──────────────────────────────────────────────────────────

def _build_tool_component(
    tool: MarkdownSection,
    diagnostics: list[Diagnostic],
) -> Component:
    tool_id = f"tools/{tool.title}"
    tool_path = ["Tools", tool.title]
    tool_children: dict[str, Component] = {}

    # ── Schema and prose split ────────────────────────────────────────────────
    prose_text, schema_text = _split_prose_and_schema(tool.body)

    if schema_text is None:
        diagnostics.append(
            Diagnostic(
                level="warning",
                code="tool_without_schema",
                message=f"Tool '{tool.title}' has no JSON schema block.",
                line=tool.line_start,
            )
        )
    else:
        try:
            json.loads(schema_text)
        except json.JSONDecodeError as exc:
            diagnostics.append(
                Diagnostic(
                    level="error",
                    code="tool_schema_parse_failed",
                    message=f"Tool '{tool.title}' schema JSON parse failed: {exc}",
                    line=tool.line_start,
                )
            )

        schema_id = f"{tool_id}/schema"
        norm_schema = _normalize(schema_text)
        tool_children[schema_id] = Component(
            id=schema_id,
            kind="tool_schema",
            title="schema",
            path=tool_path + ["schema"],
            raw=schema_text,
            normalized=norm_schema,
            hash=_hash(norm_schema),
            line_start=tool.line_start,
            line_end=tool.line_end,
        )

    prose_id = f"{tool_id}/prose"
    norm_prose = _normalize(prose_text)
    tool_children[prose_id] = Component(
        id=prose_id,
        kind="tool_prose",
        title="prose",
        path=tool_path + ["prose"],
        raw=prose_text,
        normalized=norm_prose,
        hash=_hash(norm_prose),
        line_start=tool.line_start,
        line_end=tool.line_end,
    )

    # ── Subsection children (### headings) ────────────────────────────────────
    for child in tool.children:
        child_id = f"{tool_id}/subsections/{child.title}"
        child_path = tool_path + ["subsections", child.title]
        norm_child = _normalize(child.raw)
        tool_children[child_id] = Component(
            id=child_id,
            kind="tool_subsection",
            title=child.title,
            path=child_path,
            raw=child.raw,
            normalized=norm_child,
            hash=_hash(norm_child),
            line_start=child.line_start,
            line_end=child.line_end,
        )

    norm_tool = _normalize(tool.raw)
    return Component(
        id=tool_id,
        kind="tool",
        title=tool.title,
        path=tool_path,
        raw=tool.raw,
        normalized=norm_tool,
        hash=_hash(norm_tool),
        line_start=tool.line_start,
        line_end=tool.line_end,
        children=tool_children,
    )


# ── Public extractor ──────────────────────────────────────────────────────────

def extract_tools(
    section: MarkdownSection,
    diagnostics: list[Diagnostic],
) -> Component:
    """
    Build the top-level ``tools`` Component from a MarkdownSection.

    Each direct child of *section* is treated as an individual tool.  Within
    each tool:

    - The last contiguous JSON object in the body becomes ``kind="tool_schema"``.
    - Everything before it becomes ``kind="tool_prose"``.
    - ``###`` sub-headings become ``kind="tool_subsection"`` children.

    Diagnostics emitted:
    - ``tool_without_schema``   — no JSON block found in tool body.
    - ``tool_schema_parse_failed`` — JSON block is malformed.
    - ``duplicate_tool_name``   — two tools share the same title.
    """
    base_id = "tools"
    base_path = ["Tools"]
    children: dict[str, Component] = {}

    seen_titles: dict[str, int] = {}
    for tool in section.children:
        if tool.title in seen_titles:
            diagnostics.append(
                Diagnostic(
                    level="warning",
                    code="duplicate_tool_name",
                    message=(
                        f"Tool name '{tool.title}' appears more than once "
                        f"(first at line {seen_titles[tool.title]}, "
                        f"duplicate at line {tool.line_start})."
                    ),
                    line=tool.line_start,
                )
            )
        else:
            seen_titles[tool.title] = tool.line_start

        tool_comp = _build_tool_component(tool, diagnostics)
        children[tool_comp.id] = tool_comp

    norm = _normalize(section.raw)
    return Component(
        id=base_id,
        kind="tools",
        title="Tools",
        path=base_path,
        raw=section.raw,
        normalized=norm,
        hash=_hash(norm),
        line_start=section.line_start,
        line_end=section.line_end,
        children=children,
    )
