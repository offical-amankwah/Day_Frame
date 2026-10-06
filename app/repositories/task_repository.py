"""SQLite queries for task records. API route and agent code use this module."""

from __future__ import annotations

import os
from datetime import date, datetime, time, timedelta
from typing import Any

from app.database import get_connection


TaskRecord = dict[str, Any]
DEFAULT_WORKDAY_START = os.environ.get("TASKS_WORKDAY_START", "09:00")
DEFAULT_WORKDAY_END = os.environ.get("TASKS_WORKDAY_END", "17:00")
TERMINAL_STATUSES = {"done", "completed", "cancelled", "canceled"}


class TaskSlotConflictError(ValueError):
    """Raised when a proposed schedule overlaps another active task."""

    def __init__(self, conflicting_tasks: list[dict[str, Any]]):
        self.conflicting_tasks = conflicting_tasks
        super().__init__("The requested time overlaps another scheduled task.")


def _row_to_dict(row: Any) -> TaskRecord:
    return dict(row)


def _parse_local_datetime(value: str) -> datetime:
    """Parse a stored ISO datetime as local wall-clock time.

    This app has no timezone/calendar integration; any supplied UTC offset is
    retained as the displayed wall time for local schedule comparisons.
    """
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    parsed = datetime.fromisoformat(normalized)
    return parsed.replace(tzinfo=None) if parsed.tzinfo is not None else parsed


def _parse_clock(value: str, argument_name: str) -> time:
    try:
        return datetime.strptime(value, "%H:%M").time()
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{argument_name} must be a time in HH:MM format") from exc


def _format_local_datetime(value: datetime) -> str:
    timespec = "seconds" if value.second or value.microsecond else "minutes"
    return value.isoformat(timespec=timespec)


def get_all_tasks(status: str | None = None) -> list[TaskRecord]:
    """Return all tasks, optionally restricted to one status."""
    connection = get_connection()
    try:
        if status is None:
            rows = connection.execute(
                "SELECT id, title, category, estimated_minutes, status, "
                "scheduled_start, created_at "
                "FROM tasks ORDER BY id ASC"
            ).fetchall()
        else:
            rows = connection.execute(
                "SELECT id, title, category, estimated_minutes, status, "
                "scheduled_start, created_at "
                "FROM tasks WHERE status = ? ORDER BY id ASC",
                (status,),
            ).fetchall()
        return [_row_to_dict(row) for row in rows]
    finally:
        connection.close()


