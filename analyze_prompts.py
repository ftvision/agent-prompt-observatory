#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import ssl
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import urlopen


BASE_URL = "https://cchistory.mariozechner.at/data"
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9`<])")
WHITESPACE_RE = re.compile(r"\s+")
NORMALIZATION_RULES = [
    (
        re.compile(r"/tmp/claude-history-[A-Za-z0-9._-]+"),
        "/tmp/claude-history-<SESSION>",
    ),
    (
        re.compile(r"/root/.claude/projects/[A-Za-z0-9._-]+/memory/"),
        "/root/.claude/projects/<PROJECT>/memory/",
    ),
]
VOLATILE_SECTION_PATHS = {
    "User Message / currentDate",
}


SSL_CONTEXT = ssl._create_unverified_context()


@dataclass
class Node:
    title: str
    body_lines: list[str] = field(default_factory=list)
    subsections: dict[str, "Node"] = field(default_factory=dict)


def fetch_json(url: str) -> Any:
    with urlopen(url, context=SSL_CONTEXT) as response:
        return json.load(response)


def fetch_text(url: str) -> str:
    with urlopen(url, context=SSL_CONTEXT) as response:
        return response.read().decode("utf-8")


def normalize_unit(text: str) -> str:
    cleaned = WHITESPACE_RE.sub(" ", text.strip())
    cleaned = re.sub(r"^[-*+]\s+", "", cleaned)
    cleaned = re.sub(r"^\d+\.\s+", "", cleaned)
    for pattern, replacement in NORMALIZATION_RULES:
        cleaned = pattern.sub(replacement, cleaned)
    return cleaned


def stable_id(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def is_meaningful_unit(text: str) -> bool:
    alpha_words = re.findall(r"[A-Za-z]{3,}", text)
    if len(alpha_words) < 4:
        return False
    if text.startswith(("```", "<", "#")):
        return False
    if text.count("`") > 8:
        return False
    return len(text) >= 30


def split_into_units(lines: list[str]) -> list[str]:
    units: list[str] = []
    paragraph: list[str] = []
    in_code_block = False

    def flush_paragraph() -> None:
        nonlocal paragraph
        if not paragraph:
            return
        text = normalize_unit(" ".join(paragraph))
        paragraph = []
        if not text:
            return
        parts = SENTENCE_SPLIT_RE.split(text)
        for part in parts:
            normalized = normalize_unit(part)
            if normalized:
                units.append(normalized)

    for raw_line in lines:
        line = raw_line.rstrip()
        stripped = line.strip()

        if stripped.startswith("```"):
            flush_paragraph()
            in_code_block = not in_code_block
            units.append(stripped)
            continue

        if in_code_block:
            if stripped:
                units.append(stripped)
            continue

        if not stripped:
            flush_paragraph()
            continue

        if stripped.startswith(("- ", "* ", "+ ")) or re.match(r"^\d+\.\s+", stripped):
            flush_paragraph()
            normalized = normalize_unit(stripped)
            if normalized:
                units.append(normalized)
            continue

        if stripped.startswith("<") and stripped.endswith(">") and len(stripped.split()) == 1:
            flush_paragraph()
            units.append(stripped)
            continue

        paragraph.append(stripped)

    flush_paragraph()
    return units


def parse_prompt_markdown(markdown: str) -> dict[str, Any]:
    lines = markdown.splitlines()
    version_match = re.match(r"# Claude Code Version (.+)", lines[0].strip()) if lines else None
    release_date = ""
    sections: dict[str, Node] = {}
    current_h1: Node | None = None
    current_h2: Node | None = None

    for line in lines[1:]:
        stripped = line.strip()
        if stripped.startswith("Release Date:"):
            release_date = stripped.split(":", 1)[1].strip()
            continue
        if stripped.startswith("# "):
            title = stripped[2:].strip()
            current_h1 = sections.setdefault(title, Node(title=title))
            current_h2 = None
            continue
        if stripped.startswith("## "):
            if current_h1 is None:
                current_h1 = sections.setdefault("_root", Node(title="_root"))
            title = stripped[3:].strip()
            current_h2 = current_h1.subsections.setdefault(title, Node(title=title))
            continue

        target = current_h2 or current_h1
        if target is None:
            continue
        target.body_lines.append(line)

    h1_map: dict[str, Any] = {}
    h2_map: dict[str, Any] = {}
    unit_index: list[dict[str, str]] = []

    for h1_title, h1_node in sections.items():
        h1_units = split_into_units(h1_node.body_lines)
        h1_map[h1_title] = {
            "unit_count": len(h1_units),
            "units": [{"id": stable_id(unit), "text": unit} for unit in h1_units],
        }
        for unit in h1_units:
            unit_index.append(
                {
                    "path": h1_title,
                    "id": stable_id(unit),
                    "text": unit,
                }
            )

        for h2_title, h2_node in h1_node.subsections.items():
            path = f"{h1_title} / {h2_title}"
            h2_units = split_into_units(h2_node.body_lines)
            h2_map[path] = {
                "h1": h1_title,
                "h2": h2_title,
                "unit_count": len(h2_units),
                "units": [{"id": stable_id(unit), "text": unit} for unit in h2_units],
            }
            for unit in h2_units:
                unit_index.append(
                    {
                        "path": path,
                        "id": stable_id(unit),
                        "text": unit,
                    }
                )

    return {
        "version": version_match.group(1) if version_match else "unknown",
        "release_date": release_date,
        "h1_sections": h1_map,
        "h2_sections": h2_map,
        "unit_index": unit_index,
    }


