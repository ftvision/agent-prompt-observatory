"""Extractor for the User Message section."""

from __future__ import annotations

import re

from ...models import Component, Diagnostic, MarkdownSection, XmlSpan
from .normalize import content_hash as _hash, normalize as _normalize


# ── Context-block helper ──────────────────────────────────────────────────────

_HEADING_RE = re.compile(r"^##\s+(.+)$", re.MULTILINE)


def _build_context_block_children(
    parent_id: str,
    parent_path: list[str],
    inner: str,
    line_offset: int,
) -> dict[str, Component]:
    """
    Scan *inner* for `## <title>` headings and return one Component per heading.
    line_offset is the absolute line number of the first line of inner.
    """
    children: dict[str, Component] = {}
    lines = inner.split("\n")

    # Collect heading positions
    heading_positions: list[tuple[int, str]] = []
    for i, line in enumerate(lines):
        m = _HEADING_RE.match(line)
        if m:
            heading_positions.append((i, m.group(1).strip()))

    for idx, (start_line, title) in enumerate(heading_positions):
        end_line = (
            heading_positions[idx + 1][0] - 1
            if idx + 1 < len(heading_positions)
            else len(lines) - 1
        )
        block_lines = lines[start_line : end_line + 1]
        raw = "\n".join(block_lines)
        norm = _normalize(raw)
        child_id = f"{parent_id}/{title}"
        child_path = parent_path + [title]
        children[child_id] = Component(
            id=child_id,
            kind="context_block",
            title=title,
            path=child_path,
            raw=raw,
            normalized=norm,
            hash=_hash(norm),
            line_start=line_offset + start_line,
            line_end=line_offset + end_line,
        )

    return children


# ── Public extractor ──────────────────────────────────────────────────────────

def _tag_key(tag: str) -> str:
    """Convert an XML tag name to a snake_case component key."""
    return tag.replace("-", "_")


def extract_user_message(
    section: MarkdownSection,
    diagnostics: list[Diagnostic],
) -> Component:
    """
    Build the top-level ``user_message`` Component from a MarkdownSection.

    Children produced:
    - One child per distinct XML tag type found in the section, indexed by
      occurrence: ``user_message/<tag_key>/0``, ``/1``, …
      For ``system-reminder`` spans, ``## <title>`` headings inside the span's
      inner text become ``kind="context_block"`` sub-children.
    - ``user_message/actual_prompt`` — section body with all XML-span ranges removed.
    """
    base_id = "user_message"
    base_path = ["User Message"]
    children: dict[str, Component] = {}

    # ── XML tag children (all tags, grouped by tag name) ──────────────────────
    tag_counters: dict[str, int] = {}
    for span in section.xml_spans:
        key = _tag_key(span.tag)
        i = tag_counters.get(key, 0)
        tag_counters[key] = i + 1

        child_id = f"{base_id}/{key}/{i}"
        child_path = base_path + [key, str(i)]

        # For system-reminder spans, extract ## headings as context_block children
        sub_children: dict[str, Component] = {}
        if span.tag == "system-reminder":
            inner_line_offset = span.line_start + 1
            sub_children = _build_context_block_children(
                parent_id=child_id,
                parent_path=child_path,
                inner=span.inner,
                line_offset=inner_line_offset,
            )

        norm = _normalize(span.raw)
        children[child_id] = Component(
            id=child_id,
            kind=key,
            title=f"{key}_{i}",
            path=child_path,
            raw=span.raw,
            normalized=norm,
            hash=_hash(norm),
            line_start=span.line_start,
            line_end=span.line_end,
            children=sub_children,
        )

    # ── Actual-prompt child ────────────────────────────────────────────────────
    # Build a set of (start, end) line ranges for all XML spans so we can excise them.
    span_line_ranges = {
        (span.line_start, span.line_end) for span in section.xml_spans
    }

    body_lines = section.body.split("\n")
    # line numbers in body are relative; section.line_start is the heading line,
    # so body starts at line_start + 1.
    body_offset = section.line_start + 1
    kept_lines: list[str] = []
    for rel_idx, line in enumerate(body_lines):
        abs_line = body_offset + rel_idx
        # Exclude lines that fall within any XML span
        in_span = any(start <= abs_line <= end for start, end in span_line_ranges)
        if not in_span:
            kept_lines.append(line)

    actual_prompt_text = "\n".join(kept_lines).strip()

    if not actual_prompt_text:
        diagnostics.append(
            Diagnostic(
                level="info",
                code="empty_actual_prompt",
                message="The user message contains no text outside of XML spans.",
                line=section.line_start,
            )
        )

    prompt_id = f"{base_id}/actual_prompt"
    norm_prompt = _normalize(actual_prompt_text)
    children[prompt_id] = Component(
        id=prompt_id,
        kind="actual_prompt",
        title="Actual Prompt",
        path=base_path + ["actual_prompt"],
        raw=actual_prompt_text,
        normalized=norm_prompt,
        hash=_hash(norm_prompt),
        line_start=section.line_start,
        line_end=section.line_end,
    )

    # ── Top-level component ────────────────────────────────────────────────────
    norm_section = _normalize(section.raw)
    return Component(
        id=base_id,
        kind="user_message",
        title="User Message",
        path=base_path,
        raw=section.raw,
        normalized=norm_section,
        hash=_hash(norm_section),
        line_start=section.line_start,
        line_end=section.line_end,
        children=children,
    )
