"""REST endpoints for Markdown notes and task-note context."""

from fastapi import APIRouter, HTTPException, status

from app.repositories import note_repository
from app.schemas import (
    NoteCreate,
    NoteRead,
    TaskContextView,
    TaskNoteLinkRead,
    TaskRead,
)


router = APIRouter(tags=["notes"])


@router.post(
    "/notes",
    response_model=NoteRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a Markdown note",
)
def create_note(payload: NoteCreate):
    """Create a knowledge note with comma-separated tags."""
    return note_repository.create_note(
        content=payload.content,
        tags=payload.tags,
    )


@router.get("/notes", response_model=list[NoteRead], summary="List notes")
def list_notes():
    """Return all notes, newest first."""
    return note_repository.get_notes()


@router.get("/notes/{note_id}", response_model=NoteRead, summary="Fetch a note")
def fetch_note(note_id: int):
    """Return one note by id."""
    note = note_repository.get_note(note_id)
    if note is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Note {note_id} not found",
        )
    return note


@router.put(
    "/tasks/{task_id}/notes/{note_id}",
    response_model=TaskNoteLinkRead,
    summary="Link a note to a task",
)
def link_note_to_task(task_id: int, note_id: int):
    """Create an idempotent many-to-many link between a task and a note."""
    try:
        return note_repository.link_note_to_task(task_id=task_id, note_id=note_id)
    except note_repository.RelatedEntityNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc


@router.get(
    "/tasks/{task_id}/context",
    response_model=TaskContextView,
    summary="Fetch a task's context view",
)
def fetch_task_context(task_id: int):
    """Return task details and all notes linked to it."""
    context = note_repository.get_task_context(task_id)
    if context is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task {task_id} not found",
        )
    return context


@router.get(
    "/notes/{note_id}/tasks",
    response_model=list[TaskRead],
    summary="Fetch tasks linked to a note",
)
def fetch_tasks_for_note(note_id: int):
    """Return the tasks that link to this note (the reverse relationship)."""
    tasks = note_repository.get_tasks_for_note(note_id)
    if tasks is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Note {note_id} not found",
        )
    return tasks
