"""Local Ollama chat integration with a safe SQLite tool dispatcher."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime
from typing import Any

import httpx

from app.repositories import task_repository
from app.repositories.task_repository import TaskSlotConflictError


logger = logging.getLogger(__name__)
OLLAMA_CHAT_URL = os.environ.get(
    "OLLAMA_URL", "http://localhost:11434/api/chat"
)
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.1")
OLLAMA_TIMEOUT_SECONDS = float(os.environ.get("OLLAMA_TIMEOUT_SECONDS", "120"))
MAX_TOOL_ROUNDS = max(1, int(os.environ.get("AGENT_MAX_TOOL_ROUNDS", "8")))


# Ollama's native /api/chat tool schema format. Keep this list limited to the
# four allowlisted operations below; model output is never executed as code.
OLLAMA_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_available_time_slots",
            "description": (
                "Find contiguous free windows on a date that can fit a task. "
                "Checks scheduled tasks in the SQLite database. The default "
                "work window is 09:00-17:00 local time."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {
                        "type": "string",
                        "description": "The requested local date, YYYY-MM-DD.",
                    },
                    "estimated_minutes": {
                        "type": "integer",
                        "minimum": 1,
                        "description": "How many minutes the task needs.",
                    },
                    "window_start": {
                        "type": "string",
                        "description": "Optional earliest time, HH:MM; defaults to 09:00.",
                        "default": task_repository.DEFAULT_WORKDAY_START,
                    },
                    "window_end": {
                        "type": "string",
                        "description": "Optional latest time, HH:MM; defaults to 17:00.",
                        "default": task_repository.DEFAULT_WORKDAY_END,
                    },
                },
                "required": ["date", "estimated_minutes"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_task",
            "description": (
                "Create a new task in the inbox. It does not schedule the task; "
                "use get_available_time_slots and reschedule_task separately "
                "if the user also requested a time."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "minLength": 1},
                    "category": {"type": "string", "minLength": 1},
                    "estimated_minutes": {"type": "integer", "minimum": 1},
                },
                "required": ["title", "category", "estimated_minutes"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_tasks_by_status",
            "description": "Fetch tasks whose status exactly matches the given value.",
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "minLength": 1,
                        "description": "Status to filter by, such as inbox or scheduled.",
                    }
                },
                "required": ["status"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "reschedule_task",
            "description": (
                "Move an existing task to a new local ISO 8601 start datetime. "
                "This sets its status to scheduled and rejects overlaps with "
                "other active scheduled tasks. Check availability first."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {"type": "integer", "minimum": 1},
                    "scheduled_start": {
                        "type": "string",
                        "description": (
                            "New local start datetime, for example "
                            "2026-10-03T10:30:00."
                        ),
                    },
                },
                "required": ["task_id", "scheduled_start"],
                "additionalProperties": False,
            },
        },
    },
]


class AgentServiceError(RuntimeError):
    """Raised when Ollama cannot complete an agent turn."""


def _system_message() -> str:
    now = datetime.now().astimezone()
    return (
        "You are a task-management assistant. Use the provided tools to read "
        "or change task data; never claim a database action succeeded unless "
        "its tool result confirms it.\n"
        f"Current local date and time: {now.isoformat(timespec='minutes')}.\n"
        "Schedule timestamps are local wall-clock times. The default working "
        f"window is {task_repository.DEFAULT_WORKDAY_START}-"
        f"{task_repository.DEFAULT_WORKDAY_END}.\n"
        "Before scheduling or rescheduling, check availability for the date "
        "and task duration. If the user gave an exact time, schedule only if "
        "that interval fits a returned window; otherwise explain the conflict "
        "and offer alternatives rather than changing the time without consent. "
        "If the user asked for any free time, choose a start that fits one of "
        "the returned windows. If the user requests creating and scheduling a new task, "
        "check availability first; if a slot is available, create the task in "
        "the inbox and then reschedule it using the returned task id. If no "
        "slot is available, do not claim it was scheduled. Use the result of "
        "fetch_tasks_by_status for task-list questions. Explain tool errors "
        "plainly and do not invent task ids, task details, or completed actions."
    )


def _check_arguments(
    arguments: dict[str, Any], required: set[str], optional: set[str] | None = None
) -> None:
    optional = optional or set()
    missing = required - arguments.keys()
    extra = arguments.keys() - required - optional
    if missing:
        raise ValueError(f"Missing required argument(s): {', '.join(sorted(missing))}")
    if extra:
        raise ValueError(f"Unexpected argument(s): {', '.join(sorted(extra))}")


def _string_argument(arguments: dict[str, Any], name: str) -> str:
    value = arguments.get(name)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")
    return value.strip()


def _positive_integer_argument(arguments: dict[str, Any], name: str) -> int:
    value = arguments.get(name)
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{name} must be a positive integer")
    return value


def _parse_tool_datetime(value: str) -> str:
    normalized = value.strip()
    if "T" not in normalized and " " not in normalized:
        raise ValueError("scheduled_start must include both a date and a time")
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(normalized).isoformat()
    except ValueError as exc:
        raise ValueError("scheduled_start must be a valid ISO 8601 datetime") from exc


def _dispatch_tool(name: str, arguments: dict[str, Any]) -> Any:
    if name == "get_available_time_slots":
        _check_arguments(
            arguments,
            {"date", "estimated_minutes"},
            {"window_start", "window_end"},
        )
        window_start = arguments.get(
            "window_start", task_repository.DEFAULT_WORKDAY_START
        )
        window_end = arguments.get("window_end", task_repository.DEFAULT_WORKDAY_END)
        if window_start is None:
            window_start = task_repository.DEFAULT_WORKDAY_START
        if window_end is None:
            window_end = task_repository.DEFAULT_WORKDAY_END
        if not isinstance(window_start, str) or not isinstance(window_end, str):
            raise ValueError("window_start and window_end must be HH:MM strings")
        return task_repository.get_available_time_slots(
            requested_date=_string_argument(arguments, "date"),
            estimated_minutes=_positive_integer_argument(arguments, "estimated_minutes"),
            window_start=window_start,
            window_end=window_end,
        )

    if name == "create_task":
        _check_arguments(arguments, {"title", "category", "estimated_minutes"})
        task = task_repository.create_task(
            title=_string_argument(arguments, "title"),
            category=_string_argument(arguments, "category"),
            estimated_minutes=_positive_integer_argument(arguments, "estimated_minutes"),
        )
        return {"task": task}

    if name == "fetch_tasks_by_status":
        _check_arguments(arguments, {"status"})
        task_status = _string_argument(arguments, "status")
        tasks = task_repository.get_all_tasks(status=task_status)
        return {"status": task_status, "count": len(tasks), "tasks": tasks}

    if name == "reschedule_task":
        _check_arguments(arguments, {"task_id", "scheduled_start"})
        task_id = _positive_integer_argument(arguments, "task_id")
        scheduled_start = _parse_tool_datetime(
            _string_argument(arguments, "scheduled_start")
        )
        task = task_repository.reschedule_task(task_id, scheduled_start)
        if task is None:
            return {"error": f"Task {task_id} was not found."}
        return {"task": task}

    raise ValueError(f"Unknown tool: {name}")


def _read_tool_call(raw_call: Any) -> tuple[str, dict[str, Any]]:
    if not isinstance(raw_call, dict):
        raise ValueError("Ollama returned a malformed tool call")
    function = raw_call.get("function")
    if not isinstance(function, dict):
        raise ValueError("Ollama tool call is missing its function object")
    name = function.get("name")
    if not isinstance(name, str) or not name:
        raise ValueError("Ollama tool call is missing a function name")

    arguments = function.get("arguments", {})
    if isinstance(arguments, str):
        try:
            arguments = json.loads(arguments)
        except json.JSONDecodeError as exc:
            raise ValueError("Tool arguments were not valid JSON") from exc
    if not isinstance(arguments, dict):
        raise ValueError("Tool arguments must be a JSON object")
    return name, arguments


def execute_tool_call(raw_call: Any) -> dict[str, Any]:
    """Parse and execute one allowlisted Ollama tool call."""
    fallback_name = "unknown"
    if isinstance(raw_call, dict):
        raw_function = raw_call.get("function")
        if isinstance(raw_function, dict) and isinstance(raw_function.get("name"), str):
            fallback_name = raw_function["name"]

    name = fallback_name
    arguments: dict[str, Any] = {}
    try:
        name, arguments = _read_tool_call(raw_call)
        result = _dispatch_tool(name, arguments)
    except TaskSlotConflictError as exc:
        result = {
            "error": str(exc),
            "conflicting_tasks": exc.conflicting_tasks,
        }
    except (TypeError, ValueError, KeyError) as exc:
        result = {"error": str(exc)}
    except Exception:
        logger.exception("Unexpected error while executing agent tool %s", name)
        result = {"error": "The database operation failed unexpectedly."}

    return {"name": name, "arguments": arguments, "result": result}


async def run_agent(prompt: str) -> dict[str, Any]:
    """Send a prompt to Ollama and run tool calls until it returns a final reply."""
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": _system_message()},
        {"role": "user", "content": prompt},
    ]
    executed_tools: list[dict[str, Any]] = []
    timeout = httpx.Timeout(OLLAMA_TIMEOUT_SECONDS)

    async with httpx.AsyncClient(timeout=timeout) as client:
        for _ in range(MAX_TOOL_ROUNDS):
            try:
                response = await client.post(
                    OLLAMA_CHAT_URL,
                    json={
                        "model": OLLAMA_MODEL,
                        "messages": messages,
                        "tools": OLLAMA_TOOLS,
                        "stream": False,
                    },
                )
                response.raise_for_status()
            except httpx.TimeoutException as exc:
                raise AgentServiceError(
                    f"Ollama did not respond within {OLLAMA_TIMEOUT_SECONDS:g} seconds."
                ) from exc
            except httpx.HTTPStatusError as exc:
                detail = exc.response.text[:500]
                raise AgentServiceError(
                    f"Ollama returned HTTP {exc.response.status_code}: {detail}"
                ) from exc
            except httpx.HTTPError as exc:
                raise AgentServiceError(
                    f"Could not connect to Ollama at {OLLAMA_CHAT_URL}. "
                    "Check that Ollama is running and the model is available."
                ) from exc

            try:
                payload = response.json()
            except ValueError as exc:
                raise AgentServiceError("Ollama returned invalid JSON.") from exc

            message = payload.get("message") if isinstance(payload, dict) else None
            if not isinstance(message, dict):
                raise AgentServiceError("Ollama response did not contain a chat message.")

            tool_calls = message.get("tool_calls") or []
            if not isinstance(tool_calls, list):
                raise AgentServiceError("Ollama returned an invalid tool_calls value.")
            if not tool_calls:
                content = message.get("content", "")
                return {
                    "response": content if isinstance(content, str) else "",
                    "tool_calls": executed_tools,
                }

            assistant_content = message.get("content", "")
            messages.append(
                {
                    "role": "assistant",
                    "content": assistant_content if isinstance(assistant_content, str) else "",
                    "tool_calls": tool_calls,
                }
            )
            for raw_call in tool_calls:
                execution = await asyncio.to_thread(execute_tool_call, raw_call)
                executed_tools.append(execution)
                messages.append(
                    {
                        "role": "tool",
                        "tool_name": execution["name"],
                        "content": json.dumps(
                            execution["result"], ensure_ascii=False, default=str
                        ),
                    }
                )

    raise AgentServiceError(
        f"Ollama exceeded the maximum of {MAX_TOOL_ROUNDS} tool-call rounds."
    )
