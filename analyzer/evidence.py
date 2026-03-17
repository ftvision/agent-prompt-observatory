"""Evidence index builder for the Inspector panel."""
from __future__ import annotations

from typing import Any


def build_evidence_index(
    all_parsed: list[dict[str, Any]],
    all_transitions: list[dict[str, Any]],
    lineages: list[dict[str, Any]],
    stability: dict[str, dict[str, Any]],
    cross_refs: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build a lookup index for the Evidence Inspector.

    Keyed by unit_id, provides:
    - Full history across versions
    - Lineage membership
    - Change classifications
    - Cross-references
    - Stability info
    """
    index: dict[str, dict[str, Any]] = {}

    # Collect unit appearances across versions
    for parsed in all_parsed:
        for unit in parsed["unit_index"]:
            uid = unit["id"]
            if uid not in index:
                index[uid] = {
                    "unit_id": uid,
                    "text": unit["text"],
                    "versions": [],
                    "changes": [],
                    "lineages": [],
                    "cross_refs": [],
                    "stability": stability.get(uid, {}),
                }
            index[uid]["versions"].append({
                "version": parsed["version"],
                "section_path": unit.get("section_path", ""),
                "layer": unit.get("layer", ""),
            })

    # Add change classifications
    for transition in all_transitions:
        for change in transition.get("changes", []):
            # Link to after_text unit
            for uid, entry in index.items():
                if change.get("after_text") == entry["text"]:
                    entry["changes"].append({
                        "transition": f"{transition['from_version']}_{transition['to_version']}",
                        "change_id": change["change_id"],
                        "classification": change["classification"],
                        "confidence": change["confidence"],
                        "signals": change["signals"],
                        "before_text": change.get("before_text"),
                        "similarity": change.get("similarity"),
                        "is_override": change.get("is_override", False),
                        "override_note": change.get("override_note"),
                    })
                    break

    # Add lineage membership
    for lineage in lineages:
        for uid in lineage.get("unit_ids", []):
            if uid in index:
                index[uid]["lineages"].append({
                    "lineage_id": lineage["id"],
                    "lineage_title": lineage["title"],
                })

    # Add cross-references
    for xref in cross_refs:
        for uid_key in ["unit_id_a", "unit_id_b"]:
            uid = xref[uid_key]
            other_uid = xref["unit_id_b" if uid_key == "unit_id_a" else "unit_id_a"]
            if uid in index:
                index[uid]["cross_refs"].append({
                    "other_unit_id": other_uid,
                    "other_path": xref["path_b" if uid_key == "unit_id_a" else "path_a"],
                    "similarity": xref["similarity"],
                })

    return index
