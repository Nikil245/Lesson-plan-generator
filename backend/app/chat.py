"""
Step 5 - Chat with Server-Sent Events (SSE) streaming and session history.

Each POST /chat request streams events in this order:
    status ("Searching sources")
    status ("Reading N passages")
    status ("Drafting plan")
    sources ({items: [{id, n, title, url, page, excerpt}]})
    token   ({text: "..."})        <- streamed assistant chat reply
    plan    ({data: LessonPlan})   <- omitted for general questions
    done    ({})

On error, sends an `error {message}` event followed by `done {}`.
"""

import json
import re
from collections.abc import Iterator

from groq import Groq

from app.config import settings
from app.generate import (
    TEMPERATURE,
    format_context,
    generate_from_chunks,
    get_context_chunks,
)
from app.schemas import ChatRequest, LessonPlan, LessonRequest

MAX_TURNS = 10          # keep the last ~10 user+assistant turns per session
EXCERPT_CHARS = 240     # preview length for each source item in the `sources` event


# ---------------------------------------------------------------------------
# 1. In-memory session store
# ---------------------------------------------------------------------------
# Maps session_id -> {"history": [...], "plan": LessonPlan | None, "chunks": [...], "source_ids": ...}
SESSIONS: dict[str, dict] = {}


def get_session(session_id: str) -> dict:
    """Return the session bucket for `session_id`, creating it if needed."""
    if session_id not in SESSIONS:
        SESSIONS[session_id] = {
            "history": [],      # list of {"role": "user"|"assistant", "content": str}
            "plan": None,       # latest LessonPlan object (or None)
            "chunks": [],       # latest retrieved chunks (reused for same-topic refinements)
            "source_ids": None,
        }
    return SESSIONS[session_id]


def get_session_state(session_id: str) -> dict:
    """ Serialisable view of a session for GET /sessions/{session_id}."""
    session = get_session(session_id)
    plan: LessonPlan | None = session["plan"]
    return {
        "session_id": session_id,
        "history": session["history"],
        "plan": plan.model_dump() if plan else None,
    }


def append_turn(session: dict, user_msg: str, assistant_msg: str) -> None:
    """Append one user/assistant exchange and keep only the last MAX_TURNS turns."""
    session["history"].append({"role": "user", "content": user_msg})
    session["history"].append({"role": "assistant", "content": assistant_msg})
    session["history"] = session["history"][-(MAX_TURNS * 2):]


# ---------------------------------------------------------------------------
# 2. Intent classification (new plan vs refinement vs general question)
# ---------------------------------------------------------------------------
PLAN_WORDS = {
    "lesson", "plan", "outline", "curriculum", "workshop", "course", "class", "lecture", "teach",
}
REFINE_WORDS = {
    "make", "add", "simplify", "simpler", "easier", "harder", "more", "less", "fewer",
    "change", "update", "modify", "edit", "revise", "rewrite", "adjust", "replace",
    "remove", "drop", "delete", "shorten", "lengthen", "expand", "extend", "split",
    "combine", "merge", "include", "focus", "emphasize", "turn", "convert", "keep",
    "hands-on", "handson", "quiz", "exercise", "exercises", "activity", "activities",
    "demo", "discussion", "discuss", "assessment", "assessments", "objective", "objectives",
    "prerequisite", "prerequisites", "intro", "introduction", "wrap-up", "summary",
    "section", "block", "step", "part", "minute", "minutes",
    "beginner", "intermediate", "advanced", "it",
}
QUESTION_STARTERS = (
    "what ", "what's ", "why ", "how does ", "how do ", "how is ", "how are ",
    "how many ", "how much ", "when ", "where ", "who ", "which ",
    "explain ", "define ", "describe ", "summarize ", "tell me about ",
    "does ", "do ", "is ", "are ", "can you explain",
)
NEW_TOPIC_PHRASES = (
    "new plan", "new lesson", "new topic", "another lesson", "another plan",
    "different topic", "switch to", "switch topic", "instead teach",
    "lesson plan on ", "lesson plan about ", "lesson plan for ",
    "lesson on ", "lesson about ", "plan on ", "plan about ", "teach about ",
)
NEW_TOPIC_IN_REFINE = re.compile(
    r"\b(?:about|on|cover|covering|introduce|introducing)\s+[a-z0-9 -]{3,}",
    re.IGNORECASE,
)


