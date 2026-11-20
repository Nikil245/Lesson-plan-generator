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
    # Topics covered by this lesson and topics not yet covered (used in course lessons)
    covered_topics: list[str] = Field(default_factory=list)
    not_covered_yet: list[str] = Field(default_factory=list)
    # Filled in by our code from the retrieved chunks (not written by the LLM)
    citations: list[Citation] = Field(default_factory=list)


class ChatSettings(BaseModel):
    """Lesson settings sent along with a chat message."""

    level: str = Field("beginner", examples=["beginner", "intermediate", "advanced"])
    duration_min: int = Field(60, ge=10, le=240, description="lesson length in minutes")
    audience: str = Field("university students", examples=["undergraduate CS students"])
    objectives: list[str] = Field(default_factory=list, description="optional teacher goals")
    source_ids: list[str] | None = Field(None, description="optional: only use these sources")
    course_id: str | None = Field(None, description="optional: active course id for progress queries")


class ChatRequest(BaseModel):
    """Body of POST /chat."""

    session_id: str = Field("default", min_length=1)
    message: str = Field(..., min_length=1, examples=["few-shot prompting"])
    course_id: str | None = Field(None, description="optional: active course id for progress queries")
    settings: ChatSettings = Field(default_factory=ChatSettings)


# ---------------------------------------------------------------------------
# Course & progress tracking schemas
# ---------------------------------------------------------------------------
TopicStatus = Literal["not_started", "planned", "taught"]
LessonStatus = Literal["planned", "taught"]


class SyllabusTopic(BaseModel):
    """One teachable topic produced by the syllabus builder (validated via Pydantic)."""

    title: str = Field(..., min_length=2)
    summary: str = Field(..., min_length=5)
    page_start: int = Field(..., ge=1)
    page_end: int = Field(..., ge=1)
    est_minutes: int = Field(..., ge=5, le=40)


class CourseCreate(BaseModel):
    """Body of POST /courses."""

    title: str = Field(..., min_length=2, examples=["Prompt Engineering 101"])
    source_ids: list[str] = Field(..., min_length=1, examples=[["2210-03629v3"]])


class TopicCreate(BaseModel):
    """Body of POST /courses/{id}/topics (teacher adds a topic manually)."""

    title: str = Field(..., min_length=2)
    summary: str = Field("", description="one-sentence description of the topic")
    page_start: int = Field(..., ge=1)
    page_end: int = Field(..., ge=1)
    est_minutes: int = Field(15, ge=5, le=120)
    position: int | None = Field(None, ge=1, description="optional 1-based position in syllabus")


class TopicUpdate(BaseModel):
    """Body of PATCH /courses/{id}/topics/{topic_id} (partial teacher edit)."""

    title: str | None = Field(None, min_length=2)
    summary: str | None = None
    page_start: int | None = Field(None, ge=1)
    page_end: int | None = Field(None, ge=1)
    position: int | None = Field(None, ge=1)
    est_minutes: int | None = Field(None, ge=5, le=120)
    status: TopicStatus | None = None


class CourseLessonCreate(BaseModel):
    """Body of POST /courses/{id}/lessons."""

    duration_min: int = Field(60, ge=10, le=240, description="lesson length in minutes")
    level: str = Field("beginner", examples=["beginner", "intermediate", "advanced"])
    audience: str = Field("university students", examples=["undergraduate CS students"])
    objectives: list[str] = Field(default_factory=list, description="optional teacher goals")
    topic_ids: list[str] | None = Field(
        None,
        description="optional explicit topic ids; if omitted, picks next not_started topics to fill ~85% of duration_min",
    )


class LessonStatusUpdate(BaseModel):
    """Body of PATCH /courses/{id}/lessons/{lesson_id}."""

    status: LessonStatus


