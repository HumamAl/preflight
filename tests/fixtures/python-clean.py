# Expected findings: 0 (this file should pass preflight cleanly)
#
# This file demonstrates well-written Python with correct imports, proper API
# usage, type hints, context managers, pathlib, thorough error handling, and
# no known issues.

from __future__ import annotations

import json
import logging
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Generator, Iterator

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DocumentMeta:
    """Immutable metadata for a stored document."""

    doc_id: str
    title: str
    author: str
    created_at: datetime
    tags: tuple[str, ...] = ()


@dataclass
class Document:
    """A document with metadata and content."""

    meta: DocumentMeta
    content: str
    revision: int = 1
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def word_count(self) -> int:
        return len(self.content.split())

    def summary(self, max_length: int = 120) -> str:
        """Return a truncated preview of the document content."""
        if len(self.content) <= max_length:
            return self.content
        return self.content[:max_length].rsplit(" ", 1)[0] + "..."


# ---------------------------------------------------------------------------
# Storage backend
# ---------------------------------------------------------------------------


class DocumentStore:
    """File-backed document store using pathlib and context managers.

    Each document is stored as a JSON file under *base_dir*, keyed by doc_id.
    """

    def __init__(self, base_dir: Path) -> None:
        self._base_dir = base_dir
        self._base_dir.mkdir(parents=True, exist_ok=True)
        logger.info("DocumentStore initialized at %s", self._base_dir)

    def _doc_path(self, doc_id: str) -> Path:
        """Return the filesystem path for a given document ID."""
        safe_id = doc_id.replace("/", "_").replace("..", "_")
        return self._base_dir / f"{safe_id}.json"

    def save(self, doc: Document) -> Path:
        """Persist a document to disk. Overwrites any existing revision."""
        path = self._doc_path(doc.meta.doc_id)
        payload = {
            "doc_id": doc.meta.doc_id,
            "title": doc.meta.title,
            "author": doc.meta.author,
            "created_at": doc.meta.created_at.isoformat(),
            "tags": list(doc.meta.tags),
            "content": doc.content,
            "revision": doc.revision,
            "updated_at": doc.updated_at.isoformat(),
        }

        tmp_path = path.with_suffix(".tmp")
        try:
            tmp_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            tmp_path.replace(path)
        except OSError:
            # Clean up partial write on failure
            tmp_path.unlink(missing_ok=True)
            raise

        logger.debug("Saved document %s (rev %d)", doc.meta.doc_id, doc.revision)
        return path

    def load(self, doc_id: str) -> Document:
        """Load a document from disk by its ID.

        Raises FileNotFoundError if the document does not exist.
        """
        path = self._doc_path(doc_id)
        try:
            raw = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            raise FileNotFoundError(f"Document not found: {doc_id}") from None

        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"Corrupt document file for {doc_id}: {exc}"
            ) from exc

        meta = DocumentMeta(
            doc_id=data["doc_id"],
            title=data["title"],
            author=data["author"],
            created_at=datetime.fromisoformat(data["created_at"]),
            tags=tuple(data.get("tags", [])),
        )
        return Document(
            meta=meta,
            content=data["content"],
            revision=data.get("revision", 1),
            updated_at=datetime.fromisoformat(data["updated_at"]),
        )

    def delete(self, doc_id: str) -> bool:
        """Delete a document. Returns True if removed, False if not found."""
        path = self._doc_path(doc_id)
        try:
            path.unlink()
            logger.debug("Deleted document %s", doc_id)
            return True
        except FileNotFoundError:
            return False

    def list_ids(self) -> list[str]:
        """Return all document IDs currently on disk, sorted alphabetically."""
        return sorted(
            p.stem for p in self._base_dir.glob("*.json")
        )

    def iter_documents(self) -> Iterator[Document]:
        """Lazily iterate over all stored documents."""
        for doc_id in self.list_ids():
            try:
                yield self.load(doc_id)
            except (ValueError, FileNotFoundError) as exc:
                logger.warning("Skipping unreadable document %s: %s", doc_id, exc)


# ---------------------------------------------------------------------------
# Batch operations with context manager
# ---------------------------------------------------------------------------


@contextmanager
def batch_import(
    store: DocumentStore,
    source_path: Path,
) -> Generator[list[Document], None, None]:
    """Context manager for batch-importing documents from a JSON-lines file.

    Yields the list of successfully imported documents. On exit, logs a summary
    regardless of whether an exception occurred.
    """
    imported: list[Document] = []
    errors: list[str] = []

    logger.info("Starting batch import from %s", source_path)

    try:
        with source_path.open("r", encoding="utf-8") as fh:
            for line_no, line in enumerate(fh, start=1):
                line = line.strip()
                if not line:
                    continue

                try:
                    data = json.loads(line)
                except json.JSONDecodeError as exc:
                    errors.append(f"Line {line_no}: invalid JSON ({exc})")
                    continue

                required_keys = {"doc_id", "title", "author", "content"}
                missing = required_keys - data.keys()
                if missing:
                    errors.append(
                        f"Line {line_no}: missing keys {sorted(missing)}"
                    )
                    continue

                meta = DocumentMeta(
                    doc_id=data["doc_id"],
                    title=data["title"],
                    author=data["author"],
                    created_at=datetime.now(timezone.utc),
                    tags=tuple(data.get("tags", [])),
                )
                doc = Document(meta=meta, content=data["content"])
                store.save(doc)
                imported.append(doc)

        yield imported

    finally:
        logger.info(
            "Batch import complete: %d imported, %d errors",
            len(imported),
            len(errors),
        )
        for err in errors:
            logger.warning("  %s", err)


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------


def search_by_tag(
    store: DocumentStore,
    tag: str,
    *,
    case_sensitive: bool = False,
) -> list[Document]:
    """Return all documents that have the given tag."""
    normalized_tag = tag if case_sensitive else tag.lower()
    results: list[Document] = []

    for doc in store.iter_documents():
        doc_tags = doc.meta.tags if case_sensitive else tuple(
            t.lower() for t in doc.meta.tags
        )
        if normalized_tag in doc_tags:
            results.append(doc)

    results.sort(key=lambda d: d.meta.created_at, reverse=True)
    return results


def compute_statistics(store: DocumentStore) -> dict[str, Any]:
    """Compute aggregate statistics across all documents."""
    total_docs = 0
    total_words = 0
    tag_counts: dict[str, int] = {}
    authors: set[str] = set()

    for doc in store.iter_documents():
        total_docs += 1
        total_words += doc.word_count
        authors.add(doc.meta.author)
        for tag in doc.meta.tags:
            tag_counts[tag] = tag_counts.get(tag, 0) + 1

    avg_words = total_words / total_docs if total_docs > 0 else 0.0

    return {
        "total_documents": total_docs,
        "total_words": total_words,
        "average_words_per_document": round(avg_words, 1),
        "unique_authors": len(authors),
        "top_tags": sorted(tag_counts.items(), key=lambda x: -x[1])[:10],
    }
