"""Pydantic request and response models for tasks."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class TaskCreate(BaseModel):
    """Fields accepted when adding a new task to the inbox."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1)
    category: str = Field(min_length=1)
    estimated_minutes: int = Field(gt=0)

    @field_validator("title", "category")
    @classmethod
    def strip_and_require_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class TaskUpdate(BaseModel):
    """Fields accepted when changing a task's status and schedule.

    Both fields are required for PUT. Send scheduled_start as null to clear it.
    """

    model_config = ConfigDict(extra="forbid")

    status: str = Field(min_length=1)
    scheduled_start: datetime | None = Field(
        ...,
        description="ISO 8601 datetime, or null to unschedule the task.",
    )

    @field_validator("status")
    @classmethod
    def strip_and_require_status(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("status must not be blank")
        return value


class TaskPatch(BaseModel):
    """Editable task details for PATCH /tasks/{task_id}."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    category: str | None = None
    estimated_minutes: int | None = Field(default=None, gt=0)

    @field_validator("title", "category", mode="before")
    @classmethod
    def require_nonblank_optional_text(cls, value: Any) -> Any:
        if value is None:
            raise ValueError("must not be null")
        if not isinstance(value, str):
            raise ValueError("must be text")
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value

    @field_validator("estimated_minutes", mode="before")
    @classmethod
    def require_nonnull_minutes(cls, value: Any) -> Any:
        if value is None:
            raise ValueError("estimated_minutes must not be null")
        return value

    @model_validator(mode="after")
    def require_at_least_one_field(self):
        if not self.model_fields_set:
            raise ValueError("provide at least one task field to update")
        return self


class TaskRead(BaseModel):
    """Task representation returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    category: str
    estimated_minutes: int
    status: str
    scheduled_start: datetime | None
    created_at: datetime


class NoteCreate(BaseModel):
    """Fields accepted when creating a Markdown knowledge note."""

    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1)
    tags: str = ""

    @field_validator("content")
    @classmethod
    def require_note_content(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("content must not be blank")
        # Preserve Markdown whitespace (including indentation and line breaks).
        return value

    @field_validator("tags")
    @classmethod
    def normalize_comma_separated_tags(cls, value: str) -> str:
        return ", ".join(tag.strip() for tag in value.split(",") if tag.strip())


class NoteRead(BaseModel):
    """A stored Markdown knowledge note."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    content: str
    tags: str
    created_at: datetime


class TaskNoteLinkRead(BaseModel):
    """The task-note association created by the link endpoint."""

    task_id: int
    note_id: int


class TaskContextView(BaseModel):
    """Task details together with every note linked to that task."""

    task: TaskRead
    notes: list[NoteRead]


class AgentRequest(BaseModel):
    """Natural-language prompt sent to the local task agent."""

    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(min_length=1)

    @field_validator("prompt")
    @classmethod
    def strip_and_require_prompt(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("prompt must not be blank")
        return value


class AgentToolExecution(BaseModel):
    """One tool call made by the model and its database result."""

    name: str
    arguments: dict[str, Any]
    result: Any


class AgentResponse(BaseModel):
    """Final assistant reply and the tools executed to produce it."""

    response: str
    tool_calls: list[AgentToolExecution] = Field(default_factory=list)
