"""API tests for notes and task context views."""

from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.database import get_connection, initialize_database
from app.main import app


class NotesAPITests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "notes-test.db"
        self.db_path_patch = patch("app.database.DB_PATH", self.db_path)
        self.db_path_patch.start()
        self.client = TestClient(app)
        self.client.__enter__()

    def tearDown(self) -> None:
        self.client.__exit__(None, None, None)
        self.db_path_patch.stop()
        self.temp_dir.cleanup()

    def create_task(self, title: str) -> int:
        response = self.client.post(
            "/tasks",
            json={"title": title, "category": "Research", "estimated_minutes": 30},
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["id"]

    def create_note(self, content: str, tags: str) -> dict:
        response = self.client.post("/notes", json={"content": content, "tags": tags})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_notes_links_context_reverse_lookup_and_aliases(self) -> None:
        task_one = self.create_task("Prepare literature review")
        task_two = self.create_task("Draft research summary")
        note_one = self.create_note("## Background\n\n  - Preserve Markdown indentation", "research, ai, ")
        note_two = self.create_note("Source notes", "reading")

        note_one_id = note_one["id"]
        note_two_id = note_two["id"]
        self.assertEqual(note_one["tags"], "research, ai")

        # PUT is idempotent, and both tasks and notes can have multiple links.
        for _ in range(2):
            linked = self.client.put(f"/tasks/{task_one}/notes/{note_one_id}")
            self.assertEqual(linked.status_code, 200, linked.text)
            self.assertEqual(linked.json(), {"task_id": task_one, "note_id": note_one_id})
        self.assertEqual(
            self.client.put(f"/tasks/{task_one}/notes/{note_two_id}").status_code,
            200,
        )
        self.assertEqual(
            self.client.put(f"/api/tasks/{task_two}/notes/{note_one_id}").status_code,
            200,
        )

        fetched_note = self.client.get(f"/api/notes/{note_one_id}")
        self.assertEqual(fetched_note.status_code, 200)
        self.assertEqual(fetched_note.json()["content"], note_one["content"])
        self.assertEqual(len(self.client.get("/api/notes").json()), 2)

        context = self.client.get(f"/api/tasks/{task_one}/context")
        self.assertEqual(context.status_code, 200, context.text)
        self.assertEqual(context.json()["task"]["id"], task_one)
        self.assertEqual(
            {note["id"] for note in context.json()["notes"]},
            {note_one_id, note_two_id},
        )

        reverse_links = self.client.get(f"/notes/{note_one_id}/tasks")
        self.assertEqual(reverse_links.status_code, 200)
        self.assertEqual({task["id"] for task in reverse_links.json()}, {task_one, task_two})

        self.assertEqual(self.client.get("/notes/999999").status_code, 404)
        self.assertEqual(self.client.get("/tasks/999999/context").status_code, 404)
        self.assertEqual(self.client.put("/tasks/999999/notes/999999").status_code, 404)

        # Foreign-key cascades remove associations when a task is deleted.
        self.assertEqual(self.client.delete(f"/tasks/{task_one}").status_code, 204)
        remaining_links = self.client.get(f"/notes/{note_two_id}/tasks")
        self.assertEqual(remaining_links.status_code, 200)
        self.assertEqual(remaining_links.json(), [])

        schema = self.client.get("/openapi.json").json()["paths"]
        self.assertIn("/notes", schema)
        self.assertIn("/tasks/{task_id}/context", schema)
        self.assertNotIn("/api/notes", schema)

    def test_schema_upgrade_preserves_existing_tasks(self) -> None:
        legacy_path = Path(self.temp_dir.name) / "legacy.db"
        with sqlite3.connect(legacy_path) as connection:
            connection.executescript(
                "CREATE TABLE tasks ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, "
                "category TEXT NOT NULL, estimated_minutes INTEGER NOT NULL, "
                "status TEXT NOT NULL DEFAULT 'inbox', scheduled_start DATETIME, "
                "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);"
                "INSERT INTO tasks (title, category, estimated_minutes) "
                "VALUES ('Existing task', 'Work', 25);"
            )

        with patch("app.database.DB_PATH", legacy_path):
            initialize_database()
            connection = get_connection()
            try:
                task = connection.execute(
                    "SELECT title FROM tasks WHERE id = 1"
                ).fetchone()
                self.assertEqual(task["title"], "Existing task")
                table_names = {
                    row["name"]
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    ).fetchall()
                }
                self.assertIn("notes", table_names)
                self.assertIn("task_notes", table_names)
                fk_tables = {
                    row["table"]
                    for row in connection.execute(
                        "PRAGMA foreign_key_list(task_notes)"
                    ).fetchall()
                }
                self.assertEqual(fk_tables, {"tasks", "notes"})
            finally:
                connection.close()


if __name__ == "__main__":
    unittest.main()
