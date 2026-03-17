"""Shared data structures for the analyzer pipeline."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, TypedDict


class UnitDict(TypedDict):
    id: str
    text: str
    raw_text: str
    char_offset_start: int
    char_offset_end: int
    section_path: str
    layer: str
    layer_confidence: float


class SectionDict(TypedDict):
    title: str
    path: str
    h1: str
    h2: str
    body_raw: str
    units: list[UnitDict]
    unit_count: int


class StabilityInfo(TypedDict):
    first_seen: str
    last_seen: str
    appearance_count: int
    consecutive_since: str
    status: str  # stable, recent, volatile, legacy


class MatchResult(TypedDict):
    before_unit_id: str
    after_unit_id: str
    similarity: float
    match_type: str  # exact, fuzzy, moved


class ChangeClassification(TypedDict):
    change_id: str
    classification: str  # new_policy, policy_tightening, policy_relaxation, model_calibration, structural_reorg, wording_refinement
    confidence: float
    signals: list[str]
    before_text: str | None
    after_text: str | None
    before_path: str | None
    after_path: str | None
    layer: str
    similarity: float | None
    is_override: bool
    override_note: str | None


class LineageEvent(TypedDict):
    version: str
    event_type: str  # introduced, refined, tightened, relaxed, moved, removed
    unit_id: str
    section_path: str
    detail: str


class Lineage(TypedDict):
    id: str
    title: str
    layer: str
    versions_spanned: int
    sections_spanned: int
    events: list[LineageEvent]
    unit_ids: list[str]


class CrossRef(TypedDict):
    unit_id_a: str
    unit_id_b: str
    path_a: str
    path_b: str
    similarity: float


class VersionMeta(TypedDict):
    version: str
    release_date: str
    total_chars: int
    unit_count: int
    section_count: int
    layer_distribution: dict[str, int]


class TransitionData(TypedDict):
    from_version: str
    to_version: str
    changes: list[ChangeClassification]
    summary: dict[str, int]
    stability_ratio: float
    churn_rate: float


class GenomeData(TypedDict):
    versions: list[str]
    growth: list[dict[str, Any]]
    stability: list[float]
    churn: list[dict[str, Any]]
    hotspots: list[dict[str, Any]]
    rule_density: list[float]


LAYERS = [
    "identity",
    "tools",
    "safety",
    "output",
    "task_execution",
    "memory",
    "environment",
]

LAYER_COLORS = {
    "identity": "#6366f1",
    "tools": "#06b6d4",
    "safety": "#ef4444",
    "output": "#f59e0b",
    "task_execution": "#10b981",
    "memory": "#8b5cf6",
    "environment": "#64748b",
}

CLASSIFICATIONS = [
    "new_policy",
    "policy_tightening",
    "policy_relaxation",
    "model_calibration",
    "structural_reorg",
    "wording_refinement",
]

CLASSIFICATION_COLORS = {
    "new_policy": "#6366f1",
    "policy_tightening": "#ef4444",
    "policy_relaxation": "#10b981",
    "model_calibration": "#f59e0b",
    "structural_reorg": "#64748b",
    "wording_refinement": "#94a3b8",
}
