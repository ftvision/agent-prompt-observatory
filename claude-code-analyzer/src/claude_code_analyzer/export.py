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


def _resolve_release_date(snap_value: str, meta_value: str) -> str:
    """Authoritative release date: prefer ISO dates from the file, then versions_meta.

    Some upstream captures (marckrenn) write a literal 'Release Date: Unknown'
    in the prompt; in that case we fall back to the commit-date stored in
    versions_meta.json by the fetch script.
    """
    if _ISO_DATE_RE.fullmatch(snap_value or ""):
        return snap_value
    return meta_value or snap_value


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

    # versions_meta.json (sibling of raw_dir) is the authoritative source for
    # release dates when the file itself is missing one.
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
    }
    (output_dir / "meta.json").write_text(
        json.dumps(meta, indent=2), encoding="utf-8"
    )

    # ── structures.json ───────────────────────────────────────────────────────
    print("Writing structures.json…", flush=True)
    structures_data: dict[str, object] = {}
    for snap in snapshots:
        # Sections from system_prompt children
        sections: list[dict] = []
        sp = snap.components.get("system_prompt")
        if sp:
            for child in sp.children.values():
                sections.append({
                    "title": child.title,
                    "char_count": len(child.normalized),
                })

        # Tools from tools children where kind == "tool"
        tools: list[dict] = []
        tc = snap.components.get("tools")
        if tc:
            for child in tc.children.values():
                if child.kind != "tool":
                    continue
                child_id = child.id
                prose = child.children.get(f"{child_id}/prose")
                schema = child.children.get(f"{child_id}/schema")
                prose_chars = len(prose.normalized) if prose else 0
                schema_chars = len(schema.normalized) if schema else 0
                tools.append({
                    "title": child.title,
                    "prose_chars": prose_chars,
                    "schema_chars": schema_chars,
                    "total_chars": prose_chars + schema_chars,
                })

        # XML tags: one entry per occurrence, keyed by "kind/index"
        xml_tags: list[dict] = []
        um = snap.components.get("user_message")
        if um:
            for child in um.children.values():
                if child.kind == "actual_prompt":
                    continue
                # child.id is "user_message/kind/index" — extract the index
                parts = child.id.split("/")
                idx = int(parts[-1]) if parts[-1].isdigit() else 0
                xml_tags.append({
                    "key": f"{child.kind}/{idx}",
                    "kind": child.kind,
                    "index": idx,
                    "char_count": len(child.normalized),
                })
            xml_tags.sort(key=lambda x: (x["kind"], x["index"]))

        structures_data[snap.version] = {
            "system_message": sections,
            "tools": tools,
            "user_message": xml_tags,
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
            "added_sections": d.added_sp_sections,
            "removed_sections": d.removed_sp_sections,
            "reordered_sections": d.reordered_sp_sections,
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
        # Sections: hash and char_count per section title
        sections_out: dict[str, dict] = {}
        sp = snap.components.get("system_prompt")
        if sp:
            for child in sp.children.values():
                sections_out[child.title] = {
                    "hash": child.hash,
                    "char_count": len(child.normalized),
                    "text": child.normalized,
                }

        # Tools: prose_hash, schema_hash, prose_chars, schema_chars per tool title
        tools_out: dict[str, dict] = {}
        tc = snap.components.get("tools")
        if tc:
            for child in tc.children.values():
                if child.kind != "tool":
                    continue
                child_id = child.id
                prose = child.children.get(f"{child_id}/prose")
                schema = child.children.get(f"{child_id}/schema")
                tools_out[child.title] = {
                    "prose_hash": prose.hash if prose else None,
                    "schema_hash": schema.hash if schema else None,
                    "prose_chars": len(prose.normalized) if prose else None,
                    "schema_chars": len(schema.normalized) if schema else None,
                    "prose": prose.normalized if prose else None,
                    "schema": schema.normalized if schema else None,
                }

        # XML tags: keyed by "kind/index"; actual_prompt keyed as "actual_prompt"
        xml_tags_out: dict[str, dict] = {}
        um = snap.components.get("user_message")
        if um:
            for child in um.children.values():
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

        comp_data = {
            "system_message": sections_out,
            "tools": tools_out,
            "user_message": xml_tags_out,
        }
        (components_dir / f"{snap.version}.json").write_text(
            json.dumps(comp_data, indent=2), encoding="utf-8"
        )

    print("Done.", flush=True)
