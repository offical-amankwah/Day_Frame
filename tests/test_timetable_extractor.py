"""Unit tests for Ollama vision response parsing and request construction."""

from __future__ import annotations

import asyncio
import json
import unittest
from unittest.mock import patch

import httpx

from app.services.timetable_extractor import (
    TIMETABLE_EXTRACTION_PROMPT,
    TimetableExtractionError,
    _parse_event_array,
    extract_timetable_events,
)


class TimetableExtractorTests(unittest.TestCase):
    def test_parses_and_normalizes_valid_json_array(self) -> None:
        events = _parse_event_array(
            '[{"title":"  Lecture  ","estimated_minutes":60,'
            '"scheduled_start":"2026-10-14T09:00:00Z"}]'
        )
        self.assertEqual(
            events,
            [
                {
                    "title": "Lecture",
                    "estimated_minutes": 60,
                    "scheduled_start": "2026-10-14T09:00:00+00:00",
                }
            ],
        )

    def test_rejects_non_array_and_invalid_event_fields(self) -> None:
        invalid_responses = [
            '{"title":"Lecture"}',
            '[{"title":"  ","estimated_minutes":60,'
            '"scheduled_start":"2026-10-14T09:00:00"}]',
            '[{"title":"Lecture","estimated_minutes":0,'
            '"scheduled_start":"2026-10-14T09:00:00"}]',
            '[{"title":"Lecture","estimated_minutes":30,'
            '"scheduled_start":"Wednesday morning"}]',
        ]
        for content in invalid_responses:
            with self.subTest(content=content):
                with self.assertRaises(TimetableExtractionError):
                    _parse_event_array(content)

    def test_sends_base64_image_and_exact_prompt_to_ollama(self) -> None:
        captured: dict[str, object] = {}

        def handle_request(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["payload"] = json.loads(request.content)
            return httpx.Response(
                200,
                json={
                    "message": {
                        "content": (
                            '[{"title":"Study group","estimated_minutes":90,'
                            '"scheduled_start":"2026-10-15T14:00:00"}]'
                        )
                    }
                },
            )

        client = httpx.AsyncClient(transport=httpx.MockTransport(handle_request))
        with (
            patch(
                "app.services.timetable_extractor.OLLAMA_CHAT_URL",
                "http://ollama.test:11434/api/chat",
            ),
            patch(
                "app.services.timetable_extractor.OLLAMA_VISION_MODEL", "llava-test"
            ),
            patch(
                "app.services.timetable_extractor.httpx.AsyncClient",
                return_value=client,
            ),
        ):
            events = asyncio.run(extract_timetable_events("YWJjMTIz"))

        self.assertEqual(events[0]["title"], "Study group")
        self.assertEqual(captured["url"], "http://ollama.test:11434/api/chat")
        payload = captured["payload"]
        self.assertEqual(payload["model"], "llava-test")
        self.assertEqual(payload["messages"][0]["content"], TIMETABLE_EXTRACTION_PROMPT)
        self.assertEqual(payload["messages"][0]["images"], ["YWJjMTIz"])
        self.assertEqual(payload["format"], "json")
        self.assertFalse(payload["stream"])


if __name__ == "__main__":
    unittest.main()
