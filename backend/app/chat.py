"""
Step 5 - Chat with Server-Sent Events (SSE) streaming and session history.

Every message is classified into one of three intents:
    answer    -> written answer in chat with [n] citations; the plan is NOT touched
    refine    -> update the existing lesson plan (only when a plan exists)
    new_plan  -> create a fresh lesson plan

Event order per POST /chat request:
    answer:            status("Searching sources") -> status("Reading N passages")
                       -> status("Writing answer") -> sources -> token(s) -> done
    new_plan / refine: status("Searching sources") -> status("Reading N passages")
                       -> status("Drafting plan") -> sources -> token(s) -> plan -> done

The `done` event carries {"intent": "..."} (ignored by the frontend, used by tests).
On error, sends an `error {message}` event with a readable message, then `done`.
"""

import json
import logging
import os
import re
from collections.abc import Iterator

from groq import APIConnectionError, AuthenticationError, Groq, RateLimitError

from app.config import settings
from app.generate import (
    RETRIEVE_K,
    TEMPERATURE,
    format_context,
    generate_from_chunks,
    get_context_chunks,
    is_garbled,
)
from app.retrieve import retrieve
from app.schemas import ChatRequest, LessonPlan, LessonRequest

# uvicorn's logger prints straight into the uvicorn terminal
log = logging.getLogger("uvicorn.error")

MAX_TURNS = 10          # keep the last ~10 user+assistant turns per session
EXCERPT_CHARS = 240     # preview length for each source item in the `sources` event
MIN_PREFERRED_CHUNKS = 3  # top up from all sources if the selected ones give fewer than this

# Optional cheaper model for the classifier; defaults to the main model
CLASSIFIER_MODEL = os.getenv("GROQ_CLASSIFIER_MODEL", "") or settings.GROQ_MODEL

INTENT_ANSWER = "answer"
INTENT_REFINE = "refine"
INTENT_NEW_PLAN = "new_plan"
VALID_INTENTS = {INTENT_ANSWER, INTENT_REFINE, INTENT_NEW_PLAN}


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
            "chunks": [],       # chunks behind the current plan (reused for refinements)
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
# 2. Groq helpers
# ---------------------------------------------------------------------------
def groq_client() -> Groq:
    if not settings.GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not set in backend/.env")
    return Groq(api_key=settings.GROQ_API_KEY)


def is_reasoning_model(model: str) -> bool:
    """gpt-oss / qwen3 style models spend tokens on hidden reasoning before the answer."""
    name = model.lower()
    return "gpt-oss" in name or "qwen3" in name or "deepseek-r1" in name


def reasoning_kwargs(model: str) -> dict:
    """Keep reasoning short and out of `content` for reasoning models."""
    if is_reasoning_model(model):
        return {"reasoning_effort": "low", "include_reasoning": False}
    return {}


def complete_text(messages: list[dict], max_tokens: int, model: str | None = None,
                  json_mode: bool = False, temperature: float = 0.0) -> str:
    """One non-streaming Groq call that returns the message text ('' if empty)."""
    model = model or settings.GROQ_MODEL
    # Reasoning models count hidden reasoning tokens against the limit, so give
    # them headroom; the visible answer is still capped by the prompt.
    limit = max_tokens if not is_reasoning_model(model) else max(max_tokens, 300)
    kwargs = {"response_format": {"type": "json_object"}} if json_mode else {}
    response = groq_client().chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
        max_completion_tokens=limit,
        **reasoning_kwargs(model),
        **kwargs,
    )
    return (response.choices[0].message.content or "").strip()


def stream_groq_reply(messages: list[dict]) -> Iterator[str]:
    """
    Stream plain-text tokens from Groq for the assistant's chat reply.
    If the stream yields no visible text (can happen with reasoning models),
    fall back to one non-streaming call so the user never gets an empty reply.
    """
    model = settings.GROQ_MODEL
    stream = groq_client().chat.completions.create(
        model=model,
        messages=messages,
        temperature=TEMPERATURE,
        stream=True,
        **reasoning_kwargs(model),
    )
    emitted = False
    for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta.content
        if delta:
            emitted = True
            yield delta

    if not emitted:
        log.warning("[chat] streamed reply was empty, retrying without streaming")
        text = complete_text(messages, max_tokens=1200, temperature=TEMPERATURE)
        if not text:
            raise RuntimeError("The model returned an empty answer. Please try again.")
        yield text


