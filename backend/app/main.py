"""
FastAPI entry point for the Lessonwright backend.

Run with:  uvicorn app.main:app --reload
"""

import groq
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app import db
from app.chat import get_session_state, stream_chat
from app.config import settings
from app.courses import create_course_with_syllabus, generate_course_lesson
from app.generate import generate_lesson_plan
from app.ingest import get_source, list_sources, save_upload_and_ingest
from app.retrieve import retrieve
from app.schemas import (
    ChatRequest,
    CourseCreate,
    CourseLessonCreate,
    LessonPlan,
    LessonRequest,
    LessonStatusUpdate,
    TopicCreate,
    TopicUpdate,
)


app = FastAPI(
    title="Lessonwright API",
    description="RAG-based lesson plan generator for prompt engineering teachers.",
    version="0.1.0",
)

# --- CORS ---------------------------------------------------------------
# The React/Vite frontend runs on a different port (5173), so the browser
# needs explicit permission to call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_ORIGIN, "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Routes -------------------------------------------------------------
@app.get("/health")
def health() -> dict:
    """Liveness check. Also reports whether the Groq key is configured."""
    return {
        "status": "ok",
        "groq_configured": bool(settings.GROQ_API_KEY),
        "model": settings.GROQ_MODEL,
    }


# Note: these endpoints are plain `def` (not `async def`). FastAPI then runs
# them in a worker thread, so slow work like embedding a big PDF does not
# block the server from answering other requests.

@app.post("/ingest")
def ingest(
    file: UploadFile = File(..., description="A .pdf, .md or .txt file"),
    title: str | None = Form(None),
    url: str | None = Form(None),
    topic: str | None = Form(None),
) -> dict:
    """Upload one document; it is saved to data/sources and indexed in Chroma."""
    try:
        return save_upload_and_ingest(file.filename, file.file.read(), title, url, topic)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))


@app.get("/sources")
def sources() -> list[dict]:
    """List every ingested document with its number of chunks."""
    return list_sources()


@app.get("/sources/{source_id}")
def source_detail(source_id: str) -> dict:
    """Return one document's info and all of its chunks (for the citation popover)."""
    doc = get_source(source_id)
    if doc is None:
        raise HTTPException(status_code=404, detail=f"Source '{source_id}' not found.")
    return doc


@app.get("/search")
def search(
    q: str = Query(..., min_length=1, description="search text"),
    k: int = Query(6, ge=1, le=20, description="number of chunks"),
    source_ids: str | None = Query(None, description="comma-separated source ids, e.g. a,b"),
) -> dict:
    """Debug/testing endpoint: semantic search over the ingested chunks."""
    ids = [s.strip() for s in source_ids.split(",") if s.strip()] if source_ids else None
    return {"query": q, "k": k, "source_ids": ids, "results": retrieve(q, k, ids)}


@app.post("/lesson-plan", response_model=LessonPlan)
def lesson_plan(request: LessonRequest) -> LessonPlan:
    """Generate a complete lesson plan (JSON) grounded in the ingested sources."""
    try:
        return generate_lesson_plan(request)
    except ValueError as err:          # e.g. no usable sources for this topic
        raise HTTPException(status_code=422, detail=str(err))
    except groq.APIError as err:       # Groq unreachable, bad key, rate limit...
        raise HTTPException(status_code=502, detail=f"LLM error: {err}")
    except RuntimeError as err:        # missing key or invalid output after retry
        raise HTTPException(status_code=500, detail=str(err))


