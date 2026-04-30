"""Command-line interface for the Claude Code analyzer."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .snapshot import parse_snapshot


def _cmd_diagnose(args: argparse.Namespace) -> None:
    from .diagnose import run_diagnose

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


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="cca",
        description="Claude Code prompt analyzer",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # diagnose
    diag = sub.add_parser(
        "diagnose",
        help="Parse all versions in a directory and report structural changes",
    )
    diag.add_argument(
        "raw_dir",
        nargs="?",
        default="data/raw",
        help="Directory containing raw .md captures (default: data/raw)",
    )
    diag.add_argument(
        "--since",
        metavar="VERSION",
        help="Only show changes from this version onward",
    )
    diag.add_argument(
        "--only-changes",
        action="store_true",
        help="Skip versions with no structural changes",
    )
    diag.add_argument(
        "--no-summary",
        action="store_true",
        help="Omit the XML tags / sections / tools summary tables",
    )
    diag.set_defaults(func=_cmd_diagnose)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
