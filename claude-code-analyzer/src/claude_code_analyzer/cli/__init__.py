"""Command-line interface for the Claude Code analyzer."""

from __future__ import annotations

import argparse

from .diagnose import add_diagnose_subparser
from .diff import add_diff_subparser


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="cca",
        description="Claude Code prompt analyzer",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    add_diagnose_subparser(sub)
    add_diff_subparser(sub)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
