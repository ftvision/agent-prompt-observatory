"""Change classification heuristics + manual override loading."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

try:
    import yaml
    HAS_YAML = True
except ImportError:
    HAS_YAML = False

IMPERATIVE_RE = re.compile(
    r"\b(must|never|always|do not|don't|avoid|prefer\s+\S+\s+over|ensure that|be careful|important:|critical:)\b",
    re.IGNORECASE,
)

CALIBRATION_RE = re.compile(
    r"\b(don't|do not|avoid|prefer\s+\S+\s+over\s+\S+)\b",
    re.IGNORECASE,
)


def count_imperatives(text: str) -> int:
    return len(IMPERATIVE_RE.findall(text))


def has_calibration_pattern(text: str) -> bool:
    return bool(CALIBRATION_RE.search(text))


def classify_change(
    before_unit: dict[str, Any] | None,
    after_unit: dict[str, Any] | None,
    before_path: str | None,
    after_path: str | None,
    similarity: float | None,
    match_type: str | None,
) -> dict[str, Any]:
    """Classify a single change using the heuristic decision tree.

    Returns {"classification", "confidence", "signals"}.
    """
    signals: list[str] = []

    # New unit (no before)
    if before_unit is None and after_unit is not None:
        after_text = after_unit["text"]
        if has_calibration_pattern(after_text):
            signals.append("calibration_pattern_detected")
            return {
                "classification": "model_calibration",
                "confidence": 0.8,
                "signals": signals,
            }
        signals.append("new_unit")
        # Could distinguish new_section vs existing_section, but we don't have
        # full context here - the caller should adjust confidence
        return {
            "classification": "new_policy",
            "confidence": 0.85,
            "signals": signals,
        }

    # Removed unit (no after)
    if before_unit is not None and after_unit is None:
        signals.append("removed_unit")
        return {
            "classification": "policy_relaxation",
            "confidence": 0.6,
            "signals": signals,
        }

    # Both exist - matched pair
    if before_unit is None or after_unit is None:
        return {"classification": "wording_refinement", "confidence": 0.3, "signals": ["unknown"]}

    before_text = before_unit["text"]
    after_text = after_unit["text"]
    sim = similarity or 0.0

    # Moved across sections
    if match_type == "moved":
        signals.append(f"moved_from_{before_path}_to_{after_path}")
        return {
            "classification": "structural_reorg",
            "confidence": 0.85,
            "signals": signals,
        }

    # High similarity → wording refinement
    if sim >= 0.85:
        signals.append(f"high_similarity_{sim:.2f}")
        return {
            "classification": "wording_refinement",
            "confidence": 0.8,
            "signals": signals,
        }

    # Medium similarity → check imperatives
    before_imp = count_imperatives(before_text)
    after_imp = count_imperatives(after_text)
    signals.append(f"similarity_{sim:.2f}")
    signals.append(f"imperatives_before={before_imp}_after={after_imp}")

    if has_calibration_pattern(after_text) and not has_calibration_pattern(before_text):
        signals.append("new_calibration_pattern")
        return {
            "classification": "model_calibration",
            "confidence": 0.75,
            "signals": signals,
        }

    if after_imp > before_imp:
        signals.append("more_imperatives")
        return {
            "classification": "policy_tightening",
            "confidence": 0.7,
            "signals": signals,
        }

    if after_imp < before_imp:
        signals.append("fewer_imperatives")
        return {
            "classification": "policy_relaxation",
            "confidence": 0.7,
            "signals": signals,
        }

    # Default for medium similarity
    return {
        "classification": "wording_refinement",
        "confidence": 0.5,
        "signals": signals,
    }


def load_overrides(repo_root: Path) -> dict[str, dict[str, Any]]:
    """Load classification_overrides.yaml if it exists.

    Returns a dict keyed by "{transition}_{change_id}" → override info.
    """
    override_path = repo_root / "classification_overrides.yaml"
    if not override_path.exists():
        return {}

    if not HAS_YAML:
        # Fallback: simple parsing for basic cases
        return {}

    with open(override_path, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    overrides = {}
    for entry in data.get("overrides", []):
        key = f"{entry['transition']}_{entry['change_id']}"
        overrides[key] = {
            "classification": entry["classification"],
            "note": entry.get("note", ""),
        }
    return overrides


def classify_transition(
    before_parsed: dict[str, Any],
    after_parsed: dict[str, Any],
    match_result: dict[str, Any],
    overrides: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Classify all changes in a transition between two versions.

    Returns a list of ChangeClassification dicts.
    """
    before_by_id = {u["id"]: u for u in before_parsed["unit_index"]}
    after_by_id = {u["id"]: u for u in after_parsed["unit_index"]}

    # Build path lookups
    before_paths = {u["id"]: u.get("section_path", "") for u in before_parsed["unit_index"]}
    after_paths = {u["id"]: u.get("section_path", "") for u in after_parsed["unit_index"]}

    transition_key = f"{before_parsed['version']}_{after_parsed['version']}"
    changes: list[dict[str, Any]] = []
    change_counter = 0

    # Classify matched pairs (fuzzy and moved - exact matches are unchanged)
    for m in match_result["matches"]:
        if m["match_type"] == "exact":
            continue

        change_counter += 1
        change_id = f"chg_{change_counter:03d}"
        before_unit = before_by_id.get(m["before_id"])
        after_unit = after_by_id.get(m["after_id"])
        bp = before_paths.get(m["before_id"], "")
        ap = after_paths.get(m["after_id"], "")

        result = classify_change(before_unit, after_unit, bp, ap, m["similarity"], m["match_type"])

        # Check for override
        override_key = f"{transition_key}_{change_id}"
        is_override = False
        override_note = None
        if override_key in overrides:
            result["classification"] = overrides[override_key]["classification"]
            override_note = overrides[override_key].get("note")
            is_override = True

        # Determine layer from after unit's section path
        layer = ""
        if after_unit and "layer" in after_unit:
            layer = after_unit["layer"]

        changes.append({
            "change_id": change_id,
            "classification": result["classification"],
            "confidence": result["confidence"],
            "signals": result["signals"],
            "before_text": before_unit["text"] if before_unit else None,
            "after_text": after_unit["text"] if after_unit else None,
            "before_path": bp,
            "after_path": ap,
            "layer": layer,
            "similarity": m["similarity"],
            "is_override": is_override,
            "override_note": override_note,
        })

    # Classify added units
    for uid in match_result["added"]:
        after_unit = after_by_id.get(uid)
        if not after_unit:
            continue
        change_counter += 1
        change_id = f"chg_{change_counter:03d}"
        ap = after_paths.get(uid, "")

        result = classify_change(None, after_unit, None, ap, None, None)

        override_key = f"{transition_key}_{change_id}"
        is_override = False
        override_note = None
        if override_key in overrides:
            result["classification"] = overrides[override_key]["classification"]
            override_note = overrides[override_key].get("note")
            is_override = True

        layer = ""
        if after_unit and "layer" in after_unit:
            layer = after_unit["layer"]

        changes.append({
            "change_id": change_id,
            "classification": result["classification"],
            "confidence": result["confidence"],
            "signals": result["signals"],
            "before_text": None,
            "after_text": after_unit["text"],
            "before_path": None,
            "after_path": ap,
            "layer": layer,
            "similarity": None,
            "is_override": is_override,
            "override_note": override_note,
        })

    # Classify removed units
    for uid in match_result["removed"]:
        before_unit = before_by_id.get(uid)
        if not before_unit:
            continue
        change_counter += 1
        change_id = f"chg_{change_counter:03d}"
        bp = before_paths.get(uid, "")

        result = classify_change(before_unit, None, bp, None, None, None)

        override_key = f"{transition_key}_{change_id}"
        is_override = False
        override_note = None
        if override_key in overrides:
            result["classification"] = overrides[override_key]["classification"]
            override_note = overrides[override_key].get("note")
            is_override = True

        layer = ""
        if before_unit and "layer" in before_unit:
            layer = before_unit["layer"]

        changes.append({
            "change_id": change_id,
            "classification": result["classification"],
            "confidence": result["confidence"],
            "signals": result["signals"],
            "before_text": before_unit["text"],
            "after_text": None,
            "before_path": bp,
            "after_path": None,
            "layer": layer,
            "similarity": None,
            "is_override": is_override,
            "override_note": override_note,
        })

    return changes
