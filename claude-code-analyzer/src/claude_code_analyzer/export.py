"""Export parsed snapshot data as static JSON for the UI."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from .diagnose import _extract_structure, _diff, _version_key
from .models import Snapshot

_ISO_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")

# Slugs whose top-level shape is special: User Message holds xml_tags,
# Tools holds tools. Every other slug is an h1 "section" group whose
# value in structures.json is the list of {title, char_count} subsections.
_RESERVED_SLUGS = {"user_message", "tools"}


def _resolve_release_date(snap_value: str, meta_value: str) -> str:
    """Authoritative release date: prefer ISO dates from the file, then versions_meta.

    Some upstream captures (marckrenn) write a literal 'Release Date: Unknown'
    in the prompt; in that case we fall back to the commit-date stored in
    versions_meta.json by the fetch script.
    """
    if _ISO_DATE_RE.fullmatch(snap_value or ""):
        return snap_value
    return meta_value or snap_value


def _h1_subsection_entries(comp) -> list[dict]:
    """Flat list of {title, char_count} for a h1-section component's children."""
    return [
        {"title": child.title, "char_count": len(child.normalized)}
        for child in comp.children.values()
    ]


def _user_message_entries(comp) -> list[dict]:
    """xml_tag entries (one per occurrence, keyed by kind/index), sorted (kind, index)."""
    entries: list[dict] = []
    for child in comp.children.values():
        if child.kind == "actual_prompt":
            continue
        parts = child.id.split("/")
        idx = int(parts[-1]) if parts[-1].isdigit() else 0
        entries.append({
            "key": f"{child.kind}/{idx}",
            "kind": child.kind,
            "index": idx,
            "char_count": len(child.normalized),
        })
    entries.sort(key=lambda x: (x["kind"], x["index"]))
    return entries


def _tools_entries(comp) -> list[dict]:
    """One entry per tool, with prose/schema breakdown."""
    out: list[dict] = []
    for child in comp.children.values():
        if child.kind != "tool":
            continue
        prose = child.children.get(f"{child.id}/prose")
        schema = child.children.get(f"{child.id}/schema")
        prose_chars = len(prose.normalized) if prose else 0
        schema_chars = len(schema.normalized) if schema else 0
        out.append({
            "title": child.title,
            "prose_chars": prose_chars,
            "schema_chars": schema_chars,
            "total_chars": prose_chars + schema_chars,
        })
    return out


def _build_structure_for_version(snap: Snapshot) -> dict:
    """One key per H1, in document order (insertion order is preserved by JSON)."""
    out: dict[str, list[dict]] = {}
    for slug, comp in snap.components.items():
        if slug == "user_message":
            out["user_message"] = _user_message_entries(comp)
        elif slug == "tools":
            out["tools"] = _tools_entries(comp)
        else:
            out[slug] = _h1_subsection_entries(comp)
    return out


def _build_components_for_version(snap: Snapshot) -> dict:
    """Per-version component detail (text + hashes), nested by H1 slug."""
    out: dict[str, dict] = {}

    for slug, comp in snap.components.items():
        if slug == "user_message":
            xml_tags_out: dict[str, dict] = {}
            for child in comp.children.values():
                if child.kind == "actual_prompt":
                    key = "actual_prompt"
                else:
                    parts = child.id.split("/")
                    idx = int(parts[-1]) if parts[-1].isdigit() else 0
                    key = f"{child.kind}/{idx}"
                xml_tags_out[key] = {
                    "hash": child.hash,
                    "char_count": len(child.normalized),
                    "text": child.normalized,
                }
            out["user_message"] = xml_tags_out
            continue

        if slug == "tools":
            tools_out: dict[str, dict] = {}
            for child in comp.children.values():
                if child.kind != "tool":
                    continue
                prose = child.children.get(f"{child.id}/prose")
                schema = child.children.get(f"{child.id}/schema")
                tools_out[child.title] = {
                    "prose_hash": prose.hash if prose else None,
                    "schema_hash": schema.hash if schema else None,
                    "prose_chars": len(prose.normalized) if prose else None,
                    "schema_chars": len(schema.normalized) if schema else None,
                    "prose": prose.normalized if prose else None,
                    "schema": schema.normalized if schema else None,
                }
            out["tools"] = tools_out
            continue

        # H1 section: dict keyed by subsection title
        sub_out: dict[str, dict] = {}
        for child in comp.children.values():
            sub_out[child.title] = {
                "hash": child.hash,
                "char_count": len(child.normalized),
                "text": child.normalized,
            }
        out[slug] = sub_out

    return out


