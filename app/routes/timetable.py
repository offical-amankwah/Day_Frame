"""Image-based timetable extraction endpoint."""

from __future__ import annotations

import base64
import logging
import os

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from app.repositories import task_repository
from app.schemas import TaskRead
from app.services.timetable_extractor import (
    TimetableExtractionError,
    extract_timetable_events,
)


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["timetable"])
MAX_TIMETABLE_IMAGE_BYTES = int(
    os.environ.get("MAX_TIMETABLE_IMAGE_BYTES", str(20 * 1024 * 1024))
)


@router.post(
    "/extract-timetable",
    response_model=list[TaskRead],
    status_code=status.HTTP_201_CREATED,
    summary="Extract scheduled tasks from a timetable image",
)
async def extract_timetable(file: UploadFile = File(...)) -> list[TaskRead]:
    """Read an uploaded image, extract its events with Ollama, and save them."""
    try:
        if not file.content_type or not file.content_type.lower().startswith("image/"):
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="Upload a timetable image using an image/* content type.",
            )
        image_bytes = await file.read(MAX_TIMETABLE_IMAGE_BYTES + 1)
    finally:
        await file.close()

    if not image_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The uploaded image is empty.",
        )
    if len(image_bytes) > MAX_TIMETABLE_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"The image exceeds the {MAX_TIMETABLE_IMAGE_BYTES}-byte upload limit.",
        )

    image_base64 = base64.b64encode(image_bytes).decode("ascii")
    try:
        events = await extract_timetable_events(image_base64)
    except TimetableExtractionError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc

    try:
        tasks = task_repository.create_scheduled_tasks(events, category="Timetable")
    except Exception as exc:
        logger.exception("Could not save extracted timetable tasks")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="The timetable was extracted, but its tasks could not be saved.",
        ) from exc
    return tasks
