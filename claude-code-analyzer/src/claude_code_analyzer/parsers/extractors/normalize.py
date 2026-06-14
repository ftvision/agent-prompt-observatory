"""Shared text normalization + hashing for component extraction.

Normalization exists so two captures of the *same* prompt component hash and
size identically even when the capture harness injects volatile, per-run
values. Without this, every daily refresh and every version bump would look
like a content change.

Volatile tokens masked here:

- Session temp paths (``/tmp/claude-<session>``) and project dir names.
- The ``cc_version`` in the billing header. It tracks the release, so it
  changes on *every* version and would otherwise churn the System Prompt
  preamble's hash on each bump (and its char count whenever the version
  gains a digit).
- ISO dates and datetimes. The capture stamps "today's date" and a haiku
  timestamp into the User Message, so they change on every daily refresh.

Keep every mask a fixed-width placeholder so a masked component's char count
stays stable across captures, not just its hash.
"""

from __future__ import annotations

import hashlib
import re

# datetime must run before the bare-date rule so the date-only pattern doesn't
# eat the leading YYYY-MM-DD of a full timestamp and strand the time portion.
_ISO_DATETIME_RE = re.compile(
    r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?"
)
_ISO_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
_CC_VERSION_RE = re.compile(r"(cc_version=)\d+(?:\.\d+)*")


def normalize(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [l.rstrip() for l in text.split("\n")]
    text = "\n".join(lines)
    text = re.sub(r"/tmp/claude-[^\s]+", "/tmp/claude-<session>", text)
    text = re.sub(r"(/\.claude/projects/)[^/\s]+", r"\1<project>", text)
    text = _CC_VERSION_RE.sub(r"\1<version>", text)
    text = _ISO_DATETIME_RE.sub("<datetime>", text)
    text = _ISO_DATE_RE.sub("<date>", text)
    return text.strip()


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]
