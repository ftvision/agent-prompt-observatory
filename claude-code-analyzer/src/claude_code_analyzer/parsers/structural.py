"""Layer 2: Structural parser.

Maps the markdown section tree produced by Layer 1 into the three known
top-level components of a Claude Code prompt capture.
"""

from __future__ import annotations

import re
import sys

from ..models import MarkdownDoc, MarkdownSection, StructuralRegions

# Regex patterns
_VERSION_RE = re.compile(r"^#\s+Claude Code Version\s+(.+)", re.MULTILINE)
_VERSION_TITLE_RE = re.compile(r"^Claude Code Version\s+(.+)$")
_RELEASE_DATE_RE = re.compile(r"Release Date:\s*(.+)")

# Known top-level component titles
_KNOWN_TITLES = {"User Message", "System Prompt", "Tools"}


def _extract_version(preamble: str, sections: list[MarkdownSection]) -> tuple[str, str]:
    """Return (version, release_date) extracted from the preamble or version section.

    Falls back to empty strings when information is not found.
    """
    version = ""
    release_date = ""
    search_text = preamble

    # Try to find version in preamble first (inline heading syntax: `# Claude Code Version …`)
    m = _VERSION_RE.search(preamble)
    if m:
        version = m.group(1).strip()
    elif sections:
        # Check the first section's title for the version heading pattern
        first = sections[0]
        m2 = _VERSION_TITLE_RE.match(first.title)
        if m2:
            version = m2.group(1).strip()
            # Use that section's body as the text to scan for release date
            search_text = first.body

    # Extract release date from whichever text we identified above
    rd = _RELEASE_DATE_RE.search(search_text)
    if rd:
        release_date = rd.group(1).strip()

    return version, release_date


def parse_structural(doc: MarkdownDoc) -> StructuralRegions:
    """Map a *MarkdownDoc* into a *StructuralRegions* instance.

    Top-level headings are classified as one of the three known components
    (User Message, System Prompt, Tools) or collected in ``unknown``.
    The version heading (``Claude Code Version …``) is silently skipped.
    """
    version, release_date = _extract_version(doc.preamble, doc.sections)

    user_message: MarkdownSection | None = None
    system_prompt: MarkdownSection | None = None
    tools: MarkdownSection | None = None
    unknown: list[MarkdownSection] = []

    for section in doc.sections:
        title = section.title

        # Skip the version heading — it is metadata, not a component
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
        elif title == "System Prompt":
            if system_prompt is None:
                system_prompt = section
            else:
                print(
                    f"structural: duplicate 'System Prompt' section at line "
                    f"{section.line_start}; keeping the first occurrence.",
                    file=sys.stderr,
                )
        elif title == "Tools":
            if tools is None:
                tools = section
            else:
                print(
                    f"structural: duplicate 'Tools' section at line "
                    f"{section.line_start}; keeping the first occurrence.",
                    file=sys.stderr,
                )
        else:
            unknown.append(section)

    return StructuralRegions(
        version=version,
        release_date=release_date,
        user_message=user_message,
        system_prompt=system_prompt,
        tools=tools,
        unknown=unknown,
    )
