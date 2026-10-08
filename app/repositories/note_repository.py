"""SQLite queries for notes and task-note relationships."""

from __future__ import annotations

from typing import Any

from app.database import get_connection


NoteRecord = dict[str, Any]
TaskNoteLink = dict[str, int]


class RelatedEntityNotFoundError(LookupError):
    """Raised when a task or note required for a relationship is missing."""

    def __init__(self, entity: str, entity_id: int):
        self.entity = entity
        self.entity_id = entity_id
        super().__init__(f"{entity} {entity_id} not found")


def _row_to_dict(row: Any) -> dict[str, Any]:
    return dict(row)


def create_note(content: str, tags: str = "") -> NoteRecord:
    """Insert a Markdown note and return the stored record."""
    connection = get_connection()
    try:
        cursor = connection.execute(
            "INSERT INTO notes (content, tags) VALUES (?, ?)",
            (content, tags),
        )
        connection.commit()
        row = connection.execute(
            "SELECT id, content, tags, created_at FROM notes WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
        if row is None:  # Defensive: the inserted row should always be present.
            raise RuntimeError("Inserted note could not be read back from the database")
        return _row_to_dict(row)
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def get_notes() -> list[NoteRecord]:
    """Return all notes, newest first."""
    connection = get_connection()
    try:
        rows = connection.execute(
            "SELECT id, content, tags, created_at FROM notes ORDER BY created_at DESC, id DESC"
        ).fetchall()
        return [_row_to_dict(row) for row in rows]
    finally:
        connection.close()


def get_note(note_id: int) -> NoteRecord | None:
    """Return one note, or None if its id does not exist."""
    connection = get_connection()
    try:
        row = connection.execute(
            "SELECT id, content, tags, created_at FROM notes WHERE id = ?",
            (note_id,),
        ).fetchone()
        return _row_to_dict(row) if row is not None else None
    finally:
        connection.close()


def link_note_to_task(task_id: int, note_id: int) -> TaskNoteLink:
    """Create an idempotent task-note link after validating both records."""
    connection = get_connection()
    try:
        # Keep existence checks and insert atomic with respect to other writers.
        connection.execute("BEGIN IMMEDIATE")
        task = connection.execute(
            "SELECT id FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
        if task is None:
            raise RelatedEntityNotFoundError("Task", task_id)

        note = connection.execute(
            "SELECT id FROM notes WHERE id = ?", (note_id,)
        ).fetchone()
        if note is None:
            raise RelatedEntityNotFoundError("Note", note_id)

        connection.execute(
            "INSERT OR IGNORE INTO task_notes (task_id, note_id) VALUES (?, ?)",
            (task_id, note_id),
        )
        connection.commit()
        return {"task_id": task_id, "note_id": note_id}
    except Exception:
        if connection.in_transaction:
            connection.rollback()
        raise
    finally:
        connection.close()


def get_task_context(task_id: int) -> dict[str, Any] | None:
    """Return a task and its linked notes, or None if the task is missing."""
    connection = get_connection()
    try:
        task = connection.execute(
            "SELECT id, title, category, estimated_minutes, status, "
            "scheduled_start, created_at FROM tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
        if task is None:
            return None

        notes = connection.execute(
            "SELECT n.id, n.content, n.tags, n.created_at "
            "FROM notes AS n "
            "JOIN task_notes AS tn ON tn.note_id = n.id "
            "WHERE tn.task_id = ? "
            "ORDER BY n.created_at ASC, n.id ASC",
            (task_id,),
        ).fetchall()
        return {
            "task": _row_to_dict(task),
            "notes": [_row_to_dict(row) for row in notes],
        }
    finally:
        connection.close()


def get_tasks_for_note(note_id: int) -> list[dict[str, Any]] | None:
    """Return every task linked to a note, or None if the note is missing."""
    connection = get_connection()
    try:
        note = connection.execute(
            "SELECT id FROM notes WHERE id = ?", (note_id,)
        ).fetchone()
        if note is None:
            return None

        rows = connection.execute(
            "SELECT t.id, t.title, t.category, t.estimated_minutes, t.status, "
            "t.scheduled_start, t.created_at "
            "FROM tasks AS t "
            "JOIN task_notes AS tn ON tn.task_id = t.id "
            "WHERE tn.note_id = ? "
            "ORDER BY t.id ASC",
            (note_id,),
        ).fetchall()
        return [_row_to_dict(row) for row in rows]
    finally:
        connection.close()
