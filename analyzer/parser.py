"""Parse markdown into section trees with units, preserving raw text and char offsets."""
from __future__ import annotations

import hashlib
import re
from typing import Any

SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9`<])")
WHITESPACE_RE = re.compile(r"\s+")
NORMALIZATION_RULES = [
    (
        re.compile(r"/tmp/claude-history-[A-Za-z0-9._-]+"),
        "/tmp/claude-history-<SESSION>",
    ),
    (
        re.compile(r"/root/.claude/projects/[A-Za-z0-9._/-]+/memory/"),
        "/root/.claude/projects/<PROJECT>/memory/",
    ),
    (
        re.compile(r"/Users/[A-Za-z0-9._-]+/.claude/projects/[A-Za-z0-9._/-]+/memory/"),
        "/Users/<USER>/.claude/projects/<PROJECT>/memory/",
    ),
]

VOLATILE_SECTION_PATHS = {
    "User Message / currentDate",
}


def stable_id(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def normalize_unit(text: str) -> str:
    cleaned = WHITESPACE_RE.sub(" ", text.strip())
    cleaned = re.sub(r"^[-*+]\s+", "", cleaned)
    cleaned = re.sub(r"^\d+\.\s+", "", cleaned)
    for pattern, replacement in NORMALIZATION_RULES:
        cleaned = pattern.sub(replacement, cleaned)
    return cleaned


def is_meaningful_unit(text: str) -> bool:
    alpha_words = re.findall(r"[A-Za-z]{3,}", text)
    if len(alpha_words) < 4:
        return False
    if text.startswith(("```", "<", "#")):
        return False
    if text.count("`") > 8:
        return False
    return len(text) >= 30


def split_into_units(lines: list[str], base_offset: int = 0) -> list[dict[str, Any]]:
    """Split body lines into units, preserving raw text and char offsets."""
    units: list[dict[str, Any]] = []
    paragraph: list[str] = []
    paragraph_start: int = base_offset
    current_offset: int = base_offset
    in_code_block = False

    def flush_paragraph() -> None:
        nonlocal paragraph, paragraph_start
        if not paragraph:
            return
        raw_text = "\n".join(paragraph)
        text = normalize_unit(" ".join(paragraph))
        paragraph = []
        if not text:
            return
        parts = SENTENCE_SPLIT_RE.split(text)
        for part in parts:
            normalized = normalize_unit(part)
            if normalized:
                units.append({
                    "id": stable_id(normalized),
                    "text": normalized,
                    "raw_text": raw_text,
                    "char_offset_start": paragraph_start,
                    "char_offset_end": paragraph_start + len(raw_text),
                })

    for raw_line in lines:
        line = raw_line.rstrip()
        stripped = line.strip()
        line_len = len(raw_line) + 1  # +1 for newline

        if stripped.startswith("```"):
            flush_paragraph()
            in_code_block = not in_code_block
            units.append({
                "id": stable_id(stripped),
                "text": stripped,
                "raw_text": raw_line,
                "char_offset_start": current_offset,
                "char_offset_end": current_offset + line_len,
            })
            current_offset += line_len
            continue

        if in_code_block:
            if stripped:
                units.append({
                    "id": stable_id(stripped),
                    "text": stripped,
                    "raw_text": raw_line,
                    "char_offset_start": current_offset,
                    "char_offset_end": current_offset + line_len,
                })
            current_offset += line_len
            continue

        if not stripped:
            flush_paragraph()
            paragraph_start = current_offset + line_len
            current_offset += line_len
            continue

        if stripped.startswith(("- ", "* ", "+ ")) or re.match(r"^\d+\.\s+", stripped):
            flush_paragraph()
            normalized = normalize_unit(stripped)
            if normalized:
                units.append({
                    "id": stable_id(normalized),
                    "text": normalized,
                    "raw_text": raw_line,
                    "char_offset_start": current_offset,
                    "char_offset_end": current_offset + line_len,
                })
            paragraph_start = current_offset + line_len
            current_offset += line_len
            continue

        if stripped.startswith("<") and stripped.endswith(">") and len(stripped.split()) == 1:
            flush_paragraph()
            units.append({
                "id": stable_id(stripped),
                "text": stripped,
                "raw_text": raw_line,
                "char_offset_start": current_offset,
                "char_offset_end": current_offset + line_len,
            })
            paragraph_start = current_offset + line_len
            current_offset += line_len
            continue

        if not paragraph:
            paragraph_start = current_offset
        paragraph.append(stripped)
        current_offset += line_len

    flush_paragraph()
    return units


def parse_prompt_markdown(markdown: str, version: str = "unknown") -> dict[str, Any]:
    """Parse a prompt markdown file into a structured representation.

    Returns a dict with version info, sections, and unit index.
    """
    lines = markdown.splitlines()
    version_match = re.match(r"# Claude Code Version (.+)", lines[0].strip()) if lines else None
    detected_version = version_match.group(1) if version_match else version
    release_date = ""

    sections: list[dict[str, Any]] = []
    current_h1_title: str | None = None
    current_h2_title: str | None = None
    current_body_lines: list[str] = []
    current_body_start: int = 0
    char_offset = 0

    def flush_section() -> None:
        nonlocal current_body_lines
        if current_h1_title is None and not current_body_lines:
            return
        h1 = current_h1_title or "_root"
        h2 = current_h2_title or ""
        path = f"{h1} / {h2}" if h2 else h1
        body_raw = "\n".join(current_body_lines)
        units = split_into_units(current_body_lines, current_body_start)
        sections.append({
            "title": h2 or h1,
            "path": path,
            "h1": h1,
            "h2": h2,
            "body_raw": body_raw,
            "raw_markdown": body_raw,
            "units": units,
            "unit_count": len(units),
        })
        current_body_lines = []

    for line in lines:
        stripped = line.strip()
        line_len = len(line) + 1

        if stripped.startswith("Release Date:"):
            release_date = stripped.split(":", 1)[1].strip()
            char_offset += line_len
            continue

        if stripped.startswith("# ") and not stripped.startswith("## "):
            if stripped == lines[0].strip():
                char_offset += line_len
                continue
            flush_section()
            current_h1_title = stripped[2:].strip()
            current_h2_title = None
            current_body_start = char_offset + line_len
            char_offset += line_len
            continue

        if stripped.startswith("## "):
            flush_section()
            if current_h1_title is None:
                current_h1_title = "_root"
            current_h2_title = stripped[3:].strip()
            current_body_start = char_offset + line_len
            char_offset += line_len
            continue

        current_body_lines.append(line)
        char_offset += line_len

    flush_section()

    # Build unit index
    unit_index = []
    for section in sections:
        for unit in section["units"]:
            unit_index.append({
                **unit,
                "section_path": section["path"],
            })

    return {
        "version": detected_version,
        "release_date": release_date,
        "raw_markdown": markdown,
        "sections": sections,
        "unit_index": unit_index,
        "total_chars": len(markdown),
    }