def set_diff(before: set[str], after: set[str]) -> dict[str, list[str]]:
    return {
        "added": sorted(after - before),
        "removed": sorted(before - after),
        "shared": sorted(before & after),
    }


def unit_diff(before_units: list[dict[str, str]], after_units: list[dict[str, str]]) -> dict[str, Any]:
    before_map = {item["id"]: item["text"] for item in before_units}
    after_map = {item["id"]: item["text"] for item in after_units}
    added_ids = sorted(set(after_map) - set(before_map))
    removed_ids = sorted(set(before_map) - set(after_map))
    shared_ids = sorted(set(before_map) & set(after_map))
    return {
        "added_count": len(added_ids),
        "removed_count": len(removed_ids),
        "shared_count": len(shared_ids),
        "added_samples": [after_map[item_id] for item_id in added_ids[:3]],
        "removed_samples": [before_map[item_id] for item_id in removed_ids[:3]],
    }


def compare_versions(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    h1_before = set(before["h1_sections"])
    h1_after = set(after["h1_sections"])
    h2_before = set(before["h2_sections"])
    h2_after = set(after["h2_sections"])

    shared_h2 = sorted(h2_before & h2_after)
    section_changes = []
    total_added = 0
    total_removed = 0
    for path in shared_h2:
        diff = unit_diff(before["h2_sections"][path]["units"], after["h2_sections"][path]["units"])
        if path in VOLATILE_SECTION_PATHS:
            continue
        if diff["added_count"] or diff["removed_count"]:
            total_added += diff["added_count"]
            total_removed += diff["removed_count"]
            section_changes.append(
                {
                    "path": path,
                    **diff,
                }
            )

    section_changes.sort(key=lambda item: (item["added_count"] + item["removed_count"]), reverse=True)

    return {
        "from_version": before["version"],
        "to_version": after["version"],
        "h1": set_diff(h1_before, h1_after),
        "h2": set_diff(h2_before, h2_after),
        "section_unit_added_total": total_added,
        "section_unit_removed_total": total_removed,
        "changed_section_count": len(section_changes),
        "changed_sections": section_changes[:8],
    }


def find_global_duplicates(parsed_versions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sightings: dict[str, list[dict[str, str]]] = defaultdict(list)
    for version in parsed_versions:
        seen_paths_for_version: set[tuple[str, str]] = set()
        for unit in version["unit_index"]:
            if not is_meaningful_unit(unit["text"]):
                continue
            key = (unit["id"], unit["path"])
            if key in seen_paths_for_version:
                continue
            seen_paths_for_version.add(key)
            sightings[unit["id"]].append(
                {
                    "version": version["version"],
                    "path": unit["path"],
                    "text": unit["text"],
                }
            )

    duplicates = []
    for unit_id, items in sightings.items():
        unique_paths = {(item["version"], item["path"]) for item in items}
        if len(unique_paths) < 3:
            continue
        versions = sorted({item["version"] for item in items})
        paths = sorted({item["path"] for item in items})
        duplicates.append(
            {
                "unit_id": unit_id,
                "text": items[0]["text"],
                "version_count": len(versions),
                "path_count": len(paths),
                "versions": versions,
                "paths": paths,
            }
        )

    duplicates.sort(key=lambda item: (item["path_count"], item["version_count"]), reverse=True)
    return duplicates[:12]


def compute_section_presence(parsed_versions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    presence: dict[str, list[str]] = defaultdict(list)
    for version in parsed_versions:
        for path in version["h2_sections"]:
            presence[path].append(version["version"])

    rows = []
    for path, versions in presence.items():
        rows.append(
            {
                "path": path,
                "count": len(versions),
                "versions": versions,
            }
        )
    rows.sort(key=lambda item: (-item["count"], item["path"]))
    return rows


def build_summary(analysis: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append("# Latest 5 Prompt Prototype")
    lines.append("")
    lines.append("## Versions")
    lines.append("")
    for item in analysis["versions"]:
        lines.append(f"- `{item['version']}` ({item['release_date'] or 'unknown date'})")

    lines.append("")
    lines.append("## Consecutive Diffs")
    lines.append("")
    for diff in analysis["pairwise_diffs"]:
        lines.append(f"### `{diff['from_version']}` -> `{diff['to_version']}`")
        lines.append("")
        lines.append(
            f"- H1 added: {len(diff['h1']['added'])}, removed: {len(diff['h1']['removed'])}, shared: {len(diff['h1']['shared'])}"
        )
        lines.append(
            f"- H2 added: {len(diff['h2']['added'])}, removed: {len(diff['h2']['removed'])}, shared: {len(diff['h2']['shared'])}"
        )
        if diff["h2"]["added"]:
            lines.append(f"- H2 added names: {', '.join(f'`{name}`' for name in diff['h2']['added'][:6])}")
        if diff["h2"]["removed"]:
            lines.append(f"- H2 removed names: {', '.join(f'`{name}`' for name in diff['h2']['removed'][:6])}")
        if diff["changed_sections"]:
            top = diff["changed_sections"][0]
            lines.append(
                f"- Most changed H2: `{top['path']}` (+{top['added_count']} / -{top['removed_count']})"
            )
            if top["added_samples"]:
                lines.append(f"- Added sample: `{top['added_samples'][0]}`")
            if top["removed_samples"]:
                lines.append(f"- Removed sample: `{top['removed_samples'][0]}`")
        else:
            lines.append("- No H2 unit-level changes detected in shared sections")
        lines.append("")

    anchor = analysis["anchor_diff"]
    lines.append("## Window Anchor Diff")
    lines.append("")
    lines.append(f"`{anchor['from_version']}` -> `{anchor['to_version']}`")
    lines.append("")
    lines.append(
        f"- H1 added: {len(anchor['h1']['added'])}, removed: {len(anchor['h1']['removed'])}"
    )
    lines.append(
        f"- H2 added: {len(anchor['h2']['added'])}, removed: {len(anchor['h2']['removed'])}"
    )
    if anchor["h2"]["added"]:
        lines.append(f"- H2 added names: {', '.join(f'`{name}`' for name in anchor['h2']['added'][:8])}")
    if anchor["h2"]["removed"]:
        lines.append(f"- H2 removed names: {', '.join(f'`{name}`' for name in anchor['h2']['removed'][:8])}")
    for changed in anchor["changed_sections"][:5]:
        lines.append(
            f"- `{changed['path']}`: +{changed['added_count']} / -{changed['removed_count']}"
        )

    lines.append("")
    lines.append("## Stable H2 Sections")
    lines.append("")
    for row in analysis["section_presence"][:10]:
        if row["count"] == len(analysis["versions"]):
            lines.append(f"- `{row['path']}` appears in all 5 versions")

    lines.append("")
    lines.append("## Global Duplicate Units")
    lines.append("")
    for duplicate in analysis["global_duplicates"][:8]:
        lines.append(
            f"- `{duplicate['text'][:110]}` | versions={duplicate['version_count']} paths={duplicate['path_count']}"
        )

    return "\n".join(lines) + "\n"


def analyze_latest_versions(limit: int, output_dir: Path) -> dict[str, Any]:
    versions_payload = fetch_json(f"{BASE_URL}/versions.json")
    versions = [item["version"] for item in versions_payload["versions"]][-limit:]
    parsed_versions = []
    raw_dir = output_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    for version in versions:
        markdown = fetch_text(f"{BASE_URL}/prompts-{version}.md")
        (raw_dir / f"{version}.md").write_text(markdown, encoding="utf-8")
        parsed_versions.append(parse_prompt_markdown(markdown))

    pairwise_diffs = [
        compare_versions(parsed_versions[index], parsed_versions[index + 1])
        for index in range(len(parsed_versions) - 1)
    ]
    n_back_diffs = []
    for end_index in range(1, len(parsed_versions)):
        for lag in range(1, end_index + 1):
            diff = compare_versions(parsed_versions[end_index - lag], parsed_versions[end_index])
            diff["lag"] = lag
            n_back_diffs.append(diff)

    analysis = {
        "versions": [
            {
                "version": item["version"],
                "release_date": item["release_date"],
                "h1_count": len(item["h1_sections"]),
                "h2_count": len(item["h2_sections"]),
                "unit_count": len(item["unit_index"]),
            }
            for item in parsed_versions
        ],
        "pairwise_diffs": pairwise_diffs,
        "n_back_diffs": n_back_diffs,
        "anchor_diff": compare_versions(parsed_versions[0], parsed_versions[-1]),
        "section_presence": compute_section_presence(parsed_versions),
        "global_duplicates": find_global_duplicates(parsed_versions),
        "parsed_versions": parsed_versions,
    }
    return analysis


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyze the latest Claude Code prompt versions.")
    parser.add_argument("--last", type=int, default=5, help="How many latest versions to analyze")
    parser.add_argument(
        "--output-dir",
        default=".context/latest5-prototype",
        help="Directory for outputs",
    )
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        analysis = analyze_latest_versions(args.last, output_dir)
    except (HTTPError, URLError) as exc:
        print(f"Fetch failed: {exc}", file=sys.stderr)
        return 1

    parsed_versions = analysis.pop("parsed_versions")
    (output_dir / "analysis.json").write_text(
        json.dumps(analysis, indent=2, ensure_ascii=True),
        encoding="utf-8",
    )
    (output_dir / "parsed_versions.json").write_text(
        json.dumps(parsed_versions, indent=2, ensure_ascii=True),
        encoding="utf-8",
    )
    (output_dir / "summary.md").write_text(build_summary(analysis), encoding="utf-8")

    print(f"Wrote analysis to {output_dir}")
    print(f"Versions: {', '.join(item['version'] for item in analysis['versions'])}")
    print(f"Summary: {output_dir / 'summary.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
