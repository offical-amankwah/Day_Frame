"""Pydantic request and response models for tasks."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


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
