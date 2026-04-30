"""
Fetch new Claude Code prompt captures from cchistory.mariozechner.at.

Downloads any versions not already present in data/raw/ and updates
data/versions_meta.json with {version, release_date} entries.
"""

from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path
import urllib.request
import urllib.error

BASE_URL = "https://cchistory.mariozechner.at/data"
REPO_ROOT = Path(__file__).parent.parent
RAW_DIR = REPO_ROOT / "data" / "raw"
META_FILE = REPO_ROOT / "data" / "versions_meta.json"

_RELEASE_DATE_RE = re.compile(r"Release Date:\s*(.+)")


def _fetch_json(url: str) -> object:
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.loads(resp.read().decode())


def _fetch_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=60) as resp:
        return resp.read().decode()


def _parse_release_date(text: str) -> str:
    m = _RELEASE_DATE_RE.search(text[:2000])  # date is always near the top
    return m.group(1).strip() if m else ""


def _version_key(e: dict) -> tuple[int, ...]:
    try:
        return tuple(int(p) for p in e["version"].split("."))
    except ValueError:
        return (0,)


def main() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    # Load existing meta
    existing_meta: list[dict] = []
    if META_FILE.exists():
        existing_meta = json.loads(META_FILE.read_text())
    existing_versions = {e["version"] for e in existing_meta}

    # Fetch upstream version list — response is {"versions": [...], "lastUpdated": "..."}
    print(f"Fetching version list from {BASE_URL}/versions.json …")
    try:
        payload = _fetch_json(f"{BASE_URL}/versions.json")
    except urllib.error.URLError as exc:
        print(f"Error fetching version list: {exc}", file=sys.stderr)
        sys.exit(1)

    upstream: list[dict] = payload.get("versions", payload) if isinstance(payload, dict) else payload

    new_entries: list[dict] = []
    for item in upstream:
        version = item.get("version", "")
        if not version:
            continue

        dest = RAW_DIR / f"{version}.md"

        if dest.exists():
            # File already downloaded — patch meta if it is missing an entry
            if version not in existing_versions:
                release_date = _parse_release_date(dest.read_text(encoding="utf-8"))
                new_entries.append({"version": version, "release_date": release_date})
                existing_versions.add(version)
            continue

        url = f"{BASE_URL}/prompts-{version}.md"
        print(f"  Downloading {version} …")
        try:
            text = _fetch_text(url)
        except urllib.error.URLError as exc:
            print(f"  Warning: could not fetch {url}: {exc}", file=sys.stderr)
            continue

        dest.write_text(text, encoding="utf-8")
        release_date = _parse_release_date(text)
        new_entries.append({"version": version, "release_date": release_date})
        existing_versions.add(version)
        time.sleep(0.2)  # be polite to the upstream server

    if new_entries:
        combined = existing_meta + new_entries
        combined.sort(key=_version_key)
        META_FILE.write_text(json.dumps(combined, indent=2) + "\n", encoding="utf-8")
        print(f"Added {len(new_entries)} new version(s): {[e['version'] for e in new_entries]}")
    else:
        print("No new versions found.")


if __name__ == "__main__":
    main()
