"""Trend aggregation for the Prompt Genome view."""
from __future__ import annotations

import re
from collections import Counter
from typing import Any

RULE_RE = re.compile(
    r"\b(must|never|always|do not|don't|avoid|ensure that|important:|critical:)\b",
    re.IGNORECASE,
)


def compute_genome(
    all_parsed: list[dict[str, Any]],
    all_match_results: list[dict[str, Any]],
    all_transitions: list[dict[str, Any]],
) -> dict[str, Any]:
    """Compute aggregate genome data for charts."""
    versions = [p["version"] for p in all_parsed]

    # Per-version growth data
    growth: list[dict[str, Any]] = []
    for parsed in all_parsed:
        layer_chars: dict[str, int] = {}
        for unit in parsed["unit_index"]:
            layer = unit.get("layer", "task_execution")
            layer_chars[layer] = layer_chars.get(layer, 0) + len(unit["text"])
        growth.append({
            "version": parsed["version"],
            "total_chars": parsed["total_chars"],
            "unit_count": len(parsed["unit_index"]),
            "layer_chars": layer_chars,
        })

    # Per-transition stability and churn
    stability: list[float] = []
    churn: list[dict[str, Any]] = []
    for i, mr in enumerate(all_match_results):
        before_count = len(all_parsed[i]["unit_index"])
        after_count = len(all_parsed[i + 1]["unit_index"])

        exact_count = sum(1 for m in mr["matches"] if m["match_type"] == "exact")
        fuzzy_count = sum(1 for m in mr["matches"] if m["match_type"] != "exact")
        added_count = len(mr["added"])
        removed_count = len(mr["removed"])

        # Stability = fraction of before units that survived (exact or fuzzy)
        survived = exact_count + fuzzy_count
        stab = survived / before_count if before_count > 0 else 1.0
        stability.append(round(stab, 4))

        # Churn by layer
        layer_added: Counter[str] = Counter()
        layer_removed: Counter[str] = Counter()

        after_units = {u["id"]: u for u in all_parsed[i + 1]["unit_index"]}
        before_units = {u["id"]: u for u in all_parsed[i]["unit_index"]}

        for uid in mr["added"]:
            u = after_units.get(uid)
            if u:
                layer_added[u.get("layer", "task_execution")] += 1
        for uid in mr["removed"]:
            u = before_units.get(uid)
            if u:
                layer_removed[u.get("layer", "task_execution")] += 1

        churn.append({
            "from_version": all_parsed[i]["version"],
            "to_version": all_parsed[i + 1]["version"],
            "added": added_count,
            "removed": removed_count,
            "exact": exact_count,
            "fuzzy": fuzzy_count,
            "layer_added": dict(layer_added),
            "layer_removed": dict(layer_removed),
        })

    # Hotspots: most-churned sections
    section_churn: Counter[str] = Counter()
    section_churn_history: dict[str, list[tuple[str, int, int]]] = {}

    for i, transition in enumerate(all_transitions):
        from_ver = transition["from_version"]
        for change in transition.get("changes", []):
            path = change.get("after_path") or change.get("before_path") or ""
            if path:
                section_churn[path] += 1
                section_churn_history.setdefault(path, []).append(
                    (from_ver, 1 if change.get("after_text") else 0, 1 if change.get("before_text") else 0)
                )

    hotspots = []
    for path, count in section_churn.most_common(20):
        history = section_churn_history.get(path, [])
        hotspots.append({
            "path": path,
            "total_changes": count,
            "history": history,
        })

    # Rule density per version
    rule_density: list[float] = []
    for parsed in all_parsed:
        total_words = 0
        rule_count = 0
        for unit in parsed["unit_index"]:
            text = unit["text"]
            words = len(text.split())
            total_words += words
            rule_count += len(RULE_RE.findall(text))
        density = rule_count / total_words if total_words > 0 else 0
        rule_density.append(round(density, 6))

    return {
        "versions": versions,
        "growth": growth,
        "stability": stability,
        "churn": churn,
        "hotspots": hotspots,
        "rule_density": rule_density,
    }
