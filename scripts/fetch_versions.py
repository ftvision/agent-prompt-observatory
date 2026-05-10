"""
Fetch new Claude Code prompt captures from marckrenn/claude-code-changelog.

Upstream tracks the live system prompt as a rolling `cc-prompt.md` whose git
history records one commit per release ("Update prompt to version X.Y.Z").
Sometimes a release's initial capture is buggy (e.g. dev-server HMR text leaks
into the prompt) and upstream follows up with "Fix cc-prompt for vX.Y.Z" — we
match both patterns so the fix wins the dedup.

We walk that commit history, download the file content at each version's
newest matching commit, and save it as `data/raw/{version}.md`. Each entry
in `versions_meta.json` records the upstream commit SHA so a future fix
commit on a version we already captured triggers a re-download.

Set GITHUB_TOKEN in the environment to lift the unauthenticated 60/hr limit
when running in CI.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path
import urllib.request
import urllib.error

REPO = "marckrenn/claude-code-changelog"
PROMPT_PATH = "cc-prompt.md"
COMMITS_URL = f"https://api.github.com/repos/{REPO}/commits"
RAW_URL = f"https://raw.githubusercontent.com/{REPO}/{{sha}}/{PROMPT_PATH}"

REPO_ROOT = Path(__file__).parent.parent
RAW_DIR = REPO_ROOT / "data" / "raw"
META_FILE = REPO_ROOT / "data" / "versions_meta.json"

_RELEASE_DATE_RE = re.compile(r"Release Date:\s*(.+)")
_VERSION_MSG_RE = re.compile(
    r"(?:Update prompt to version\s+|Fix cc-prompt for v)([0-9]+\.[0-9]+\.[0-9]+)"
)


def _request(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "claude-system-evolution"})
    token = os.environ.get("GITHUB_TOKEN")
    if token and url.startswith("https://api.github.com/"):
        req.add_header("Authorization", f"Bearer {token}")
        req.add_header("Accept", "application/vnd.github+json")
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def _fetch_json(url: str) -> object:
    return json.loads(_request(url).decode())


def _fetch_text(url: str) -> str:
    return _request(url).decode()


def _parse_release_date(text: str) -> str:
    m = _RELEASE_DATE_RE.search(text[:2000])  # date is always near the top
    return m.group(1).strip() if m else ""


def _release_date(text: str, fallback: str) -> str:
    """Parsed release date if it looks like a real date, otherwise the commit date.
    marckrenn writes a literal 'Release Date: Unknown' in cc-prompt.md, so we
    treat any non-ISO-date value as missing."""
    parsed = _parse_release_date(text)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", parsed):
        return parsed
    return fallback


def _version_key(e: dict) -> tuple[int, ...]:
    try:
        return tuple(int(p) for p in e["version"].split("."))
    except ValueError:
        return (0,)


def _list_version_commits() -> list[dict]:
    """Return [{version, sha, commit_date}] for every commit that announces a version, newest first."""
    seen: set[str] = set()
    out: list[dict] = []
    page = 1
    while True:
        url = f"{COMMITS_URL}?path={PROMPT_PATH}&per_page=100&page={page}"
        batch = _fetch_json(url)
        if not batch:
            break
        for c in batch:
            msg = c.get("commit", {}).get("message", "")
            m = _VERSION_MSG_RE.search(msg)
            if not m:
                continue
            version = m.group(1)
            if version in seen:
                continue  # keep the newest commit for a given version
            seen.add(version)
            out.append({
                "version": version,
                "sha": c["sha"],
                "commit_date": c.get("commit", {}).get("author", {}).get("date", "")[:10],
            })
        if len(batch) < 100:
            break
        page += 1
    return out


def main() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    existing_meta: list[dict] = []
    if META_FILE.exists():
        existing_meta = json.loads(META_FILE.read_text())
    by_version: dict[str, dict] = {e["version"]: dict(e) for e in existing_meta}

    print(f"Fetching commit history for {REPO}:{PROMPT_PATH} …")
    try:
        commits = _list_version_commits()
    except urllib.error.URLError as exc:
        print(f"Error fetching commit history: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"  Upstream lists {len(commits)} versioned commits.")

    added: list[str] = []
    refreshed: list[str] = []
    backfilled: list[str] = []

    for entry in commits:
        version = entry["version"]
        sha = entry["sha"]
        commit_date = entry["commit_date"]
        dest = RAW_DIR / f"{version}.md"
        existing = by_version.get(version)

        # Already in sync with upstream — nothing to do.
        if existing and existing.get("sha") == sha and dest.exists():
            continue

        # File on disk + meta entry without a recorded SHA: this is a one-time
        # migration for entries captured before SHA tracking. Trust the file
        # and just record the current upstream SHA so future fix commits will
        # be detected via the mismatch path below. (Avoids a 300-file re-fetch
        # the first time a user runs the updated script.)
        if existing and "sha" not in existing and dest.exists():
            existing["sha"] = sha
            backfilled.append(version)
            continue

        # Either the file is missing, or upstream's SHA changed (a fix commit
        # landed for a version we already had). Re-download.
        url = RAW_URL.format(sha=sha)
        action = "Re-fetching" if existing else "Downloading"
        print(f"  {action} {version} (sha {sha[:8]}) …")
        try:
            text = _fetch_text(url)
        except urllib.error.URLError as exc:
            print(f"  Warning: could not fetch {url}: {exc}", file=sys.stderr)
            continue

        dest.write_text(text, encoding="utf-8")
        release_date = _release_date(text, commit_date)
        by_version[version] = {"version": version, "release_date": release_date, "sha": sha}
        (refreshed if existing else added).append(version)
        time.sleep(0.2)  # be polite to the upstream server

    if added or refreshed or backfilled:
        combined = sorted(by_version.values(), key=_version_key)
        META_FILE.write_text(json.dumps(combined, indent=2) + "\n", encoding="utf-8")
        if added:
            print(f"Added {len(added)} new version(s): {added}")
        if refreshed:
            print(f"Refreshed {len(refreshed)} version(s) from upstream fix commits: {refreshed}")
        if backfilled:
            print(f"Backfilled SHA for {len(backfilled)} existing version(s).")
    else:
        print("No new versions found.")


if __name__ == "__main__":
    main()
