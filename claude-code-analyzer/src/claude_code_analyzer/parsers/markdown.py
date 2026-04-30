"""Layer 1: Generic, XML-aware Markdown block parser.

Public API
----------
    parse_markdown(text: str) -> MarkdownDoc
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..models import XmlSpan, MarkdownSection, MarkdownDoc


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_HEADING_RE = re.compile(r'^(#{1,6})\s+(.+)')
_FENCE_RE = re.compile(r'^(```|~~~)')

# Match an opening XML-like tag.  We capture the tag name so we can build
# the corresponding closing-tag pattern on demand.
_OPEN_TAG_RE = re.compile(r'<(\w[\w-]*)>')


def _find_xml_spans(lines: list[str]) -> list[tuple[int, int, XmlSpan]]:
    """Return all paired XML spans found in *lines*.

    Returns a list of ``(line_start, line_end, XmlSpan)`` tuples where
    ``line_start`` and ``line_end`` are **1-based** inclusive line numbers.

    Algorithm
    ---------
    * Scan the full joined text for opening tags.
    * For each opening tag (outermost first — i.e. skip positions that are
      already inside a recorded span of the same tag), search forward for the
      matching closing tag.
    * Record the span; skip any later opening tags of the same name that fall
      inside this span (handles "nested same-name" rule: match outermost pair).
    """
    full_text = "\n".join(lines)

    # Build a mapping: character offset → 1-based line number.
    # We accumulate the line length (+1 for the newline we joined with).
    char_to_line: list[int] = []
    for lineno, line in enumerate(lines, start=1):
        char_to_line.extend([lineno] * (len(line) + 1))  # +1 for '\n'
    # The very last newline we added doesn't exist in the original; trim to the
    # actual text length to avoid index errors.
    char_to_line = char_to_line[: len(full_text)]

    def offset_to_line(offset: int) -> int:
        if offset >= len(char_to_line):
            return len(lines)
        return char_to_line[offset]

    spans: list[tuple[int, int, XmlSpan]] = []
    # Track which character ranges are already "consumed" as outermost spans
    # keyed by tag name, so we honour the outermost-pair rule.
    consumed_ranges: list[tuple[int, int]] = []

    for m in _OPEN_TAG_RE.finditer(full_text):
        tag = m.group(1)
        open_start = m.start()
        open_end = m.end()  # position right after '>'

        # Skip if this open tag falls inside an already-recorded span.
        if any(s <= open_start < e for s, e in consumed_ranges):
            continue

        # Find the matching close tag, respecting nesting of same-name tags
        # (outermost-pair rule: depth starts at 1 and we wait until it hits 0).
        open_pattern = re.compile(r'<' + re.escape(tag) + r'(?:\s|>)')
        close_pattern = re.compile(r'</' + re.escape(tag) + r'>')

        depth = 1
        search_pos = open_end
        cm = None
        while depth > 0:
            next_open = open_pattern.search(full_text, search_pos)
            next_close = close_pattern.search(full_text, search_pos)
            if next_close is None:
                break  # Unclosed — treat as plain text.
            if next_open is not None and next_open.start() < next_close.start():
                depth += 1
                search_pos = next_open.end()
            else:
                depth -= 1
                if depth == 0:
                    cm = next_close
                else:
                    search_pos = next_close.end()

        if cm is None:
            # Unclosed tag — treat as plain text.
            continue

        close_end = cm.end()  # position right after closing '>'
        raw = full_text[open_start:close_end]
        inner = full_text[open_end:cm.start()]

        line_start = offset_to_line(open_start)
        line_end = offset_to_line(close_end - 1)

        span = XmlSpan(
            tag=tag,
            raw=raw,
            inner=inner,
            line_start=line_start,
            line_end=line_end,
        )
        spans.append((line_start, line_end, span))
        consumed_ranges.append((open_start, close_end))

    return spans


def _line_in_xml_span(
    lineno: int, xml_spans: list[tuple[int, int, XmlSpan]]
) -> bool:
    """Return True if *lineno* (1-based) falls inside any XML span."""
    return any(s <= lineno <= e for s, e, _ in xml_spans)


# ---------------------------------------------------------------------------
# Heading scan
# ---------------------------------------------------------------------------

@dataclass
class _HeadingEntry:
    level: int
    title: str
    line_start: int  # 1-based line number of the heading line


def _scan_headings(
    lines: list[str],
    xml_spans: list[tuple[int, int, XmlSpan]],
) -> list[_HeadingEntry]:
    """Walk lines and return heading entries, skipping XML spans and fences."""
    headings: list[_HeadingEntry] = []
    in_fence = False

    for i, line in enumerate(lines):
        lineno = i + 1  # 1-based

        # Toggle fence state (code fences are checked independently of XML).
        if _FENCE_RE.match(line):
            in_fence = not in_fence

        if in_fence:
            # Lines inside the fence (after the opening fence line) are skipped.
            # But we need to *toggle* on the opening line before skipping, so
            # we only skip when in_fence was already True *before* this line or
            # we just entered (the fence line itself is not a heading anyway).
            continue

        # Skip lines that are inside an XML span.
        if _line_in_xml_span(lineno, xml_spans):
            continue

        m = _HEADING_RE.match(line)
        if m:
            headings.append(_HeadingEntry(
                level=len(m.group(1)),
                title=m.group(2).strip(),
                line_start=lineno,
            ))

    return headings


# ---------------------------------------------------------------------------
# Section tree builder
# ---------------------------------------------------------------------------

def _build_sections(
    lines: list[str],
    headings: list[_HeadingEntry],
    xml_spans: list[tuple[int, int, XmlSpan]],
) -> tuple[str, list[MarkdownSection]]:
    """Build the MarkdownSection tree from a flat heading list.

    Returns ``(preamble, top_level_sections)``.
    """
    total_lines = len(lines)

    if not headings:
        preamble = "\n".join(lines)
        return preamble, []

    # Preamble: lines before the first heading (0-based indices 0..line_start-2).
    first_heading_line = headings[0].line_start  # 1-based
    preamble_lines = lines[: first_heading_line - 1]
    preamble = "\n".join(preamble_lines)

    # Assign each heading its line_end: the line before the next heading of
    # equal-or-lesser level, or end-of-file.
    # We do this by working through the flat list and using a stack.

    # First pass: assign raw line_end for each heading (end of its entire subtree).
    # heading i ends just before heading j where j is the next heading whose
    # level <= heading[i].level.
    heading_end: list[int] = [0] * len(headings)
    for i, h in enumerate(headings):
        # Find the next heading that closes this one.
        end_line = total_lines  # default: end of file
        for j in range(i + 1, len(headings)):
            if headings[j].level <= h.level:
                end_line = headings[j].line_start - 1
                break
        heading_end[i] = end_line

    # Second pass: build MarkdownSection objects (flat list first).
    flat: list[MarkdownSection] = []
    for i, h in enumerate(headings):
        line_start = h.line_start
        line_end = heading_end[i]

        raw_lines = lines[line_start - 1: line_end]
        raw = "\n".join(raw_lines)

        # body: from heading line to just before the first child heading.
        body_end_line = line_end  # default: same as section end
        for j in range(i + 1, len(headings)):
            if headings[j].level > h.level and headings[j].line_start <= line_end:
                body_end_line = headings[j].line_start - 1
                break

        body_lines = lines[line_start - 1: body_end_line]
        body = "\n".join(body_lines)

        # XML spans that fall entirely within the body of this section
        # (i.e. within [line_start, body_end_line]) but are NOT inside a
        # child section's range.
        section_xml: list[XmlSpan] = []
        for xs_start, xs_end, xs in xml_spans:
            if xs_start >= line_start and xs_end <= body_end_line:
                section_xml.append(xs)

        flat.append(MarkdownSection(
            level=h.level,
            title=h.title,
            raw=raw,
            body=body,
            line_start=line_start,
            line_end=line_end,
            children=[],
            xml_spans=section_xml,
        ))

    # Third pass: nest sections using a stack.
    # Stack holds indices into `flat` of "open" ancestor sections.
    root_sections: list[MarkdownSection] = []
    stack: list[int] = []  # indices into flat

    for i, section in enumerate(flat):
        # Pop stack entries that are at the same or deeper level.
        while stack and flat[stack[-1]].level >= section.level:
            stack.pop()

        if stack:
            flat[stack[-1]].children.append(section)
        else:
            root_sections.append(section)

        stack.append(i)

    return preamble, root_sections


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def parse_markdown(text: str) -> MarkdownDoc:
    """Parse *text* as Markdown and return a :class:`MarkdownDoc`.

    The parser is XML-aware: headings that appear inside paired XML tags are
    not treated as structural headings but are attached as ``xml_spans`` on
    the enclosing section.  Headings inside fenced code blocks are also
    ignored.
    """
    lines = text.splitlines()

    xml_spans = _find_xml_spans(lines)
    headings = _scan_headings(lines, xml_spans)
    preamble, sections = _build_sections(lines, headings, xml_spans)

    return MarkdownDoc(raw=text, preamble=preamble, sections=sections)
