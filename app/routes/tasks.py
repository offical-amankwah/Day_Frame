"""REST endpoints for task management."""

from fastapi import APIRouter, HTTPException, Query, Response, status as http_status

from app.repositories import task_repository
from app.schemas import TaskCreate, TaskPatch, TaskRead, TaskUpdate


router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskRead], summary="List tasks")
def list_tasks(status: str | None = Query(default=None, min_length=1)):
    """Return all tasks, optionally filtered by their status."""
    return task_repository.get_all_tasks(status=status)


@router.post(
    "",
    response_model=TaskRead,
    status_code=http_status.HTTP_201_CREATED,
    summary="Create a task in the inbox",
)
def create_task(payload: TaskCreate):
    """Create a task; status is set to inbox by the database default."""
    return task_repository.create_task(
        title=payload.title,
        category=payload.category,
        estimated_minutes=payload.estimated_minutes,
    )


@router.put(
    "/{task_id}",
    response_model=TaskRead,
    summary="Update a task's status and schedule",
)
def update_task(task_id: int, payload: TaskUpdate):
    """Replace a task's status and scheduled start time."""
    scheduled_start = (
        payload.scheduled_start.isoformat()
        if payload.scheduled_start is not None
        else None
    )
    task = task_repository.update_task(
        task_id=task_id,
        status=payload.status,
        scheduled_start=scheduled_start,
    )
    if task is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=f"Task {task_id} not found",
        )
    return task


@router.patch(
    "/{task_id}",
    response_model=TaskRead,
    summary="Edit task details",
)
def edit_task(task_id: int, payload: TaskPatch):
    """Partially update a task's title, category, or estimate."""
    task = task_repository.edit_task(
        task_id=task_id,
        updates=payload.model_dump(exclude_unset=True),
    )
    if task is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=f"Task {task_id} not found",
        )
    return task


@router.delete(
    "/{task_id}",
    status_code=http_status.HTTP_204_NO_CONTENT,
    summary="Delete a task",
)
def delete_task(task_id: int):
    """Permanently delete a task by id."""
    deleted = task_repository.delete_task(task_id)
    if not deleted:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=f"Task {task_id} not found",
        )
    return Response(status_code=http_status.HTTP_204_NO_CONTENT)
