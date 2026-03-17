"""CLI entry point for the analyzer pipeline.

Run with: python -m analyzer
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from .classifier import classify_transition, load_overrides
from .crossrefs import find_cross_refs
from .evidence import build_evidence_index
from .fetcher import fetch_all_versions
from .genome import compute_genome
from .layers import classify_layer
from .lineage import build_lineages
from .matcher import match_units
from .parser import parse_prompt_markdown
from .stability import compute_stability

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def run() -> int:
    print("=== Prompt Drift Observatory v2 - Analyzer Pipeline ===\n")

    # Step 1: Fetch all versions
    print("[1/8] Fetching versions...")
    raw_versions = fetch_all_versions(DATA_DIR)
    if len(raw_versions) < 2:
        print("ERROR: Need at least 2 versions", file=sys.stderr)
        return 1

    # Step 2: Parse all versions
    print("[2/8] Parsing prompts...")
    all_parsed: list[dict[str, Any]] = []
    for entry in raw_versions:
        parsed = parse_prompt_markdown(entry["markdown"], entry["version"])
        all_parsed.append(parsed)

    # Step 3: Layer tagging
    print("[3/8] Classifying functional layers...")
    for parsed in all_parsed:
        for unit in parsed["unit_index"]:
            layer, confidence = classify_layer(unit["text"], unit.get("section_path", ""))
            unit["layer"] = layer
            unit["layer_confidence"] = confidence
        for section in parsed["sections"]:
            for unit in section["units"]:
                path = section["path"]
                layer, confidence = classify_layer(unit["text"], path)
                unit["layer"] = layer
                unit["layer_confidence"] = confidence

    # Step 4: Fuzzy matching between consecutive versions
    print("[4/8] Matching units across versions...")
    all_match_results: list[dict[str, Any]] = []
    for i in range(len(all_parsed) - 1):
        mr = match_units(
            all_parsed[i]["unit_index"],
            all_parsed[i + 1]["unit_index"],
        )
        all_match_results.append(mr)

    # Step 5: Change classification
    print("[5/8] Classifying changes...")
    overrides = load_overrides(REPO_ROOT)
    all_transitions: list[dict[str, Any]] = []
    for i, mr in enumerate(all_match_results):
        changes = classify_transition(
            all_parsed[i], all_parsed[i + 1], mr, overrides,
        )
        # Build summary counts
        summary: Counter[str] = Counter()
        for c in changes:
            summary[c["classification"]] += 1

        before_count = len(all_parsed[i]["unit_index"])
        exact_count = sum(1 for m in mr["matches"] if m["match_type"] == "exact")
        fuzzy_count = sum(1 for m in mr["matches"] if m["match_type"] != "exact")
        survived = exact_count + fuzzy_count
        stab_ratio = survived / before_count if before_count > 0 else 1.0

        transition = {
            "from_version": all_parsed[i]["version"],
            "to_version": all_parsed[i + 1]["version"],
            "changes": changes,
            "summary": dict(summary),
            "stability_ratio": round(stab_ratio, 4),
            "churn_rate": round(1 - stab_ratio, 4),
        }
        all_transitions.append(transition)

    # Step 6: Stability metadata
    print("[6/8] Computing stability...")
    stability = compute_stability(all_parsed)

    # Step 7: Cross-references (latest version only)
    latest_parsed = all_parsed[-1]
    cross_refs = find_cross_refs(latest_parsed)

    # Step 8: Lineages
    print("[7/8] Building lineages...")
    lineages = build_lineages(all_parsed, all_match_results, all_transitions, stability)

    # Step 9: Genome
    genome = compute_genome(all_parsed, all_match_results, all_transitions)

    # Step 10: Evidence index
    print("[8/8] Building evidence index...")
    evidence_index = build_evidence_index(
        all_parsed, all_transitions, lineages, stability, cross_refs,
    )

    # === Write output files ===
    print("\nWriting output files...")

    # versions_meta.json
    versions_meta: list[dict[str, Any]] = []
    for parsed in all_parsed:
        layer_dist: Counter[str] = Counter()
        for unit in parsed["unit_index"]:
            layer_dist[unit.get("layer", "task_execution")] += 1
        versions_meta.append({
            "version": parsed["version"],
            "release_date": parsed["release_date"],
            "total_chars": parsed["total_chars"],
            "unit_count": len(parsed["unit_index"]),
            "section_count": len(parsed["sections"]),
            "layer_distribution": dict(layer_dist),
        })
    write_json(DATA_DIR / "versions_meta.json", versions_meta)

    # prompt_snapshots/{version}.json
    # Note: raw_markdown is NOT included here (available in data/raw/{version}.md)
    for parsed in all_parsed:
        version = parsed["version"]
        snapshot_sections = []
        for section in parsed["sections"]:
            snapshot_units = []
            for unit in section["units"]:
                uid = unit["id"]
                snapshot_units.append({
                    "id": unit["id"],
                    "text": unit["text"],
                    "char_offset_start": unit.get("char_offset_start", 0),
                    "char_offset_end": unit.get("char_offset_end", 0),
                    "layer": unit.get("layer", ""),
                    "layer_confidence": unit.get("layer_confidence", 0),
                    "stability": stability.get(uid, {}),
                    "cross_refs": [
                        xr for xr in cross_refs
                        if xr["unit_id_a"] == uid or xr["unit_id_b"] == uid
                    ] if version == latest_parsed["version"] else [],
                })
            snapshot_sections.append({
                "title": section["title"],
                "path": section["path"],
                "h1": section["h1"],
                "h2": section["h2"],
                "units": snapshot_units,
                "unit_count": section["unit_count"],
            })
        snapshot = {
            "version": version,
            "release_date": parsed["release_date"],
            "total_chars": parsed["total_chars"],
            "sections": snapshot_sections,
        }
        write_json(DATA_DIR / "prompt_snapshots" / f"{version}.json", snapshot)

    # transitions/{from}_{to}.json
    for transition in all_transitions:
        fname = f"{transition['from_version']}_{transition['to_version']}.json"
        write_json(DATA_DIR / "transitions" / fname, transition)

    # lineages.json
    write_json(DATA_DIR / "lineages.json", lineages)

    # genome.json
    write_json(DATA_DIR / "genome.json", genome)

    # evidence_index.json
    write_json(DATA_DIR / "evidence_index.json", evidence_index)

    print(f"\nDone! Analyzed {len(all_parsed)} versions.")
    print(f"  Transitions: {len(all_transitions)}")
    print(f"  Lineages: {len(lineages)}")
    print(f"  Cross-refs: {len(cross_refs)}")
    print(f"  Evidence entries: {len(evidence_index)}")
    print(f"  Output: {DATA_DIR}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
