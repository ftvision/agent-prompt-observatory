"""export subcommand — export parsed snapshot data as static JSON for the UI."""

from __future__ import annotations

import sys
from pathlib import Path


def add_export_subparser(sub) -> None:
    p = sub.add_parser("export", help="Export parsed data as static JSON for the UI")
    p.add_argument(
        "raw_dir",
        nargs="?",
        default="data/raw",
        help="Directory containing raw .md captures (default: data/raw)",
    )
    p.add_argument(
        "--output-dir",
        default="ui/public/data",
        metavar="DIR",
        help="Directory to write JSON output files (default: ui/public/data)",
    )
    p.set_defaults(func=_cmd_export)


def _cmd_export(args) -> None:
    from ..export import run_export
    from ..snapshot import parse_snapshot

    raw_dir = Path(args.raw_dir)
    if not raw_dir.is_dir():
        print(f"Error: {raw_dir} is not a directory", file=sys.stderr)
        sys.exit(1)

    output_dir = Path(args.output_dir)

    run_export(
        raw_dir=raw_dir,
        output_dir=output_dir,
        parse_fn=parse_snapshot,
    )
