"""diagnose subcommand."""

from __future__ import annotations

import sys
from pathlib import Path

from ..snapshot import parse_snapshot


def add_diagnose_subparser(sub) -> None:
    p = sub.add_parser(
        "diagnose",
        help="Parse all versions in a directory and report structural changes",
    )
    p.add_argument(
        "raw_dir",
        nargs="?",
        default="data/raw",
        help="Directory containing raw .md captures (default: data/raw)",
    )
    p.add_argument(
        "--since",
        metavar="VERSION",
        help="Only show changes from this version onward",
    )
    p.add_argument(
        "--only-changes",
        action="store_true",
        help="Skip versions with no structural changes",
    )
    p.add_argument(
        "--no-summary",
        action="store_true",
        help="Omit the XML tags / sections / tools summary tables",
    )
    p.set_defaults(func=_cmd_diagnose)


def _cmd_diagnose(args) -> None:
    from ..diagnose import run_diagnose

    raw_dir = Path(args.raw_dir)
    if not raw_dir.is_dir():
        print(f"Error: {raw_dir} is not a directory", file=sys.stderr)
        sys.exit(1)

    run_diagnose(
        raw_dir=raw_dir,
        parse_fn=parse_snapshot,
        since=args.since,
        only_changes=args.only_changes,
        show_summary=not args.no_summary,
    )
