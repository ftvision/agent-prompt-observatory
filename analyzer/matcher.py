"""Trigram Jaccard fuzzy matching for units across versions."""
from __future__ import annotations

from typing import Any


def trigrams(text: str) -> set[str]:
    """Extract character trigrams from normalized text."""
    t = text.lower().strip()
    if len(t) < 3:
        return {t}
    return {t[i:i+3] for i in range(len(t) - 2)}


def jaccard_similarity(a: set[str], b: set[str]) -> float:
    """Compute Jaccard similarity between two trigram sets."""
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    intersection = len(a & b)
    union = len(a | b)
    return intersection / union if union > 0 else 0.0


def match_units(
    before_units: list[dict[str, Any]],
    after_units: list[dict[str, Any]],
    fuzzy_threshold: float = 0.65,
    move_threshold: float = 0.75,
) -> dict[str, Any]:
    """Match units between two versions using exact + fuzzy matching.

    Returns:
        {
            "matches": [{"before_id", "after_id", "similarity", "match_type"}],
            "added": [unit_ids],
            "removed": [unit_ids],
        }
    """
    before_by_id = {u["id"]: u for u in before_units}
    after_by_id = {u["id"]: u for u in after_units}
    before_ids = set(before_by_id.keys())
    after_ids = set(after_by_id.keys())

    matches = []
    matched_before: set[str] = set()
    matched_after: set[str] = set()

    # Step 1: Exact matches (same SHA hash)
    exact = before_ids & after_ids
    for uid in exact:
        matches.append({
            "before_id": uid,
            "after_id": uid,
            "similarity": 1.0,
            "match_type": "exact",
        })
        matched_before.add(uid)
        matched_after.add(uid)

    # Precompute trigrams for unmatched units
    unmatched_before = before_ids - matched_before
    unmatched_after = after_ids - matched_after

    before_trigrams = {uid: trigrams(before_by_id[uid]["text"]) for uid in unmatched_before}
    after_trigrams = {uid: trigrams(after_by_id[uid]["text"]) for uid in unmatched_after}

    # Step 2: Fuzzy match within same H1 section
    before_by_h1: dict[str, list[str]] = {}
    after_by_h1: dict[str, list[str]] = {}
    for uid in unmatched_before:
        u = before_by_id[uid]
        h1 = u.get("section_path", "").split(" / ")[0] if "section_path" in u else ""
        before_by_h1.setdefault(h1, []).append(uid)
    for uid in unmatched_after:
        u = after_by_id[uid]
        h1 = u.get("section_path", "").split(" / ")[0] if "section_path" in u else ""
        after_by_h1.setdefault(h1, []).append(uid)

    for h1 in set(before_by_h1) & set(after_by_h1):
        _fuzzy_match_group(
            before_by_h1[h1], after_by_h1[h1],
            before_trigrams, after_trigrams,
            fuzzy_threshold, "fuzzy",
            matches, matched_before, matched_after,
        )

    # Step 3: Cross-section pass for remaining unmatched
    remaining_before = [uid for uid in unmatched_before if uid not in matched_before]
    remaining_after = [uid for uid in unmatched_after if uid not in matched_after]

    if remaining_before and remaining_after:
        _fuzzy_match_group(
            remaining_before, remaining_after,
            before_trigrams, after_trigrams,
            move_threshold, "moved",
            matches, matched_before, matched_after,
        )

    added = sorted(after_ids - matched_after)
    removed = sorted(before_ids - matched_before)

    return {
        "matches": matches,
        "added": added,
        "removed": removed,
    }


def _fuzzy_match_group(
    before_ids: list[str],
    after_ids: list[str],
    before_trigrams: dict[str, set[str]],
    after_trigrams: dict[str, set[str]],
    threshold: float,
    match_type: str,
    matches: list[dict[str, Any]],
    matched_before: set[str],
    matched_after: set[str],
) -> None:
    """Find best fuzzy matches between two groups of unit IDs."""
    candidates: list[tuple[float, str, str]] = []
    for bid in before_ids:
        if bid in matched_before:
            continue
        bt = before_trigrams.get(bid, set())
        for aid in after_ids:
            if aid in matched_after:
                continue
            at = after_trigrams.get(aid, set())
            sim = jaccard_similarity(bt, at)
            if sim >= threshold:
                candidates.append((sim, bid, aid))

    # Greedy best-first matching
    candidates.sort(reverse=True)
    for sim, bid, aid in candidates:
        if bid in matched_before or aid in matched_after:
            continue
        matches.append({
            "before_id": bid,
            "after_id": aid,
            "similarity": round(sim, 4),
            "match_type": match_type,
        })
        matched_before.add(bid)
        matched_after.add(aid)
