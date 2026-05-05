"""Layer 2: Structural parser.

Maps the markdown section tree produced by Layer 1 into top-level regions.

The two reserved H1s (``User Message`` and ``Tools``) have dedicated
extractors and live in their own slots on :class:`StructuralRegions`. Every
other H1 — System Prompt, Executing actions with care, Text output …, or any
future addition — is a generic "h1 section" parsed via the same extractor
and stored in ``h1_sections`` keyed by a stable slug derived from its title.
"""

from __future__ import annotations

import re
import sys

from ..models import MarkdownDoc, MarkdownSection, StructuralRegions

_VERSION_RE = re.compile(r"^#\s+Claude Code Version\s+(.+)", re.MULTILINE)
_VERSION_TITLE_RE = re.compile(r"^Claude Code Version\s+(.+)$")
_RELEASE_DATE_RE = re.compile(r"Release Date:\s*(.+)")

RESERVED_H1_TITLES = {"User Message", "Tools"}


def slugify_h1(title: str) -> str:
    """Stable slug for an H1 title.

    Lowercased; runs of non-alphanumeric characters become a single underscore;
    leading/trailing underscores stripped. ``"Text output (does not apply to
    tool calls)"`` → ``"text_output_does_not_apply_to_tool_calls"``.
    """
    slug = re.sub(r"[^0-9a-zA-Z]+", "_", title.lower()).strip("_")
    return slug or "section"


def _extract_version(preamble: str, sections: list[MarkdownSection]) -> tuple[str, str]:
    """Return (version, release_date) from the preamble or a top-level version section."""
    version = ""
    release_date = ""
    search_text = preamble

    m = _VERSION_RE.search(preamble)
    if m:
        version = m.group(1).strip()
    elif sections:
        first = sections[0]
        m2 = _VERSION_TITLE_RE.match(first.title)
        if m2:
            version = m2.group(1).strip()
            search_text = first.body

    rd = _RELEASE_DATE_RE.search(search_text)
    if rd:
        release_date = rd.group(1).strip()

    return version, release_date


def parse_structural(doc: MarkdownDoc) -> StructuralRegions:
    """Map a *MarkdownDoc* into a *StructuralRegions* instance.

    User Message and Tools land in their dedicated slots. Every other H1
    becomes an entry in ``h1_sections`` (slug-keyed, insertion-ordered to
    preserve document order). The ``Claude Code Version …`` heading is
    silently skipped.
    """
    version, release_date = _extract_version(doc.preamble, doc.sections)

    user_message: MarkdownSection | None = None
    tools: MarkdownSection | None = None
    h1_sections: dict[str, MarkdownSection] = {}

    for section in doc.sections:
        title = section.title

        if _VERSION_TITLE_RE.match(title):
            continue

        if title == "User Message":
            if user_message is None:
                user_message = section
            else:
                print(
                    f"structural: duplicate 'User Message' section at line "
                    f"{section.line_start}; keeping the first occurrence.",
                    file=sys.stderr,
                )
            continue

        if title == "Tools":
            if tools is None:
                tools = section
            else:
                print(
                    f"structural: duplicate 'Tools' section at line "
                    f"{section.line_start}; keeping the first occurrence.",
                    file=sys.stderr,
                )
            continue

        slug = slugify_h1(title)
        if slug in h1_sections:
            print(
                f"structural: duplicate H1 section '{title}' (slug '{slug}') "
                f"at line {section.line_start}; keeping the first occurrence.",
                file=sys.stderr,
            )
            continue
        h1_sections[slug] = section

    return StructuralRegions(
        version=version,
        release_date=release_date,
        user_message=user_message,
        tools=tools,
        h1_sections=h1_sections,
    )