def readable_error(err: Exception) -> str:
    """Turn API/library exceptions into a short message for the chat UI."""
    if isinstance(err, AuthenticationError):
        return "The Groq API key was rejected. Update GROQ_API_KEY in backend/.env and restart the server."
    if isinstance(err, RateLimitError):
        return "The Groq rate limit was reached. Wait a moment and try again."
    if isinstance(err, APIConnectionError):
        return "Could not reach the Groq API. Check the server's internet connection."
    text = str(err).strip()
    return text or f"Something went wrong ({type(err).__name__}). Please try again."


def sse_event(event: str, data: dict) -> str:
    """Format one Server-Sent Event frame."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def stream_words(text: str) -> Iterator[str]:
    """Yield a fixed sentence word by word so it still arrives as token events."""
    words = text.split(" ")
    for i, word in enumerate(words):
        yield word if i == len(words) - 1 else word + " "


# ---------------------------------------------------------------------------
# 3. Intent classification (answer vs refine vs new_plan)
# ---------------------------------------------------------------------------
# Fast shortcut: messages that are obviously requests for information.
ANSWER_STARTERS = (
    "what is", "what are", "what's", "why", "how does", "how do", "explain", "define",
    "answer", "can you answer", "could you answer", "please answer", "give me the answer",
)
# Markers that only make sense when the user wants something written in chat.
ANSWER_MARKERS = re.compile(
    r"\b(\d+\s*marks?|model answer|answer (?:this|these|the following)|important questions"
    r"|exam questions|question paper)\b",
    re.IGNORECASE,
)
# Used only when the LLM classifier is unavailable.
NEW_PLAN_PATTERN = re.compile(
    r"\b(plan|create|design|build|prepare|make|draft|write)\b.{0,40}\b(lesson|course|session|class|workshop|lecture|curriculum)\b"
    r"|\blesson plan\b",
    re.IGNORECASE,
)
REFINE_STARTERS = (
    "make it", "make the", "add a", "add an", "add more", "add some", "simplify", "shorten",
    "lengthen", "extend", "change the", "rename", "remove", "drop", "replace", "split",
    "turn it", "convert it", "reduce", "increase",
)

CLASSIFIER_PROMPT = """You route messages in a lesson-planning chat app. Reply with JSON only: {"intent": "answer" | "refine" | "new_plan"}.

- "answer": the user wants information or something written in chat: a definition, explanation, summary, comparison, an answer to an exam/assignment question (e.g. "for 5 marks"), important questions from the sources, a model answer.
- "refine": ONLY if a lesson plan exists AND the message clearly asks to edit that plan (e.g. "make it more hands-on", "add a quiz", "simplify", "shorten to 30 minutes", "add a section on X", "change the title").
- "new_plan": the user asks to plan or create a lesson, course, class or session (e.g. "plan a 60-minute lesson on ...", "create a lesson plan for ...").

If unsure, choose "answer". Never choose "refine" when no plan exists."""


def normalize(message: str) -> str:
    """Lowercase and expand chat shorthand ("can u" -> "can you") for keyword checks."""
    text = message.strip().lower()
    text = re.sub(r"\bu\b", "you", text)
    text = re.sub(r"\bpls\b|\bplz\b", "please", text)
    return re.sub(r"\s+", " ", text)


def keyword_shortcut(message: str) -> str | None:
    """Return 'answer' for obvious information requests, else None (ask the LLM)."""
    text = normalize(message)
    if text.startswith(ANSWER_STARTERS) or ANSWER_MARKERS.search(text):
        return INTENT_ANSWER
    return None


def keyword_fallback(message: str, has_plan: bool) -> str:
    """Conservative classification used if the LLM call fails. Defaults to answer."""
    text = normalize(message)
    if NEW_PLAN_PATTERN.search(text):
        return INTENT_NEW_PLAN
    if has_plan and text.startswith(REFINE_STARTERS):
        return INTENT_REFINE
    return INTENT_ANSWER


def llm_classify(message: str, has_plan: bool, plan_title: str | None) -> str:
    """Small, cheap Groq JSON call that returns one of the three intents."""
    plan_line = f'yes, titled "{plan_title}"' if has_plan else "no"
    raw = complete_text(
        [
            {"role": "system", "content": CLASSIFIER_PROMPT},
            {"role": "user", "content": f"Lesson plan exists: {plan_line}\nMessage: {message}"},
        ],
        max_tokens=50,
        model=CLASSIFIER_MODEL,
        json_mode=True,
        temperature=0.0,
    )
    intent = str(json.loads(raw).get("intent", "")).strip().lower()
    if intent not in VALID_INTENTS:
        raise ValueError(f"unexpected classifier output: {raw!r}")
    return intent


def classify_message(message: str, has_plan: bool, plan_title: str | None = None) -> tuple[str, str]:
    """
    Return (intent, how_decided). Rules:
      1. obvious information requests -> answer (keyword shortcut, no LLM call)
      2. otherwise ask the LLM classifier
      3. ambiguous / failed -> answer, never refine
      4. refine is impossible without a plan
    """
    shortcut = keyword_shortcut(message)
    if shortcut:
        return shortcut, "keyword"

    try:
        intent, how = llm_classify(message, has_plan, plan_title), "llm"
    except Exception as err:  # network, parse or schema problems
        log.warning("[chat] classifier failed (%s); using keyword fallback", readable_error(err))
        intent, how = keyword_fallback(message, has_plan), "fallback"

    if intent == INTENT_REFINE and not has_plan:
        # Without a plan there is nothing to edit: plan only if clearly asked, else answer
        intent = INTENT_NEW_PLAN if NEW_PLAN_PATTERN.search(normalize(message)) else INTENT_ANSWER
        how += "+no-plan"
    return intent, how


# ---------------------------------------------------------------------------
# 4. Retrieval for answers + prompts
# ---------------------------------------------------------------------------
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


def get_answer_chunks(message: str, source_ids: list[str] | None) -> list[dict]:
    """
    Retrieve k=8 chunks for the user's actual message, skipping garbled ones.
    Chunks from the selected sources come first; if those give too little,
    top up with the best chunks from all sources.
    """
    preferred = [c for c in retrieve(message, k=RETRIEVE_K, source_ids=source_ids) if not is_garbled(c["text"])]
    if not source_ids or len(preferred) >= MIN_PREFERRED_CHUNKS:
        return preferred

    seen = {(c["source_id"], c.get("chunk_index"), c["page"]) for c in preferred}
    extra = [
        c for c in retrieve(message, k=RETRIEVE_K)
        if not is_garbled(c["text"]) and (c["source_id"], c.get("chunk_index"), c["page"]) not in seen
    ]
    return (preferred + extra)[:RETRIEVE_K]


ANSWER_SYSTEM_PROMPT = """You are Lessonwright, an assistant for teachers and students.

