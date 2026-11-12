"""
Pydantic schemas (data shapes) shared by the API and the generator.

Pydantic checks that data has the right fields and types. We use it for two
things:
  1. validating incoming API requests (LessonRequest), and
  2. validating the JSON the LLM returns (LessonPlan), so a malformed answer
     is caught instead of being sent to the frontend.
"""

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class LessonRequest(BaseModel):
    """What the teacher asks for."""

    topic: str = Field(..., min_length=2, examples=["few-shot prompting"])
    level: str = Field("beginner", examples=["beginner", "intermediate", "advanced"])
    duration_min: int = Field(60, ge=10, le=240, description="lesson length in minutes")
    audience: str = Field("university students", examples=["undergraduate CS students"])
    objectives: list[str] = Field(default_factory=list, description="optional teacher goals")
    source_ids: list[str] | None = Field(None, description="optional: only use these sources")


class OutlineItem(BaseModel):
    """One timed block of the lesson, e.g. minutes 10-25: hands-on exercise."""

    start_min: int = Field(..., ge=0)
    end_min: int = Field(..., ge=0)
    title: str
    type: Literal["demo", "discuss", "hands-on"]
    description: str
    example_prompt: str | None = None

    @field_validator("type", mode="before")
    @classmethod
    def normalise_type(cls, value):
        """Accept small variations from the LLM: 'Hands on', 'hands_on' -> 'hands-on'."""
        if isinstance(value, str):
            return value.strip().lower().replace(" ", "-").replace("_", "-")
        return value


class Citation(BaseModel):
    """A numbered reference [n] pointing to a retrieved chunk."""

    n: int
    source_id: str
    title: str
    page: int
    url: str = ""


class LessonPlan(BaseModel):
    """The complete lesson plan returned to the frontend."""

    title: str
    # level / audience / duration_min are overwritten with the request values
    # after generation, so defaults here just stop a missing field from failing.
    level: str = ""
    audience: str = ""
    duration_min: int = 0
    objectives: list[str]
    prerequisites: list[str] = Field(default_factory=list)
    outline: list[OutlineItem] = Field(..., min_length=1)
    assessment: list[str] = Field(default_factory=list)
    further_reading: list[str] = Field(default_factory=list)
    # Filled in by our code from the retrieved chunks (not written by the LLM)
    citations: list[Citation] = Field(default_factory=list)


class ChatSettings(BaseModel):
    """Lesson settings sent along with a chat message."""

    level: str = Field("beginner", examples=["beginner", "intermediate", "advanced"])
    duration_min: int = Field(60, ge=10, le=240, description="lesson length in minutes")
    audience: str = Field("university students", examples=["undergraduate CS students"])
    objectives: list[str] = Field(default_factory=list, description="optional teacher goals")
    source_ids: list[str] | None = Field(None, description="optional: only use these sources")


class ChatRequest(BaseModel):
    """Body of POST /chat."""

    session_id: str = Field("default", min_length=1)
    message: str = Field(..., min_length=1, examples=["few-shot prompting"])
    settings: ChatSettings = Field(default_factory=ChatSettings)


