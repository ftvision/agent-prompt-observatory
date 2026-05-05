"""Structural diagnostics across a set of version snapshots."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from .models import Snapshot


# Reserved top-level slugs that are NOT iterated as h1 section groups
# (they have their own dedicated handling).
_RESERVED_SLUGS = {"user_message", "tools"}


# ── Structural fingerprint ────────────────────────────────────────────────────

@dataclass
class VersionStructure:
    version: str
    xml_tags: set[str]                          # kinds in user_message (excluding actual_prompt)
    h1_subsections: dict[str, list[str]]        # slug -> ordered H2 child titles
    tools: list[str]                            # tool titles, in order
    parse_warnings: list[str]                   # diagnostic messages at warning/error level


def _extract_structure(snap: Snapshot) -> VersionStructure:
    xml_tags: set[str] = set()
    um = snap.components.get("user_message")
    if um:
        for child in um.children.values():
            if child.kind != "actual_prompt":
                xml_tags.add(child.kind)

    h1_subsections: dict[str, list[str]] = {}
    for slug, comp in snap.components.items():
        if slug in _RESERVED_SLUGS:
            continue
        h1_subsections[slug] = [c.title for c in comp.children.values()]

    tools: list[str] = []
    tc = snap.components.get("tools")
    if tc:
        tools = [c.title for c in tc.children.values() if c.kind == "tool"]

    warnings = [
        f"[{d.code}] {d.message}"
        for d in snap.diagnostics
        if d.level in ("warning", "error")
    ]

    return VersionStructure(snap.version, xml_tags, h1_subsections, tools, warnings)


# ── Per-version diff ──────────────────────────────────────────────────────────

@dataclass
class StructuralDiff:
    version: str
    added_xml_tags: list[str]
    removed_xml_tags: list[str]
    added_h1_sections: list[str]                # slugs newly present
    removed_h1_sections: list[str]              # slugs newly absent
    added_subsections: dict[str, list[str]]     # slug -> titles added under that H1
    removed_subsections: dict[str, list[str]]   # slug -> titles removed from that H1
    reordered_h1s: list[str]                    # slugs whose subsection order changed
    added_tools: list[str]
    removed_tools: list[str]
    reordered_tools: bool
    parse_warnings: list[str]

    def is_clean(self) -> bool:
        return not any([
            self.added_xml_tags, self.removed_xml_tags,
            self.added_h1_sections, self.removed_h1_sections,
            self.added_subsections, self.removed_subsections,
            self.reordered_h1s,
            self.added_tools, self.removed_tools,
            self.reordered_tools,
            self.parse_warnings,
        ])


def _diff(prev: VersionStructure, curr: VersionStructure) -> StructuralDiff:
    prev_xml = prev.xml_tags
    curr_xml = curr.xml_tags

    prev_h1s = set(prev.h1_subsections)
    curr_h1s = set(curr.h1_subsections)
    added_h1s = sorted(curr_h1s - prev_h1s)
    removed_h1s = sorted(prev_h1s - curr_h1s)

    added_subs: dict[str, list[str]] = {}
    removed_subs: dict[str, list[str]] = {}
    reordered: list[str] = []
    for slug in curr_h1s & prev_h1s:
        prev_titles = prev.h1_subsections[slug]
        curr_titles = curr.h1_subsections[slug]
        prev_set = set(prev_titles)
        curr_set = set(curr_titles)
        added = sorted(curr_set - prev_set)
        removed = sorted(prev_set - curr_set)
        if added:
            added_subs[slug] = added
        if removed:
            removed_subs[slug] = removed
        if prev_set == curr_set and prev_titles != curr_titles:
            reordered.append(slug)

    prev_tools = set(prev.tools)
    curr_tools = set(curr.tools)
    tools_reordered = (
        prev.tools != curr.tools
        and prev_tools == curr_tools
    )

    prev_w = set(prev.parse_warnings)
    curr_w = set(curr.parse_warnings)
    new_warnings = sorted(curr_w - prev_w)

    return StructuralDiff(
        version=curr.version,
        added_xml_tags=sorted(curr_xml - prev_xml),
        removed_xml_tags=sorted(prev_xml - curr_xml),
        added_h1_sections=added_h1s,
        removed_h1_sections=removed_h1s,
        added_subsections=added_subs,
        removed_subsections=removed_subs,
        reordered_h1s=reordered,
        added_tools=sorted(curr_tools - prev_tools),
        removed_tools=sorted(prev_tools - curr_tools),
        reordered_tools=tools_reordered,
        parse_warnings=new_warnings,
    )


# ── Timeline summary ──────────────────────────────────────────────────────────

@dataclass
class TimelineEntry:
    first_seen: str
    last_seen: str
    count: int
    total: int

    @property
    def present_pct(self) -> float:
        return 100 * self.count / self.total if self.total else 0.0


def _build_timeline(
    structures: list[VersionStructure],
    getter: Callable[[VersionStructure], list[str] | set[str]],
) -> dict[str, TimelineEntry]:
    appearances: dict[str, list[str]] = defaultdict(list)
    for s in structures:
        for item in getter(s):
            appearances[item].append(s.version)
    total = len(structures)
    return {
        name: TimelineEntry(
            first_seen=versions[0],
            last_seen=versions[-1],
            count=len(versions),
            total=total,
        )
        for name, versions in appearances.items()
    }


# ── Version sort key ──────────────────────────────────────────────────────────

def _version_key(path: Path) -> tuple[int, ...]:
    try:
        return tuple(int(p) for p in path.stem.split("."))
    except ValueError:
        return (0,)


# ── Public entry points ───────────────────────────────────────────────────────

def run_diagnose(
    raw_dir: Path,
    parse_fn: Callable[[str], Snapshot],
    *,
    since: str | None = None,
    only_changes: bool = False,
    show_summary: bool = True,
) -> None:
    md_files = sorted(raw_dir.glob("*.md"), key=_version_key)
    if not md_files:
        print(f"No .md files found in {raw_dir}")
        return

    print(f"Parsing {len(md_files)} versions…", flush=True)
    structures: list[VersionStructure] = []
    for f in md_files:
        snap = parse_fn(str(f))
        structures.append(_extract_structure(snap))
    print()

    since_idx = 0
    if since:
        for i, s in enumerate(structures):
            if s.version == since:
                since_idx = i
                break
        else:
            print(f"Warning: version '{since}' not found; showing all changes.")

    diffs: list[StructuralDiff] = []
    for i in range(1, len(structures)):
        diff = _diff(structures[i - 1], structures[i])
        if i >= since_idx:
            diffs.append(diff)

    print("=== STRUCTURAL CHANGES ===")
    any_printed = False
    for diff in diffs:
        if only_changes and diff.is_clean():
            continue
        lines: list[str] = []
        if diff.added_xml_tags:
            lines.append(f"  [user_message] +xml_tag: {', '.join(diff.added_xml_tags)}")
        if diff.removed_xml_tags:
            lines.append(f"  [user_message] -xml_tag: {', '.join(diff.removed_xml_tags)}")
        if diff.added_h1_sections:
            lines.append(f"  [structure] +H1 section: {', '.join(diff.added_h1_sections)}")
        if diff.removed_h1_sections:
            lines.append(f"  [structure] -H1 section: {', '.join(diff.removed_h1_sections)}")
        for slug, added in diff.added_subsections.items():
            lines.append(f"  [{slug}] +subsection: {', '.join(added)}")
        for slug, removed in diff.removed_subsections.items():
            lines.append(f"  [{slug}] -subsection: {', '.join(removed)}")
        for slug in diff.reordered_h1s:
            lines.append(f"  [{slug}] subsections reordered")
        if diff.added_tools:
            lines.append(f"  [tools] +tool: {', '.join(diff.added_tools)}")
        if diff.removed_tools:
            lines.append(f"  [tools] -tool: {', '.join(diff.removed_tools)}")
        if diff.reordered_tools:
            lines.append(f"  [tools] tools reordered")
        if diff.parse_warnings:
            for w in diff.parse_warnings:
                lines.append(f"  [parse] {w}")
        if lines:
            print(f"\n{diff.version}:")
            for l in lines:
                print(l)
            any_printed = True
    if not any_printed:
        print("  (no structural changes detected)")

    if not show_summary:
        return

    print("\n=== XML TAGS ===")
    tl = _build_timeline(structures, lambda s: s.xml_tags)
    for name, e in sorted(tl.items(), key=lambda x: x[1].first_seen):
        print(f"  {name:40s}  first={e.first_seen}  last={e.last_seen}  {e.count}/{e.total} versions ({e.present_pct:.0f}%)")

    print("\n=== H1 SECTIONS ===")
    tl = _build_timeline(structures, lambda s: list(s.h1_subsections.keys()))
    for name, e in sorted(tl.items(), key=lambda x: x[1].first_seen):
        print(f"  {name:40s}  first={e.first_seen}  last={e.last_seen}  {e.count}/{e.total} versions ({e.present_pct:.0f}%)")

    print("\n=== ALL SUBSECTIONS (across H1 groups) ===")
    def all_subs(s: VersionStructure) -> list[str]:
        return [t for titles in s.h1_subsections.values() for t in titles]
    tl = _build_timeline(structures, all_subs)
    for name, e in sorted(tl.items(), key=lambda x: x[1].first_seen):
        print(f"  {name:40s}  first={e.first_seen}  last={e.last_seen}  {e.count}/{e.total} versions ({e.present_pct:.0f}%)")

    print("\n=== TOOLS ===")
    tl = _build_timeline(structures, lambda s: s.tools)
    for name, e in sorted(tl.items(), key=lambda x: x[1].first_seen):
        print(f"  {name:40s}  first={e.first_seen}  last={e.last_seen}  {e.count}/{e.total} versions ({e.present_pct:.0f}%)")
