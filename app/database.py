"""SQLite connection management and database initialization."""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(
    os.environ.get("TASKS_DB_PATH", str(PROJECT_ROOT / "productivity.db"))
).expanduser()

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    estimated_minutes INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'inbox',
    scheduled_start DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task_notes (
    task_id INTEGER NOT NULL,
    note_id INTEGER NOT NULL,
    PRIMARY KEY (task_id, note_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_notes_note_id ON task_notes(note_id, task_id);
"""


def get_connection() -> sqlite3.Connection:
    """Open a SQLite connection to the configured productivity database."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(DB_PATH), timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_database() -> None:
    """Create the tasks table and its status index if they do not exist."""
    connection = get_connection()
    try:
        connection.executescript(SCHEMA_SQL)
        connection.commit()
    finally:
        connection.close()
