"""
FastAPI entry point for the Lessonwright backend.

Run with:  uvicorn app.main:app --reload
"""

import groq
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.chat import get_session_state, stream_chat
from app.config import settings
from app.generate import generate_lesson_plan
from app.ingest import get_source, list_sources, save_upload_and_ingest
from app.retrieve import retrieve
from app.schemas import ChatRequest, LessonPlan, LessonRequest


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


