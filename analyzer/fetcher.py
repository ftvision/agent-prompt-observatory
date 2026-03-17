"""Fetch all available versions from cchistory API and cache raw markdown."""
from __future__ import annotations

import json
import ssl
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

BASE_URL = "https://cchistory.mariozechner.at/data"
SSL_CONTEXT = ssl._create_unverified_context()


def fetch_json(url: str) -> Any:
    with urlopen(url, context=SSL_CONTEXT) as response:
        return json.load(response)


def fetch_text(url: str) -> str:
    with urlopen(url, context=SSL_CONTEXT) as response:
        return response.read().decode("utf-8")


def fetch_all_versions(data_dir: Path) -> list[dict[str, str]]:
    """Fetch version list and download all raw prompts.

    Returns list of {"version": str, "markdown": str} dicts, ordered oldest-first.
    Caches raw markdown in data_dir/raw/.
    """
    raw_dir = data_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    versions_payload = fetch_json(f"{BASE_URL}/versions.json")
    all_versions = versions_payload["versions"]

    results = []
    for entry in all_versions:
        version = entry["version"]
        cache_path = raw_dir / f"{version}.md"

        if cache_path.exists():
            markdown = cache_path.read_text(encoding="utf-8")
        else:
            try:
                markdown = fetch_text(f"{BASE_URL}/prompts-{version}.md")
                cache_path.write_text(markdown, encoding="utf-8")
            except (HTTPError, URLError) as exc:
                print(f"  Warning: could not fetch {version}: {exc}")
                continue

        results.append({"version": version, "markdown": markdown})

    print(f"  Fetched {len(results)} versions ({results[0]['version']} .. {results[-1]['version']})")
    return results