def classify_message(message: str, has_plan: bool) -> tuple[str, bool]:
    """
    Decide how to handle `message`:
      - ("question", True)   -> answer in chat with citations, keep current plan unchanged
      - ("refine", bool)     -> update the existing plan; re-retrieve only if a new topic is mentioned
      - ("new_plan", True)   -> retrieve and generate a fresh lesson plan
    """
    text = message.strip().lower()
    words = set(re.findall(r"[a-z0-9-]+", text))

    is_explicit_new_plan = any(phrase in text for phrase in NEW_TOPIC_PHRASES)

    # Check for a general factual question (not asking to build or edit a plan)
    starts_like_question = text.startswith(QUESTION_STARTERS)
    ends_with_qmark = text.endswith("?") and not any(
        text.startswith(p) for p in ("can you ", "could you ", "would you ", "will you ", "please ")
    )
    if (starts_like_question or ends_with_qmark) and not is_explicit_new_plan:
        if not has_plan and not (words & PLAN_WORDS):
            return "question", True
        if has_plan and not (words & (REFINE_WORDS | PLAN_WORDS)):
            return "question", True
        if starts_like_question and not (words & PLAN_WORDS):
            return "question", True

    if not has_plan:
        return "new_plan", True

    if is_explicit_new_plan:
        return "new_plan", True

    # Session already has a plan: check if this is a follow-up refinement
    if words & (REFINE_WORDS | PLAN_WORDS):
        # Re-run retrieval only if the refinement asks to cover a new topic
        asks_new_topic = bool(NEW_TOPIC_IN_REFINE.search(text))
        return "refine", asks_new_topic

    # A bare topic name (e.g. "ReAct agents") when a plan already exists -> new plan on that topic
    return "new_plan", True


# ---------------------------------------------------------------------------
# 3. Streaming helpers (Groq + SSE)
# ---------------------------------------------------------------------------
QA_SYSTEM_PROMPT = """You are Lessonwright, a helpful assistant for teachers of prompt engineering.

Answer the teacher's question clearly and concisely (2-5 sentences) using ONLY the numbered CONTEXT.
Cite facts inline with [n] (e.g. [1] or [2][3]).
If the answer is not in the CONTEXT, say that it is not covered in the uploaded sources."""

SUMMARY_SYSTEM_PROMPT = """You are Lessonwright, an assistant that helps teachers build prompt engineering lesson plans.

Write a brief, friendly chat reply (1-2 sentences) confirming the lesson plan you just prepared or updated.
Mention the key focus or changes and include 1-2 relevant [n] citations from the plan."""


def sse_event(event: str, data: dict) -> str:
    """Format one Server-Sent Event frame."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def build_source_items(chunks: list[dict]) -> list[dict]:
    """Convert retrieved chunks into the payload for the `sources` SSE event."""
    return [
        {
            "id": c["source_id"],
            "n": i,
            "title": c["title"],
            "url": c["url"],
            "page": c["page"],
            "excerpt": c["text"][:EXCERPT_CHARS],
        }
        for i, c in enumerate(chunks, start=1)
    ]


def stream_groq_reply(messages: list[dict]) -> Iterator[str]:
    """Stream plain-text tokens from Groq for the assistant's chat reply."""
    if not settings.GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not set in backend/.env")
    client = Groq(api_key=settings.GROQ_API_KEY)
    stream = client.chat.completions.create(
        model=settings.GROQ_MODEL,
        messages=messages,
        temperature=TEMPERATURE,
        stream=True,
    )
    for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


