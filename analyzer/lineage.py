"""Auto-derive idea lineages from unit matching across versions."""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from typing import Any


def build_lineages(
    all_parsed: list[dict[str, Any]],
    all_match_results: list[dict[str, Any]],
    all_transitions: list[dict[str, Any]],
    stability: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Build lineages from cross-version unit match graph.

    Steps:
    1. Build graph: nodes = (version, unit_id), edges = exact/fuzzy matches
    2. Find connected components
    3. Filter: keep components spanning >=3 versions or >=2 sections
    4. Title from top terms + dominant layer
    5. Extract events from change classifications
    """
    # Build adjacency list
    # Nodes: (version_idx, unit_id)
    # Edges: from match results between consecutive versions
    adj: dict[tuple[int, str], set[tuple[int, str]]] = defaultdict(set)

    for i, mr in enumerate(all_match_results):
        before_ver_idx = i
        after_ver_idx = i + 1
        for m in mr["matches"]:
            node_a = (before_ver_idx, m["before_id"])
            node_b = (after_ver_idx, m["after_id"])
            adj[node_a].add(node_b)
            adj[node_b].add(node_a)

    # Also add nodes for units that appear but have no matches
    for ver_idx, parsed in enumerate(all_parsed):
        for unit in parsed["unit_index"]:
            node = (ver_idx, unit["id"])
            if node not in adj:
                adj[node] = set()

    # Find connected components via BFS
    visited: set[tuple[int, str]] = set()
    components: list[set[tuple[int, str]]] = []

    for node in adj:
        if node in visited:
            continue
        component: set[tuple[int, str]] = set()
        queue = [node]
        while queue:
            current = queue.pop()
            if current in visited:
                continue
            visited.add(current)
            component.add(current)
            for neighbor in adj[current]:
                if neighbor not in visited:
                    queue.append(neighbor)
        if len(component) > 1:  # Skip singletons
            components.append(component)

    # Filter and build lineages
    versions = [p["version"] for p in all_parsed]
    lineages: list[dict[str, Any]] = []

    # Build lookup for unit text and path
    unit_lookup: dict[tuple[int, str], dict[str, Any]] = {}
    for ver_idx, parsed in enumerate(all_parsed):
        for unit in parsed["unit_index"]:
            unit_lookup[(ver_idx, unit["id"])] = unit

    # Build change classification lookup
    change_lookup: dict[tuple[str, str], dict[str, Any]] = {}
    for transition in all_transitions:
        for change in transition.get("changes", []):
            if change.get("before_text") and change.get("after_text"):
                # Key by before/after text hash pair for matching
                pass
            # Also key by before/after path for lineage event detection
            key = (transition["from_version"], change.get("change_id", ""))
            change_lookup[key] = change

    for comp_idx, component in enumerate(components):
        ver_indices = {node[0] for node in component}
        unit_ids = {node[1] for node in component}

        versions_spanned = len(ver_indices)
        sections_spanned = set()
        for node in component:
            u = unit_lookup.get(node)
            if u:
                sections_spanned.add(u.get("section_path", ""))

        # Filter: keep if spanning >=3 versions or >=2 sections
        if versions_spanned < 3 and len(sections_spanned) < 2:
            continue

        # Auto-title from TF-IDF-like term extraction
        all_text = []
        layer_counts: Counter[str] = Counter()
        for node in component:
            u = unit_lookup.get(node)
            if u:
                all_text.append(u.get("text", ""))
                if "layer" in u:
                    layer_counts[u["layer"]] += 1

        title = _extract_title(all_text)
        dominant_layer = layer_counts.most_common(1)[0][0] if layer_counts else "task_execution"

        # Build events timeline
        events = _build_events(component, all_parsed, all_match_results, all_transitions, unit_lookup, versions)

        lineage_id = f"lineage_{comp_idx:03d}"
        lineages.append({
            "id": lineage_id,
            "title": title,
            "layer": dominant_layer,
            "versions_spanned": versions_spanned,
            "sections_spanned": len(sections_spanned),
            "sections": sorted(sections_spanned),
            "events": events,
            "unit_ids": sorted(unit_ids),
            "version_presence": sorted(ver_indices),
        })

    # Sort by significance (versions spanned * sections spanned)
    lineages.sort(key=lambda l: l["versions_spanned"] * l["sections_spanned"], reverse=True)
    return lineages


def _extract_title(texts: list[str], max_words: int = 5) -> str:
    """Extract a title from unit texts using top distinctive terms."""
    stop_words = {
        "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
        "have", "has", "had", "do", "does", "did", "will", "would", "could",
        "should", "may", "might", "shall", "can", "need", "must", "ought",
        "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
        "into", "through", "during", "before", "after", "above", "below",
        "between", "out", "off", "over", "under", "again", "further", "then",
        "once", "here", "there", "when", "where", "why", "how", "all", "each",
        "every", "both", "few", "more", "most", "other", "some", "such", "no",
        "nor", "not", "only", "own", "same", "so", "than", "too", "very",
        "just", "because", "but", "and", "or", "if", "while", "that", "this",
        "these", "those", "it", "its", "you", "your", "they", "them", "their",
        "we", "us", "our", "use", "using", "used",
    }
    word_counts: Counter[str] = Counter()
    for text in texts:
        words = re.findall(r"[a-z]{3,}", text.lower())
        for w in words:
            if w not in stop_words:
                word_counts[w] += 1

    top_words = [w for w, _ in word_counts.most_common(max_words)]
    return " ".join(top_words) if top_words else "unnamed lineage"


def _build_events(
    component: set[tuple[int, str]],
    all_parsed: list[dict[str, Any]],
    all_match_results: list[dict[str, Any]],
    all_transitions: list[dict[str, Any]],
    unit_lookup: dict[tuple[int, str], dict[str, Any]],
    versions: list[str],
) -> list[dict[str, Any]]:
    """Build timeline events for a lineage component."""
    events: list[dict[str, Any]] = []
    ver_indices = sorted({node[0] for node in component})

    for vi in ver_indices:
        nodes_in_ver = {node for node in component if node[0] == vi}
        version = versions[vi]

        for node in nodes_in_ver:
            u = unit_lookup.get(node)
            if not u:
                continue

            # Check if this is first appearance
            is_first = vi == min(n[0] for n in component if n[1] == node[1])
            is_last = vi == max(n[0] for n in component if n[1] == node[1])

            if is_first and vi == ver_indices[0]:
                events.append({
                    "version": version,
                    "event_type": "introduced",
                    "unit_id": node[1],
                    "section_path": u.get("section_path", ""),
                    "detail": u.get("text", "")[:120],
                })
            elif is_first:
                events.append({
                    "version": version,
                    "event_type": "introduced",
                    "unit_id": node[1],
                    "section_path": u.get("section_path", ""),
                    "detail": u.get("text", "")[:120],
                })

    # Add change events from transitions
    for i, transition in enumerate(all_transitions):
        if i >= len(all_match_results):
            break
        mr = all_match_results[i]
        before_vi = i
        after_vi = i + 1

        for m in mr["matches"]:
            if m["match_type"] == "exact":
                continue
            if (before_vi, m["before_id"]) not in component and (after_vi, m["after_id"]) not in component:
                continue

            # Find the corresponding classification
            for change in transition.get("changes", []):
                if change.get("before_text") and change.get("after_text"):
                    before_u = unit_lookup.get((before_vi, m["before_id"]))
                    after_u = unit_lookup.get((after_vi, m["after_id"]))
                    if before_u and after_u and change["before_text"] == before_u.get("text") and change["after_text"] == after_u.get("text"):
                        event_type_map = {
                            "policy_tightening": "tightened",
                            "policy_relaxation": "relaxed",
                            "wording_refinement": "refined",
                            "structural_reorg": "moved",
                            "model_calibration": "refined",
                        }
                        events.append({
                            "version": versions[after_vi],
                            "event_type": event_type_map.get(change["classification"], "refined"),
                            "unit_id": m["after_id"],
                            "section_path": change.get("after_path", ""),
                            "detail": f"{change['classification']}: {change.get('after_text', '')[:80]}",
                        })
                        break

    # Sort by version order
    version_order = {v: i for i, v in enumerate(versions)}
    events.sort(key=lambda e: version_order.get(e["version"], 0))

    # Deduplicate
    seen: set[str] = set()
    unique_events = []
    for e in events:
        key = f"{e['version']}_{e['unit_id']}_{e['event_type']}"
        if key not in seen:
            seen.add(key)
            unique_events.append(e)

    return unique_events