def run_export(
    raw_dir: Path,
    output_dir: Path,
    parse_fn: Callable[[str], Snapshot],
) -> None:
    """Parse all .md files in raw_dir and write static JSON files to output_dir."""
    md_files = sorted(raw_dir.glob("*.md"), key=_version_key)
    if not md_files:
        print(f"No .md files found in {raw_dir}")
        return

    print(f"Parsing {len(md_files)} versions…", flush=True)
    snapshots: list[Snapshot] = []
    for f in md_files:
        snap = parse_fn(str(f))
        snapshots.append(snap)

    # versions_meta.json (sibling of raw_dir) — authoritative release dates.
    meta_dates: dict[str, str] = {}
    meta_path = raw_dir.parent / "versions_meta.json"
    if meta_path.exists():
        try:
            meta_dates = {
                e["version"]: e.get("release_date", "")
                for e in json.loads(meta_path.read_text(encoding="utf-8"))
            }
        except (json.JSONDecodeError, KeyError, TypeError):
            pass

    output_dir.mkdir(parents=True, exist_ok=True)
    components_dir = output_dir / "components"
    components_dir.mkdir(parents=True, exist_ok=True)

    # ── meta.json ─────────────────────────────────────────────────────────────
    print("Writing meta.json…", flush=True)

    # Build top_level_titles by iterating in version order so the LAST-seen
    # title wins on conflict; also record the union of all H1 slugs in source
    # order based on their first appearance.
    top_level_titles: dict[str, str] = {}
    for snap in snapshots:
        for slug, comp in snap.components.items():
            top_level_titles[slug] = comp.title

    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_versions": len(snapshots),
        "versions": [
            {
                "version": snap.version,
                "release_date": _resolve_release_date(
                    snap.release_date, meta_dates.get(snap.version, "")
                ),
            }
            for snap in snapshots
        ],
        "top_level_titles": top_level_titles,
    }
    (output_dir / "meta.json").write_text(
        json.dumps(meta, indent=2), encoding="utf-8"
    )

    # ── structures.json ───────────────────────────────────────────────────────
    print("Writing structures.json…", flush=True)
    structures_data: dict[str, object] = {
        snap.version: _build_structure_for_version(snap) for snap in snapshots
    }
    (output_dir / "structures.json").write_text(
        json.dumps(structures_data, indent=2), encoding="utf-8"
    )

    # ── diffs.json ────────────────────────────────────────────────────────────
    print("Writing diffs.json…", flush=True)
    version_structures = [_extract_structure(snap) for snap in snapshots]
    diffs_data: list[dict] = []
    for i in range(1, len(snapshots)):
        prev_struct = version_structures[i - 1]
        curr_struct = version_structures[i]
        d = _diff(prev_struct, curr_struct)
        diffs_data.append({
            "from": snapshots[i - 1].version,
            "to": snapshots[i].version,
            "added_h1_sections": d.added_h1_sections,
            "removed_h1_sections": d.removed_h1_sections,
            "added_subsections": d.added_subsections,
            "removed_subsections": d.removed_subsections,
            "reordered_h1s": d.reordered_h1s,
            "added_tools": d.added_tools,
            "removed_tools": d.removed_tools,
            "reordered_tools": d.reordered_tools,
            "added_xml_tags": d.added_xml_tags,
            "removed_xml_tags": d.removed_xml_tags,
        })

    (output_dir / "diffs.json").write_text(
        json.dumps(diffs_data, indent=2), encoding="utf-8"
    )

    # ── components/{version}.json ─────────────────────────────────────────────
    print("Writing components/{version}.json…", flush=True)
    for snap in snapshots:
        comp_data = _build_components_for_version(snap)
        (components_dir / f"{snap.version}.json").write_text(
            json.dumps(comp_data, indent=2), encoding="utf-8"
        )

    print("Done.", flush=True)
