"""Functional layer classification for prompt units."""
from __future__ import annotations

import re

# Path fragment → layer mapping (primary signal)
PATH_KEYWORDS: dict[str, list[str]] = {
    "identity": ["identity", "role", "persona", "tone and style", "output efficiency"],
    "tools": ["tool", "function", "schema", "using your tools", "deferred"],
    "safety": ["safe", "care", "risk", "destruct", "security", "executing actions"],
    "output": ["output", "format", "style", "tone", "rendering", "efficiency"],
    "task_execution": ["task", "doing", "plan", "execut", "commit", "pull request", "git", "creating pull"],
    "memory": ["memory", "context", "recall", "persist", "auto memory"],
    "environment": ["environment", "runtime", "platform", "shell", "system"],
}

# Content keyword patterns (secondary signal)
CONTENT_PATTERNS: dict[str, list[re.Pattern[str]]] = {
    "identity": [
        re.compile(r"\byou are\b", re.IGNORECASE),
        re.compile(r"\byour role\b", re.IGNORECASE),
        re.compile(r"\bassistant\b", re.IGNORECASE),
        re.compile(r"\bClaude\b"),
    ],
    "tools": [
        re.compile(r"\btool\b", re.IGNORECASE),
        re.compile(r"\bBash\b"),
        re.compile(r"\bRead\b"),
        re.compile(r"\bEdit\b"),
        re.compile(r"\bGrep\b"),
        re.compile(r"\bGlob\b"),
        re.compile(r"\bAgent\b"),
        re.compile(r"\bfunction call\b", re.IGNORECASE),
    ],
    "safety": [
        re.compile(r"\bsecurity\b", re.IGNORECASE),
        re.compile(r"\bvulnerab\b", re.IGNORECASE),
        re.compile(r"\bOWASP\b"),
        re.compile(r"\bdestructi\b", re.IGNORECASE),
        re.compile(r"\brevers\b", re.IGNORECASE),
        re.compile(r"\bblast radius\b", re.IGNORECASE),
    ],
    "output": [
        re.compile(r"\bconcise\b", re.IGNORECASE),
        re.compile(r"\bformatting\b", re.IGNORECASE),
        re.compile(r"\bmarkdown\b", re.IGNORECASE),
        re.compile(r"\bemoji\b", re.IGNORECASE),
        re.compile(r"\bterse\b", re.IGNORECASE),
    ],
    "task_execution": [
        re.compile(r"\bcommit\b", re.IGNORECASE),
        re.compile(r"\bpull request\b", re.IGNORECASE),
        re.compile(r"\bbranch\b", re.IGNORECASE),
        re.compile(r"\bgit\b"),
        re.compile(r"\bbug fix\b", re.IGNORECASE),
        re.compile(r"\brefactor\b", re.IGNORECASE),
    ],
    "memory": [
        re.compile(r"\bmemory\b", re.IGNORECASE),
        re.compile(r"\bremember\b", re.IGNORECASE),
        re.compile(r"\brecall\b", re.IGNORECASE),
        re.compile(r"\bpersist\b", re.IGNORECASE),
        re.compile(r"\bMEMORY\.md\b"),
    ],
    "environment": [
        re.compile(r"\bplatform\b", re.IGNORECASE),
        re.compile(r"\bshell\b", re.IGNORECASE),
        re.compile(r"\bOS\b"),
        re.compile(r"\bdarwin\b", re.IGNORECASE),
        re.compile(r"\bworking directory\b", re.IGNORECASE),
    ],
}


def classify_layer(unit_text: str, section_path: str) -> tuple[str, float]:
    """Classify a unit into a functional layer.

    Returns (layer, confidence) where confidence is 0.0-1.0.
    """
    path_lower = section_path.lower()

    # Primary signal: section path keywords
    path_scores: dict[str, int] = {}
    for layer, keywords in PATH_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in path_lower)
        if score > 0:
            path_scores[layer] = score

    if path_scores:
        best_layer = max(path_scores, key=path_scores.get)  # type: ignore[arg-type]
        if path_scores[best_layer] >= 2:
            return best_layer, 0.95
        # Check if unambiguous (only one match)
        if len(path_scores) == 1:
            return best_layer, 0.85

    # Secondary signal: content keyword patterns
    content_scores: dict[str, int] = {}
    for layer, patterns in CONTENT_PATTERNS.items():
        score = sum(1 for p in patterns if p.search(unit_text))
        if score > 0:
            content_scores[layer] = score

    if content_scores:
        best_content = max(content_scores, key=content_scores.get)  # type: ignore[arg-type]
        # If path also had a signal, combine
        if path_scores and best_content in path_scores:
            return best_content, 0.9
        if path_scores:
            # Path and content disagree - prefer path
            best_path = max(path_scores, key=path_scores.get)  # type: ignore[arg-type]
            return best_path, 0.7
        # Content-only signal
        if content_scores[best_content] >= 2:
            return best_content, 0.7
        return best_content, 0.5

    # Path had a signal but content didn't
    if path_scores:
        best_layer = max(path_scores, key=path_scores.get)  # type: ignore[arg-type]
        return best_layer, 0.75

    # Fallback
    return "task_execution", 0.3