@app.post("/chat")
def chat(request: ChatRequest) -> StreamingResponse:
    """Stream a chat turn (status, sources, tokens, plan, done) as Server-Sent Events."""
    return StreamingResponse(
        stream_chat(request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/sessions/{session_id}")
def session_detail(session_id: str) -> dict:
    """Return the conversation history and latest lesson plan for a session."""
    return get_session_state(session_id)


# --- Course & progress tracking routes ----------------------------------
@app.post("/courses")
def create_course(request: CourseCreate) -> dict:
    """Create a course and automatically build its ordered syllabus from source_ids."""
    try:
        return create_course_with_syllabus(request)
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err))
    except groq.APIError as err:
        raise HTTPException(status_code=502, detail=f"LLM error: {err}")
    except RuntimeError as err:
        raise HTTPException(status_code=500, detail=str(err))


@app.get("/courses")
def courses() -> list[dict]:
    """List all courses along with their progress summaries."""
    return db.list_courses()


@app.get("/courses/{course_id}")
def course_detail(course_id: str) -> dict:
    """Return one course with its topics, generated lessons, and progress."""
    course = db.get_course(course_id)
    if course is None:
        raise HTTPException(status_code=404, detail=f"Course '{course_id}' not found.")
    return course


@app.get("/courses/{course_id}/progress")
def course_progress(course_id: str) -> dict:
    """Return topic/page coverage metrics and upcoming not_started topics."""
    progress = db.get_course_progress(course_id)
    if progress is None:
        raise HTTPException(status_code=404, detail=f"Course '{course_id}' not found.")
    return progress


@app.post("/courses/{course_id}/topics")
def create_topic(course_id: str, request: TopicCreate) -> dict:
    """Add a new topic to the course syllabus."""
    try:
        topic = db.add_topic(
            course_id=course_id,
            title=request.title,
            summary=request.summary,
            page_start=request.page_start,
            page_end=request.page_end,
            est_minutes=request.est_minutes,
            position=request.position,
        )
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err))
    if topic is None:
        raise HTTPException(status_code=404, detail=f"Course '{course_id}' not found.")
    return topic


@app.patch("/courses/{course_id}/topics/{topic_id}")
def patch_topic(course_id: str, topic_id: str, request: TopicUpdate) -> dict:
    """Edit a syllabus topic (title, position, est_minutes, status, etc.)."""
    try:
        topic = db.update_topic(course_id, topic_id, request.model_dump(exclude_unset=True))
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err))
    if topic is None:
        raise HTTPException(status_code=404, detail=f"Topic '{topic_id}' not found in course '{course_id}'.")
    return topic


@app.delete("/courses/{course_id}/topics/{topic_id}")
def remove_topic(course_id: str, topic_id: str) -> dict:
    """Remove a topic from the course syllabus and renumber remaining positions."""
    deleted = db.delete_topic(course_id, topic_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Topic '{topic_id}' not found in course '{course_id}'.")
    return {"deleted": True, "topic_id": topic_id}


@app.post("/courses/{course_id}/lessons")
def create_course_lesson(course_id: str, request: CourseLessonCreate) -> dict:
    """Generate the next lesson in sequence, save it, and mark its topics 'planned'."""
    try:
        return generate_course_lesson(course_id, request)
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err).strip("'"))
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err))
    except groq.APIError as err:
        raise HTTPException(status_code=502, detail=f"LLM error: {err}")
    except RuntimeError as err:
        raise HTTPException(status_code=500, detail=str(err))


@app.patch("/courses/{course_id}/lessons/{lesson_id}")
def patch_course_lesson(course_id: str, lesson_id: str, request: LessonStatusUpdate) -> dict:
    """Mark a lesson 'taught' (and its topics 'taught') or revert it back to 'planned'."""
    updated = db.update_lesson_status(course_id, lesson_id, request.status)
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Lesson '{lesson_id}' not found in course '{course_id}'.")
    return updated


@app.delete("/courses/{course_id}/lessons/{lesson_id}")
def remove_course_lesson(course_id: str, lesson_id: str) -> dict:
    """Delete a lesson and revert its topics to 'not_started' if unused elsewhere."""
    result = db.delete_lesson(course_id, lesson_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Lesson '{lesson_id}' not found in course '{course_id}'.")
    return result


