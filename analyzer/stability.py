"""Per-unit stability and age metadata computation."""
from __future__ import annotations

from typing import Any


def compute_stability(
    all_parsed: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Compute stability metadata for every unit across all versions.

    Returns a dict keyed by unit_id → StabilityInfo.
    """
    versions = [p["version"] for p in all_parsed]
    total = len(versions)

    # Track which versions each unit appears in
    unit_versions: dict[str, list[str]] = {}
    for parsed in all_parsed:
        for unit in parsed["unit_index"]:
            uid = unit["id"]
            unit_versions.setdefault(uid, []).append(parsed["version"])

    latest_version = versions[-1] if versions else ""
    stability: dict[str, dict[str, Any]] = {}

    for uid, ver_list in unit_versions.items():
        first_seen = ver_list[0]
        last_seen = ver_list[-1]
        appearance_count = len(ver_list)

        # Compute consecutive_since: how far back the unit has been present
        # continuously from the latest version
        consecutive_since = last_seen
        if last_seen == latest_version:
            # Walk backwards
            for i in range(len(versions) - 1, -1, -1):
                if versions[i] in ver_list:
                    consecutive_since = versions[i]
                else:
                    break

        # Determine status
        presence_ratio = appearance_count / total if total > 0 else 0
        in_latest = last_seen == latest_version
        recent_versions = set(versions[-3:]) if len(versions) >= 3 else set(versions)
        in_recent = bool(set(ver_list) & recent_versions)

        if presence_ratio >= 0.8 and in_latest:
            status = "stable"
        elif in_latest and appearance_count <= 3:
            status = "recent"
        elif not in_latest:
            status = "legacy"
        elif not _is_contiguous(ver_list, versions):
            status = "volatile"
        else:
            status = "stable" if presence_ratio >= 0.5 else "recent"

        stability[uid] = {
            "first_seen": first_seen,
            "last_seen": last_seen,
            "appearance_count": appearance_count,
            "consecutive_since": consecutive_since,
            "status": status,
        }

    return stability


def _is_contiguous(unit_versions: list[str], all_versions: list[str]) -> bool:
    """Check if the unit's version appearances form a contiguous block."""
    if len(unit_versions) <= 1:
        return True
    indices = [all_versions.index(v) for v in unit_versions if v in all_versions]
    if not indices:
        return True
    indices.sort()
    for i in range(1, len(indices)):
        if indices[i] - indices[i-1] > 1:
            return False
    return True
