"""Extract scheduled events from timetable images with an Ollama vision model."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from typing import Any

import httpx


logger = logging.getLogger(__name__)
OLLAMA_CHAT_URL = os.environ.get(
    "OLLAMA_URL", "http://localhost:11434/api/chat"
)
OLLAMA_VISION_MODEL = os.environ.get("OLLAMA_VISION_MODEL", "llava")
OLLAMA_TIMEOUT_SECONDS = float(os.environ.get("OLLAMA_TIMEOUT_SECONDS", "120"))
TIMETABLE_EXTRACTION_PROMPT = (
    "Extract all scheduled events, classes, or meetings from this timetable image. "
    "Return the result strictly as a JSON array where each object has a 'title', "
    "'estimated_minutes', and 'scheduled_start' (in ISO 8601 format)."
)


class TimetableExtractionError(RuntimeError):
    """Raised when Ollama cannot return valid timetable events."""


def _parse_event_array(content: str) -> list[dict[str, Any]]:
    """Parse and validate the JSON array returned by the vision model."""
    text = content.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if len(lines) >= 3 and lines[-1].strip().startswith("```"):
            text = "\n".join(lines[1:-1]).strip()

    try:
        decoded = json.loads(text)
    except json.JSONDecodeError as exc:
        # Be tolerant of a short preamble/postscript while still requiring a
        # valid JSON array for every event that will be written to SQLite.
        start = text.find("[")
        end = text.rfind("]")
        if start < 0 or end < start:
            raise TimetableExtractionError(
                "The vision model did not return a JSON array."
            ) from exc
        try:
            decoded = json.loads(text[start : end + 1])
        except json.JSONDecodeError as nested_exc:
            raise TimetableExtractionError(
                "The vision model returned malformed timetable JSON."
            ) from nested_exc

    if not isinstance(decoded, list):
        raise TimetableExtractionError("The vision model response must be a JSON array.")

    events: list[dict[str, Any]] = []
    for index, item in enumerate(decoded, start=1):
        if not isinstance(item, dict):
            raise TimetableExtractionError(f"Timetable item {index} must be a JSON object.")

        title = item.get("title")
        if not isinstance(title, str) or not title.strip():
            raise TimetableExtractionError(f"Timetable item {index} has no valid title.")

        minutes = item.get("estimated_minutes")
        if isinstance(minutes, bool) or not isinstance(minutes, int) or minutes <= 0:
            raise TimetableExtractionError(
                f"Timetable item {index} must have a positive integer estimated_minutes."
            )

        scheduled_start = item.get("scheduled_start")
        if not isinstance(scheduled_start, str) or not scheduled_start.strip():
            raise TimetableExtractionError(
                f"Timetable item {index} has no valid scheduled_start."
            )
        normalized_start = scheduled_start.strip()
        if "T" not in normalized_start and " " not in normalized_start:
            raise TimetableExtractionError(
                f"Timetable item {index} scheduled_start must include a date and time."
            )
        if normalized_start.endswith("Z"):
            normalized_start = normalized_start[:-1] + "+00:00"
        try:
            parsed_start = datetime.fromisoformat(normalized_start)
        except ValueError as exc:
            raise TimetableExtractionError(
                f"Timetable item {index} scheduled_start is not valid ISO 8601."
            ) from exc

        events.append(
            {
                "title": title.strip(),
                "estimated_minutes": minutes,
                "scheduled_start": parsed_start.isoformat(),
            }
        )
    return events


async def extract_timetable_events(image_base64: str) -> list[dict[str, Any]]:
    """Send one base64 image to Ollama and return validated timetable events."""
    timeout = httpx.Timeout(OLLAMA_TIMEOUT_SECONDS)
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            response = await client.post(
                OLLAMA_CHAT_URL,
                json={
                    "model": OLLAMA_VISION_MODEL,
                    "messages": [
                        {
                            "role": "user",
                            "content": TIMETABLE_EXTRACTION_PROMPT,
                            "images": [image_base64],
                        }
                    ],
                    "format": "json",
                    "stream": False,
                },
            )
            response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise TimetableExtractionError(
                f"Ollama did not respond within {OLLAMA_TIMEOUT_SECONDS:g} seconds."
            ) from exc
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:500]
            raise TimetableExtractionError(
                f"Ollama returned HTTP {exc.response.status_code}: {detail}"
            ) from exc
        except httpx.HTTPError as exc:
            raise TimetableExtractionError(
                f"Could not connect to Ollama at {OLLAMA_CHAT_URL}. "
                "Check that Ollama is running and the vision model is available."
            ) from exc

    try:
        payload = response.json()
    except ValueError as exc:
        raise TimetableExtractionError("Ollama returned invalid JSON.") from exc

    message = payload.get("message") if isinstance(payload, dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    if not isinstance(content, str):
        raise TimetableExtractionError(
            "Ollama response did not contain a text message with timetable events."
        )

    try:
        return _parse_event_array(content)
    except TimetableExtractionError:
        logger.warning("Vision model returned invalid timetable event data")
        raise