def create_task(title: str, category: str, estimated_minutes: int) -> TaskRecord:
    """Insert a task into the inbox and return the created record."""
    connection = get_connection()
    try:
        cursor = connection.execute(
            "INSERT INTO tasks (title, category, estimated_minutes) "
            "VALUES (?, ?, ?)",
            (title, category, estimated_minutes),
        )
        connection.commit()
        row = connection.execute(
            "SELECT id, title, category, estimated_minutes, status, "
            "scheduled_start, created_at FROM tasks WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
        if row is None:  # Defensive: the inserted row should always be present.
            raise RuntimeError("Inserted task could not be read back from the database")
        return _row_to_dict(row)
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def update_task(
    task_id: int, status: str, scheduled_start: str | None
) -> TaskRecord | None:
    """Update a task's status and scheduled start; return None if not found."""
    connection = get_connection()
    try:
        cursor = connection.execute(
            "UPDATE tasks SET status = ?, scheduled_start = ? WHERE id = ?",
            (status, scheduled_start, task_id),
        )
        if cursor.rowcount == 0:
            connection.rollback()
            return None

        connection.commit()
        row = connection.execute(
            "SELECT id, title, category, estimated_minutes, status, "
            "scheduled_start, created_at FROM tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
        return _row_to_dict(row) if row is not None else None
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def get_available_time_slots(
    requested_date: str,
    estimated_minutes: int,
    window_start: str = DEFAULT_WORKDAY_START,
    window_end: str = DEFAULT_WORKDAY_END,
) -> dict[str, Any]:
    """Return unbooked contiguous windows long enough for a task.

    The default daily window is 09:00-17:00 local wall time, configurable with
    TASKS_WORKDAY_START and TASKS_WORKDAY_END or per tool call. Completed and
    cancelled tasks do not block availability.
    """
    try:
        day = date.fromisoformat(requested_date)
    except (TypeError, ValueError) as exc:
        raise ValueError("date must be in YYYY-MM-DD format") from exc
    if isinstance(estimated_minutes, bool) or not isinstance(estimated_minutes, int):
        raise ValueError("estimated_minutes must be an integer")
    if estimated_minutes <= 0:
        raise ValueError("estimated_minutes must be greater than zero")

    start_clock = _parse_clock(window_start, "window_start")
    end_clock = _parse_clock(window_end, "window_end")
    if end_clock <= start_clock:
        raise ValueError("window_end must be later than window_start")

    window_begin = datetime.combine(day, start_clock)
    window_finish = datetime.combine(day, end_clock)
    connection = get_connection()
    try:
        rows = connection.execute(
            "SELECT id, title, estimated_minutes, status, scheduled_start "
            "FROM tasks WHERE scheduled_start IS NOT NULL"
        ).fetchall()
    finally:
        connection.close()

    busy_intervals: list[tuple[datetime, datetime]] = []
    for row in rows:
        if str(row["status"]).strip().lower() in TERMINAL_STATUSES:
            continue
        try:
            task_start = _parse_local_datetime(str(row["scheduled_start"]))
        except ValueError:
            # Ignore malformed legacy timestamps rather than failing the whole query.
            continue
        task_end = task_start + timedelta(minutes=int(row["estimated_minutes"]))
        if task_start < window_finish and task_end > window_begin:
            busy_intervals.append(
                (max(task_start, window_begin), min(task_end, window_finish))
            )

    busy_intervals.sort(key=lambda interval: interval[0])
    merged_intervals: list[tuple[datetime, datetime]] = []
    for busy_start, busy_end in busy_intervals:
        if merged_intervals and busy_start <= merged_intervals[-1][1]:
            previous_start, previous_end = merged_intervals[-1]
            merged_intervals[-1] = (previous_start, max(previous_end, busy_end))
        else:
            merged_intervals.append((busy_start, busy_end))

    slots: list[dict[str, Any]] = []
    cursor = window_begin
    for busy_start, busy_end in merged_intervals:
        available_minutes = int((busy_start - cursor).total_seconds() // 60)
        if available_minutes >= estimated_minutes:
            slots.append(
                {
                    "start": _format_local_datetime(cursor),
                    "end": _format_local_datetime(busy_start),
                    "available_minutes": available_minutes,
                }
            )
        cursor = max(cursor, busy_end)

    available_minutes = int((window_finish - cursor).total_seconds() // 60)
    if available_minutes >= estimated_minutes:
        slots.append(
            {
                "start": _format_local_datetime(cursor),
                "end": _format_local_datetime(window_finish),
                "available_minutes": available_minutes,
            }
        )

    return {
        "date": day.isoformat(),
        "window_start": start_clock.strftime("%H:%M"),
        "window_end": end_clock.strftime("%H:%M"),
        "required_minutes": estimated_minutes,
        "available_slots": slots,
    }


def reschedule_task(task_id: int, scheduled_start: str) -> TaskRecord | None:
    """Set a task's start time and status to ``scheduled``.

    The change is rejected if it overlaps another active, scheduled task. A
    missing task returns None. Completed/cancelled tasks are ignored as blockers.
    """
    connection = get_connection()
    try:
        # Lock writers while checking for overlaps to avoid a local race between
        # checking availability and committing the reschedule.
        connection.execute("BEGIN IMMEDIATE")
        task = connection.execute(
            "SELECT id, estimated_minutes FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
        if task is None:
            connection.rollback()
            return None

        try:
            new_start = _parse_local_datetime(scheduled_start)
        except (TypeError, ValueError) as exc:
            raise ValueError("scheduled_start must be a valid ISO 8601 datetime") from exc
        new_end = new_start + timedelta(minutes=int(task["estimated_minutes"]))

        other_rows = connection.execute(
            "SELECT id, title, estimated_minutes, status, scheduled_start "
            "FROM tasks WHERE id != ? AND scheduled_start IS NOT NULL",
            (task_id,),
        ).fetchall()
        conflicts: list[dict[str, Any]] = []
        for other in other_rows:
            if str(other["status"]).strip().lower() in TERMINAL_STATUSES:
                continue
            try:
                other_start = _parse_local_datetime(str(other["scheduled_start"]))
            except ValueError:
                continue
            other_end = other_start + timedelta(minutes=int(other["estimated_minutes"]))
            if new_start < other_end and new_end > other_start:
                conflicts.append(
                    {
                        "id": int(other["id"]),
                        "title": other["title"],
                        "scheduled_start": other["scheduled_start"],
                        "estimated_minutes": int(other["estimated_minutes"]),
                    }
                )

        if conflicts:
            raise TaskSlotConflictError(conflicts)

        connection.execute(
            "UPDATE tasks SET status = 'scheduled', scheduled_start = ? WHERE id = ?",
            (scheduled_start, task_id),
        )
        connection.commit()
        row = connection.execute(
            "SELECT id, title, category, estimated_minutes, status, "
            "scheduled_start, created_at FROM tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
        return _row_to_dict(row) if row is not None else None
    except Exception:
        if connection.in_transaction:
            connection.rollback()
        raise
    finally:
        connection.close()