def stream_plan_summary(user_message: str, plan: LessonPlan, mode: str) -> Iterator[str]:
    """Stream a short 1-2 sentence chat reply describing the generated or refined plan."""
    outline_summary = ", ".join(f"{item.title} ({item.type})" for item in plan.outline)
    used_cites = ", ".join(f"[{c.n}] {c.title}" for c in plan.citations) or "none"
    action = "updated" if mode == "refine" else "created"
    messages = [
        {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Teacher's message: {user_message}\n"
                f"Action: {action} lesson plan '{plan.title}' ({plan.duration_min} min, {plan.level}).\n"
                f"Outline sections: {outline_summary}\n"
                f"Citations used: {used_cites}\n\n"
                f"Write a short 1-2 sentence reply to the teacher."
            ),
        },
    ]
    emitted = False
    for token in stream_groq_reply(messages):
        emitted = True
        yield token

    # Fallback if the model returned an empty stream
    if not emitted:
        cite_tag = f" [{plan.citations[0].n}]" if plan.citations else ""
        fallback = (
            f"I have {action} the **{plan.title}** lesson plan "
            f"({plan.duration_min} min, {len(plan.outline)} sections){cite_tag}."
        )
        for word in fallback.split(" "):
            yield word + " "


# ---------------------------------------------------------------------------
# 4. Main SSE generator for POST /chat
# ---------------------------------------------------------------------------
def stream_chat(chat_request: ChatRequest) -> Iterator[str]:
    """
    Run the chat pipeline and yield Server-Sent Events in order:
      status -> sources -> token(s) -> [plan] -> done
    """
    try:
        session = get_session(chat_request.session_id)
        current_plan: LessonPlan | None = session["plan"]
        cfg = chat_request.settings

        lesson_req = LessonRequest(
            topic=chat_request.message,
            level=cfg.level,
            duration_min=cfg.duration_min,
            audience=cfg.audience,
            objectives=cfg.objectives,
            source_ids=cfg.source_ids,
        )

        mode, needs_retrieval = classify_message(chat_request.message, has_plan=current_plan is not None)
        if cfg.source_ids != session["source_ids"] or not session["chunks"]:
            needs_retrieval = True

        # 1. Status: Searching sources
        yield sse_event("status", {"step": "Searching sources"})
        if needs_retrieval:
            chunks = get_context_chunks(lesson_req)
        else:
            chunks = session["chunks"]

        if not chunks:
            raise ValueError(
                "No usable source material found for this topic. Ingest documents or change the source filter."
            )

        # 2. Status: Reading N passages -> Drafting plan
        yield sse_event("status", {"step": f"Reading {len(chunks)} passages"})
        yield sse_event("status", {"step": "Drafting plan"})

        # 3. Sources event
        yield sse_event("sources", {"items": build_source_items(chunks)})

        # 4a. General question: stream answer with citations, do not change the plan
        if mode == "question":
            qa_messages = [
                {"role": "system", "content": QA_SYSTEM_PROMPT},
                *session["history"],
                {
                    "role": "user",
                    "content": f"CONTEXT:\n{format_context(chunks)}\n\n---\nQUESTION:\n{chat_request.message}",
                },
            ]
            reply_parts: list[str] = []
            for token in stream_groq_reply(qa_messages):
                reply_parts.append(token)
                yield sse_event("token", {"text": token})

            append_turn(session, chat_request.message, "".join(reply_parts).strip())
            yield sse_event("done", {})
            return

        # 4b. Plan generation or refinement
        plan = generate_from_chunks(
            lesson_req,
            chunks,
            history=session["history"],
            current_plan=current_plan if mode == "refine" else None,
        )

        # Stream the short assistant chat reply
        reply_parts = []
        for token in stream_plan_summary(chat_request.message, plan, mode):
            reply_parts.append(token)
            yield sse_event("token", {"text": token})

        # Save state in session memory
        session["plan"] = plan
        session["chunks"] = chunks
        session["source_ids"] = cfg.source_ids
        append_turn(session, chat_request.message, "".join(reply_parts).strip())

        # 5. Full validated LessonPlan JSON + done
        yield sse_event("plan", {"data": plan.model_dump()})
        yield sse_event("done", {})

    except Exception as err:
        yield sse_event("error", {"message": str(err)})
        yield sse_event("done", {})

