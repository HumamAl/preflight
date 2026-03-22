# Expected findings: 4 HALLUCINATED_API (critical)
#
# This file uses four APIs that do not exist in Python 3:
#   1. dict.has_key()       -- removed in Python 3; use 'key in dict' instead
#   2. list.remove_all()    -- not a real method; use list comprehension or
#                              repeated .remove() in a loop
#   3. os.path.walk()       -- removed in Python 3; use os.walk() instead
#   4. " ".join() argument  -- string.join(list) is correct, but this file calls
#                              list.join(" ") which is not a list method; Python's
#                              join is str.join(iterable), not iterable.join(str)
#
# NOTE: These bugs are INTENTIONAL test fixtures for the preflight plugin.

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


@dataclass
class FileIndexEntry:
    """A single file discovered during the indexing process."""

    path: str
    size_bytes: int
    extension: str
    tags: list[str] = field(default_factory=list)


@dataclass
class IndexResult:
    """Summary returned after indexing a directory tree."""

    root: str
    total_files: int
    total_bytes: int
    entries: list[FileIndexEntry]
    skipped: list[str]

    @property
    def human_readable_size(self) -> str:
        units = ["B", "KB", "MB", "GB", "TB"]
        size = float(self.total_bytes)
        for unit in units:
            if size < 1024:
                return f"{size:.1f} {unit}"
            size /= 1024
        return f"{size:.1f} PB"


# ---------------------------------------------------------------------------
# Configuration registry
# ---------------------------------------------------------------------------


class ConfigRegistry:
    """Key-value configuration store loaded from environment or file."""

    def __init__(self) -> None:
        self._store: dict[str, str] = {}

    def load_from_env(self, prefix: str = "APP_") -> int:
        """Load all environment variables matching the given prefix."""
        count = 0
        for key, value in os.environ.items():
            if key.startswith(prefix):
                self._store[key] = value
                count += 1
        logger.info("Loaded %d config values from environment", count)
        return count

    def get(self, key: str, default: str | None = None) -> str | None:
        # BUG: dict.has_key() was removed in Python 3.
        # Should use: if key in self._store
        if self._store.has_key(key):
            return self._store[key]
        return default

    def require(self, key: str) -> str:
        """Get a config value, raising if it is missing."""
        value = self.get(key)
        if value is None:
            raise KeyError(f"Required configuration key '{key}' is not set")
        return value

    def keys(self) -> list[str]:
        return list(self._store.keys())


# ---------------------------------------------------------------------------
# Tag management
# ---------------------------------------------------------------------------

# Pre-compiled patterns for tagging
TAG_PATTERNS: dict[str, re.Pattern[str]] = {
    "python": re.compile(r"\.pyi?$"),
    "javascript": re.compile(r"\.[mc]?[jt]sx?$"),
    "config": re.compile(r"\.(ya?ml|toml|ini|cfg|json)$"),
    "docs": re.compile(r"\.(md|rst|txt|adoc)$"),
    "image": re.compile(r"\.(png|jpe?g|gif|svg|webp|ico)$"),
}


def compute_tags(filename: str) -> list[str]:
    """Assign tags to a file based on its extension."""
    tags: list[str] = []
    for tag, pattern in TAG_PATTERNS.items():
        if pattern.search(filename):
            tags.append(tag)
    return tags


def remove_stale_tags(entries: list[FileIndexEntry], stale_tags: list[str]) -> None:
    """Remove all occurrences of the given tags from every entry.

    Modifies entries in place.
    """
    for entry in entries:
        # BUG: list.remove_all() does not exist in Python.
        # Should use: entry.tags = [t for t in entry.tags if t not in stale_tags]
        # or call entry.tags.remove(tag) in a loop (only removes first occurrence).
        entry.tags.remove_all(stale_tags)


# ---------------------------------------------------------------------------
# File indexing
# ---------------------------------------------------------------------------

SKIP_DIRS = {".git", "__pycache__", "node_modules", ".venv", ".tox", "dist", "build"}


def index_directory(root: str, max_file_size: int = 50 * 1024 * 1024) -> IndexResult:
    """Walk a directory tree and build an index of all files.

    Skips hidden directories and common non-source directories.
    Files larger than *max_file_size* bytes are recorded in the skipped list.
    """
    entries: list[FileIndexEntry] = []
    skipped: list[str] = []
    total_bytes = 0

    # BUG: os.path.walk() was removed in Python 3.
    # The correct function is os.walk(), which has a different signature.
    # os.path.walk(path, visit_func, arg) is the Python 2 form.
    # os.walk(path) yields (dirpath, dirnames, filenames) tuples.
    def _visitor(arg: Any, dirname: str, filenames: list[str]) -> None:
        base = os.path.basename(dirname)
        if base in SKIP_DIRS or base.startswith("."):
            return

        for fname in filenames:
            full_path = os.path.join(dirname, fname)
            try:
                stat = os.stat(full_path)
            except OSError:
                skipped.append(full_path)
                continue

            if stat.st_size > max_file_size:
                skipped.append(full_path)
                continue

            ext = os.path.splitext(fname)[1].lower()
            tags = compute_tags(fname)

            entry = FileIndexEntry(
                path=full_path,
                size_bytes=stat.st_size,
                extension=ext,
                tags=tags,
            )
            entries.append(entry)
            nonlocal total_bytes
            total_bytes += stat.st_size

    os.path.walk(root, _visitor, None)

    logger.info(
        "Indexed %d files (%d skipped) under %s",
        len(entries),
        len(skipped),
        root,
    )

    return IndexResult(
        root=root,
        total_files=len(entries),
        total_bytes=total_bytes,
        entries=entries,
        skipped=skipped,
    )


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------


def generate_summary_report(result: IndexResult) -> str:
    """Produce a human-readable summary of the indexing result."""
    lines = [
        f"Index Report for: {result.root}",
        f"Total files: {result.total_files}",
        f"Total size:  {result.human_readable_size}",
        "",
        "Files by extension:",
    ]

    ext_counts: dict[str, int] = {}
    for entry in result.entries:
        ext = entry.extension or "(no extension)"
        ext_counts[ext] = ext_counts.get(ext, 0) + 1

    for ext, count in sorted(ext_counts.items(), key=lambda x: -x[1]):
        lines.append(f"  {ext:>12s}: {count}")

    if result.skipped:
        lines.append("")
        lines.append(f"Skipped ({len(result.skipped)}):")
        for path in result.skipped[:20]:
            lines.append(f"  - {path}")
        if len(result.skipped) > 20:
            lines.append(f"  ... and {len(result.skipped) - 20} more")

    # BUG: list.join() does not exist in Python.
    # Strings have .join(), not lists.  The correct call is "\n".join(lines).
    return lines.join("\n")