Answer the user's request using ONLY the numbered CONTEXT.
- Cite every fact inline with [n] (e.g. [1] or [2][3]). Only use numbers that exist in the CONTEXT.
- Never invent facts, papers, numbers or quotes.
- If the CONTEXT does not cover the request, say plainly that it is not covered in the uploaded sources (you may mention which related parts ARE covered).
- Do not write or modify a lesson plan. Just answer in chat, in plain text or simple Markdown."""

MARKS_PATTERN = re.compile(r"(\d+)\s*-?\s*marks?\b", re.IGNORECASE)


def answer_style_instructions(message: str) -> str:
    """Extra formatting rules for exam-style requests."""
    match = MARKS_PATTERN.search(message)
    if match:
        marks = int(match.group(1))
        points = max(2, min(marks, 10))
        words = max(60, min(marks * 35, 600))
        return (
            f"This is an exam question worth {marks} marks. Write a structured model answer: "
            f"a short heading, then about {points} numbered points (roughly {words - 25}-{words + 25} words in total), "
            f"each grounded in the CONTEXT with [n] citations, and a one-line conclusion at the end."
        )
    text = normalize(message)
    if "important questions" in text or "exam questions" in text or "question paper" in text:
        return (
            "List the most important exam questions that the CONTEXT supports, as a numbered list. "
            "After each question add a short hint of the expected answer with [n] citations."
        )
    return "Answer clearly and concisely (usually 2-6 sentences, or a short list if that fits better)."


def build_answer_messages(message: str, chunks: list[dict], history: list[dict]) -> list[dict]:
    return [
        {"role": "system", "content": ANSWER_SYSTEM_PROMPT},
        *history,
        {
            "role": "user",
            "content": (
                f"CONTEXT:\n{format_context(chunks)}\n\n---\n"
                f"REQUEST:\n{message}\n\n"
                f"FORMAT:\n{answer_style_instructions(message)}"
            ),
        },
    ]


def describe_refinement(instruction: str, old: LessonPlan | None, new: LessonPlan) -> str:
    """One short sentence on what changed in a refined plan (falls back to a fixed sentence)."""
    fallback = f'applied "{instruction.strip().rstrip(".")}" to "{new.title}"'
    try:
        old_outline = ", ".join(f"{i.title} ({i.type})" for i in old.outline) if old else "none"
        new_outline = ", ".join(f"{i.title} ({i.type})" for i in new.outline)
        text = complete_text(
            [
                {
                    "role": "system",
                    "content": "Describe in ONE short clause (max 20 words, no period, no preamble) what changed in a lesson plan.",
                },
                {
                    "role": "user",
                    "content": (
                        f"Instruction: {instruction}\n"
                        f"Old title: {old.title if old else '-'}\nOld outline: {old_outline}\n"
                        f"New title: {new.title}\nNew outline: {new_outline}"
                    ),
                },
            ],
            max_tokens=60,
        )
        text = text.strip().strip('"').rstrip(".").splitlines()[0] if text.strip() else ""
        return text[:200] or fallback
    except Exception as err:
        log.warning("[chat] change summary failed (%s); using fallback", readable_error(err))
        return fallback


# ---------------------------------------------------------------------------
# 5. Main SSE generator for POST /chat
# ---------------------------------------------------------------------------
def stream_answer(chat_request: ChatRequest, session: dict) -> Iterator[str]:
    """ANSWER mode: retrieve for the message, stream a cited answer, leave the plan alone."""
    cfg = chat_request.settings
    yield sse_event("status", {"step": "Searching sources"})
    chunks = get_answer_chunks(chat_request.message, cfg.source_ids)
    if not chunks:
        raise ValueError(
            "No readable passages in your sources match this question. "
            "Try rephrasing, select other sources, or add documents."
        )

    yield sse_event("status", {"step": f"Reading {len(chunks)} passages"})
    yield sse_event("status", {"step": "Writing answer"})
    yield sse_event("sources", {"items": build_source_items(chunks)})

    reply_parts: list[str] = []
    for token in stream_groq_reply(build_answer_messages(chat_request.message, chunks, session["history"])):
        reply_parts.append(token)
        yield sse_event("token", {"text": token})

    # Keep the turn for context; do NOT touch session["plan"] / ["chunks"]
    append_turn(session, chat_request.message, "".join(reply_parts).strip())


def stream_plan(chat_request: ChatRequest, session: dict, intent: str) -> Iterator[str]:
    """NEW_PLAN / REFINE mode: generate or update the plan and send a plan event."""
    cfg = chat_request.settings
    current_plan: LessonPlan | None = session["plan"]
    lesson_req = LessonRequest(
        topic=chat_request.message,
        level=cfg.level,
        duration_min=cfg.duration_min,
        audience=cfg.audience,
        objectives=cfg.objectives,
        source_ids=cfg.source_ids,
    )

    # Refinements reuse the plan's chunks unless the source filter changed
    needs_retrieval = (
        intent == INTENT_NEW_PLAN
        or not session["chunks"]
        or cfg.source_ids != session["source_ids"]
    )

    yield sse_event("status", {"step": "Searching sources"})
    chunks = get_context_chunks(lesson_req) if needs_retrieval else session["chunks"]
    if not chunks:
        raise ValueError(
            "No usable source material found for this topic. Ingest documents or change the source filter."
        )

    yield sse_event("status", {"step": f"Reading {len(chunks)} passages"})
    yield sse_event("status", {"step": "Drafting plan"})
    yield sse_event("sources", {"items": build_source_items(chunks)})

    plan = generate_from_chunks(
        lesson_req,
        chunks,
        history=session["history"],
        current_plan=current_plan if intent == INTENT_REFINE else None,
    )

    if intent == INTENT_REFINE:
        reply = f"I updated the plan: {describe_refinement(chat_request.message, current_plan, plan)}."
    else:
        reply = f"Here is your lesson plan: {plan.title}."
    for token in stream_words(reply):
        yield sse_event("token", {"text": token})

    session["plan"] = plan
    session["chunks"] = chunks
    session["source_ids"] = cfg.source_ids
    append_turn(session, chat_request.message, reply)

    yield sse_event("plan", {"data": plan.model_dump()})


def stream_chat(chat_request: ChatRequest) -> Iterator[str]:
    """Classify the message, then run the answer or plan pipeline as SSE events."""
    intent = INTENT_ANSWER
    try:
        session = get_session(chat_request.session_id)
        current_plan: LessonPlan | None = session["plan"]
        intent, how = classify_message(
            chat_request.message,
            has_plan=current_plan is not None,
            plan_title=current_plan.title if current_plan else None,
        )
        log.info(
            "[chat] session=%s intent=%s (via %s) has_plan=%s message=%r",
            chat_request.session_id, intent, how, current_plan is not None, chat_request.message[:120],
        )

        if intent == INTENT_ANSWER:
            yield from stream_answer(chat_request, session)
        else:
            yield from stream_plan(chat_request, session, intent)

        yield sse_event("done", {"intent": intent})

    except Exception as err:
        message = readable_error(err)
        log.error("[chat] session=%s intent=%s error: %s", chat_request.session_id, intent, message)
        yield sse_event("error", {"message": message})
        yield sse_event("done", {"intent": intent})
