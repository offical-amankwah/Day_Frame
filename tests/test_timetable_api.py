"""Integration tests for image-based timetable extraction."""

from __future__ import annotations

import base64
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.services.timetable_extractor import TimetableExtractionError


class TimetableAPITests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "timetable-test.db"
        self.db_path_patch = patch("app.database.DB_PATH", self.db_path)
        self.db_path_patch.start()
        self.client = TestClient(app)
        self.client.__enter__()

    def tearDown(self) -> None:
        self.client.__exit__(None, None, None)
        self.db_path_patch.stop()
        self.temp_dir.cleanup()

    def test_image_events_are_saved_as_scheduled_tasks(self) -> None:
        image_bytes = b"fake-image-bytes"
        events = [
            {
                "title": "Project planning",
                "estimated_minutes": 45,
                "scheduled_start": "2026-10-14T09:30:00",
            },
            {
                "title": "Team check-in",
                "estimated_minutes": 30,
                "scheduled_start": "2026-10-14T11:00:00+00:00",
            },
        ]
        with patch(
            "app.routes.timetable.extract_timetable_events",
            new_callable=AsyncMock,
            return_value=events,
        ) as extract_events:
            response = self.client.post(
                "/api/extract-timetable",
                files={"file": ("week.png", image_bytes, "image/png")},
            )

        self.assertEqual(response.status_code, 201, response.text)
        tasks = response.json()
        self.assertEqual(len(tasks), 2)
        self.assertEqual([task["title"] for task in tasks], [event["title"] for event in events])
        self.assertTrue(all(task["category"] == "Timetable" for task in tasks))
        self.assertTrue(all(task["status"] == "scheduled" for task in tasks))
        self.assertEqual(
            [datetime.fromisoformat(task["scheduled_start"]) for task in tasks],
            [datetime.fromisoformat(event["scheduled_start"]) for event in events],
        )
        extract_events.assert_awaited_once_with(
            base64.b64encode(image_bytes).decode("ascii")
        )

        listed = self.client.get("/tasks?status=scheduled")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.json()), 2)
        openapi_paths = self.client.get("/openapi.json").json()["paths"]
        self.assertIn("/api/extract-timetable", openapi_paths)

    def test_rejects_non_image_upload(self) -> None:
        with patch(
            "app.routes.timetable.extract_timetable_events", new_callable=AsyncMock
        ) as extract_events:
            response = self.client.post(
                "/api/extract-timetable",
                files={"file": ("notes.txt", b"not an image", "text/plain")},
            )
        self.assertEqual(response.status_code, 415)
        extract_events.assert_not_awaited()

    def test_extraction_failure_returns_bad_gateway_without_tasks(self) -> None:
        with patch(
            "app.routes.timetable.extract_timetable_events",
            new_callable=AsyncMock,
            side_effect=TimetableExtractionError("Ollama is unavailable."),
        ):
            response = self.client.post(
                "/api/extract-timetable",
                files={"file": ("week.jpg", b"image", "image/jpeg")},
            )
        self.assertEqual(response.status_code, 502)
        self.assertIn("Ollama is unavailable", response.json()["detail"])
        self.assertEqual(self.client.get("/tasks").json(), [])

    def test_upload_size_limit_is_enforced(self) -> None:
        with patch("app.routes.timetable.MAX_TIMETABLE_IMAGE_BYTES", 4):
            response = self.client.post(
                "/api/extract-timetable",
                files={"file": ("week.png", b"12345", "image/png")},
            )
        self.assertEqual(response.status_code, 413)


if __name__ == "__main__":
    unittest.main()
