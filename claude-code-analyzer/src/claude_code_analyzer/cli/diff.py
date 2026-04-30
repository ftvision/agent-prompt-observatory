"""diff subcommand — compare two specific versions."""

from __future__ import annotations

import difflib
import sys
from pathlib import Path

from ..snapshot import parse_snapshot
from ..diagnose import _extract_structure, _diff
from ..models import Snapshot


def add_diff_subparser(sub) -> None:
    p = sub.add_parser(
        "diff",
        help="Show structural and content diff between two versions",
    )
    p.add_argument("version_a", metavar="VERSION_A")
    p.add_argument("version_b", metavar="VERSION_B")
    p.add_argument(
        "--raw-dir",
        default="data/raw",
        metavar="DIR",
        help="Directory containing raw .md captures (default: data/raw)",
    )
    p.add_argument(
        "--structural-only",
        action="store_true",
        help="Skip content diff, show only structural changes",
    )
    p.add_argument(
        "--context",
        type=int,
        default=3,
        metavar="N",
        help="Lines of context in unified diff (default: 3)",
    )
    p.set_defaults(func=_cmd_diff)


def _leaf_components(snap: Snapshot) -> dict[str, str]:
    """Return {component_id: normalized_text} for each diffable leaf."""
    result: dict[str, str] = {}

    um = snap.components.get("user_message")
    if um:
        ap = um.children.get("user_message/actual_prompt")
        if ap:
            result["user_message/actual_prompt"] = ap.normalized

    sp = snap.components.get("system_prompt")
    if sp:
        for child_id, child in sp.children.items():
            result[child_id] = child.normalized

    tc = snap.components.get("tools")
    if tc:
        for child_id, child in tc.children.items():
            if child.kind != "tool":
                continue
            prose = child.children.get(f"{child_id}/prose")
            schema = child.children.get(f"{child_id}/schema")
            if prose:
                result[f"{child_id}/prose"] = prose.normalized
            if schema:
                result[f"{child_id}/schema"] = schema.normalized

    return result


def _print_structural_diff(diff, version_a: str, version_b: str) -> None:
    print(f"=== STRUCTURAL DIFF: {version_a} → {version_b} ===")
    lines: list[str] = []
    if diff.added_xml_tags:
        lines.append(f"  [user_message] +xml_tag: {', '.join(diff.added_xml_tags)}")
    if diff.removed_xml_tags:
        lines.append(f"  [user_message] -xml_tag: {', '.join(diff.removed_xml_tags)}")
    if diff.added_sp_sections:
        lines.append(f"  [system_prompt] +section: {', '.join(diff.added_sp_sections)}")
    if diff.removed_sp_sections:
        lines.append(f"  [system_prompt] -section: {', '.join(diff.removed_sp_sections)}")
    if diff.reordered_sp_sections:
        lines.append("  [system_prompt] sections reordered")
    if diff.added_tools:
        lines.append(f"  [tools] +tool: {', '.join(diff.added_tools)}")
    if diff.removed_tools:
        lines.append(f"  [tools] -tool: {', '.join(diff.removed_tools)}")
    if diff.reordered_tools:
        lines.append("  [tools] tools reordered")
    for w in diff.parse_warnings:
        lines.append(f"  [parse] {w}")
    if lines:
        for l in lines:
            print(l)
    else:
        print("  (no structural changes)")


def _print_content_diff(snap_a: Snapshot, snap_b: Snapshot, version_a: str, version_b: str, context: int) -> None:
    print(f"\n=== CONTENT DIFF: {version_a} → {version_b} ===")
    comps_a = _leaf_components(snap_a)
    comps_b = _leaf_components(snap_b)

    any_change = False
    for cid in sorted(set(comps_a) | set(comps_b)):
        text_a = comps_a.get(cid, "")
        text_b = comps_b.get(cid, "")
        if text_a == text_b:
            continue

        any_change = True
        print(f"\n{cid}:")
        if not text_a:
            print("  (new)")
            continue
        if not text_b:
            print("  (removed)")
            continue

        udiff = list(difflib.unified_diff(
            text_a.splitlines(),
            text_b.splitlines(),
            fromfile=version_a,
            tofile=version_b,
            lineterm="",
            n=context,
        ))
        for line in udiff[2:]:  # skip --- +++ header (already labeled by cid)
            print(f"  {line}")

    if not any_change:
        print("  (no content changes)")


def _cmd_diff(args) -> None:
    raw_dir = Path(args.raw_dir)
    file_a = raw_dir / f"{args.version_a}.md"
    file_b = raw_dir / f"{args.version_b}.md"

    for f, v in [(file_a, args.version_a), (file_b, args.version_b)]:
        if not f.exists():
            print(f"Error: {f} not found", file=sys.stderr)
            sys.exit(1)

    print(f"Parsing {args.version_a} …", flush=True)
    snap_a = parse_snapshot(str(file_a))
    print(f"Parsing {args.version_b} …", flush=True)
    snap_b = parse_snapshot(str(file_b))
    print()

    struct_a = _extract_structure(snap_a)
    struct_b = _extract_structure(snap_b)
    _print_structural_diff(_diff(struct_a, struct_b), args.version_a, args.version_b)

    if not args.structural_only:
        _print_content_diff(snap_a, snap_b, args.version_a, args.version_b, args.context)
