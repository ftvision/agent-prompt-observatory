"""Cross-reference detection within a single version."""
from __future__ import annotations

from typing import Any

from .matcher import jaccard_similarity, trigrams
from .parser import is_meaningful_unit


def find_cross_refs(
    parsed: dict[str, Any],
    threshold: float = 0.55,
) -> list[dict[str, Any]]:
    """Find cross-references within a single version.

    Detects pairs of units in different sections with high trigram similarity.
    """
    units = [u for u in parsed["unit_index"] if is_meaningful_unit(u["text"])]

    # Precompute trigrams
    unit_trigrams = {u["id"]: trigrams(u["text"]) for u in units}

    cross_refs: list[dict[str, Any]] = []
    seen_pairs: set[tuple[str, str]] = set()

    for i, ua in enumerate(units):
        for j in range(i + 1, len(units)):
            ub = units[j]
            # Must be in different sections
            path_a = ua.get("section_path", "")
            path_b = ub.get("section_path", "")
            if path_a == path_b:
                continue

            # Skip if same text (exact duplicate, not a cross-ref)
            if ua["id"] == ub["id"]:
                continue

            pair_key = (min(ua["id"], ub["id"]), max(ua["id"], ub["id"]))
            if pair_key in seen_pairs:
                continue

            sim = jaccard_similarity(unit_trigrams[ua["id"]], unit_trigrams[ub["id"]])
            if sim >= threshold:
                seen_pairs.add(pair_key)
                cross_refs.append({
                    "unit_id_a": ua["id"],
                    "unit_id_b": ub["id"],
                    "path_a": path_a,
                    "path_b": path_b,
                    "similarity": round(sim, 4),
                })

    cross_refs.sort(key=lambda x: x["similarity"], reverse=True)
    return cross_refs
