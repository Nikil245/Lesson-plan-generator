"""
Syllabus builder: turns one or more ingested sources into an ordered list of
8-20 teachable course topics.

Pipeline:
    source_ids -> load chunks in page order -> drop garbled chunks
               -> batch chunks -> Groq (JSON mode) per batch
               -> merge & deduplicate -> enforce contiguous non-overlapping pages
               -> validate with Pydantic (SyllabusTopic)
"""

import json
import re

from groq import Groq
from pydantic import ValidationError

from app.config import settings
from app.generate import is_garbled
from app.schemas import SyllabusTopic
from app.store import get_collection

MAX_BATCH_CHARS = 24_000   # ~6,000 tokens per Groq call (safe for TPM/context limits)
MAX_TOPICS = 20
MIN_TOPICS = 8
MAX_BATCH_ATTEMPTS = 2
TEMPERATURE = 0.2

SYLLABUS_SYSTEM_PROMPT = """You are Lessonwright, a curriculum designer building a course syllabus from source documents.

RULES (follow all of them):
1. Use ONLY the given text. Do NOT invent topics, concepts, examples, or page numbers that do not appear in the provided excerpts.
2. Produce an ordered list of distinct, teachable topics following the order in which they appear in the source text.
3. For each topic provide:
   - "title": concise topic name grounded in the text
   - "summary": ONE clear sentence describing what the text teaches for this topic
   - "page_start": first page number (integer) where this topic appears in the excerpts
   - "page_end": last page number (integer, >= page_start) where this topic appears in the excerpts
   - "est_minutes": realistic classroom teaching time as an integer between 5 and 40
4. Keep topics non-overlapping and in ascending page order.

Respond with a single JSON object, no markdown, with this exact shape:
{
  "topics": [
    {
      "title": "...",
      "summary": "...",
      "page_start": 1,
      "page_end": 4,
      "est_minutes": 15
    }
  ]
}"""


# ---------------------------------------------------------------------------
# 1. Loading & batching chunks in page order
# ---------------------------------------------------------------------------
def load_ordered_chunks(source_ids: list[str]) -> list[dict]:
    """
    Read all non-garbled chunks for `source_ids` from Chroma, ordered by
    source order then (page, chunk_index).
    """
    if not source_ids:
        raise ValueError("At least one source_id is required to build a syllabus.")

    collection = get_collection()
    ordered: list[dict] = []

    for sid in source_ids:
        result = collection.get(where={"source_id": sid}, include=["documents", "metadatas"])
        if not result["ids"]:
            raise ValueError(f"Source '{sid}' was not found in the vector store.")

        pairs = sorted(
            zip(result["documents"], result["metadatas"]),
            key=lambda item: (item[1]["page"], item[1]["chunk_index"]),
        )
        for text, meta in pairs:
            if is_garbled(text):
                continue
            ordered.append({
                "source_id": meta["source_id"],
                "title": meta["title"],
                "page": int(meta["page"]),
                "chunk_index": int(meta["chunk_index"]),
                "text": text,
            })

    if not ordered:
        raise ValueError("No readable (non-garbled) chunks found for the selected source(s).")
    return ordered


def make_batches(chunks: list[dict], max_chars: int = MAX_BATCH_CHARS) -> list[list[dict]]:
    """Group ordered chunks into character-bounded batches for LLM calls."""
    batches: list[list[dict]] = []
    current: list[dict] = []
    current_chars = 0

    for chunk in chunks:
        chunk_len = len(chunk["text"]) + 32  # account for the [p. N] header
        if current and current_chars + chunk_len > max_chars:
            batches.append(current)
            current = []
            current_chars = 0
        current.append(chunk)
        current_chars += chunk_len

    if current:
        batches.append(current)
    return batches


# ---------------------------------------------------------------------------
# 2. Groq JSON-mode extraction per batch
# ---------------------------------------------------------------------------
def _reasoning_kwargs(model: str) -> dict:
    """Keep hidden reasoning short on reasoning-capable models (e.g. gpt-oss)."""
    name = model.lower()
    if "gpt-oss" in name or "qwen3" in name or "deepseek-r1" in name:
        return {"reasoning_effort": "low", "include_reasoning": False}
    return {}


def _extract_batch_topics(
    batch: list[dict],
    batch_idx: int,
    total_batches: int,
    target_min: int,
    target_max: int,
) -> list[dict]:
    """Send one batch of page-ordered chunks to Groq in JSON mode and parse raw topic dicts."""
    if not settings.GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not set in backend/.env")

    pages = [c["page"] for c in batch]
    page_lo, page_hi = min(pages), max(pages)
    excerpts = "\n\n".join(f"[p. {c['page']}] ({c['title']})\n{c['text']}" for c in batch)

    user_msg = (
        f"Batch {batch_idx} of {total_batches} (pages {page_lo} to {page_hi}).\n"
        f"Extract between {target_min} and {target_max} ordered, teachable topics "
        f"covering pages {page_lo} to {page_hi}, using ONLY the text below.\n\n"
        f"EXCERPTS:\n{excerpts}\n\n"
        f"Return the JSON object with the 'topics' list."
    )

    messages = [
        {"role": "system", "content": SYLLABUS_SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]

    client = Groq(api_key=settings.GROQ_API_KEY)
    last_err: Exception | None = None

    for attempt in range(1, MAX_BATCH_ATTEMPTS + 1):
        response = client.chat.completions.create(
            model=settings.GROQ_MODEL,
            messages=messages,
            temperature=TEMPERATURE,
            response_format={"type": "json_object"},
            **_reasoning_kwargs(settings.GROQ_MODEL),
        )
        raw = (response.choices[0].message.content or "").strip()
        try:
            data = json.loads(raw)
            topics = data.get("topics")
            if not isinstance(topics, list) or not topics:
                raise ValueError("JSON response must contain a non-empty 'topics' list.")
            return topics
        except (json.JSONDecodeError, ValueError) as err:
            last_err = err
            if attempt < MAX_BATCH_ATTEMPTS:
                messages += [
                    {"role": "assistant", "content": raw},
                    {"role": "user", "content": f"Fix this error and return valid JSON: {err}"},
                ]

    raise RuntimeError(f"Syllabus extraction failed on batch {batch_idx}: {last_err}")


# ---------------------------------------------------------------------------
# 3. Merging, deduplication, and contiguous page-range normalization
# ---------------------------------------------------------------------------
def _norm_words(title: str) -> set[str]:
    cleaned = re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()
    return {w for w in cleaned.split() if len(w) > 1}


def _is_duplicate(title_a: str, title_b: str) -> bool:
    """Detect exact or near-duplicate topic titles across batch boundaries."""
    a_clean = re.sub(r"[^a-z0-9]+", " ", title_a.lower()).strip()
    b_clean = re.sub(r"[^a-z0-9]+", " ", title_b.lower()).strip()
    if a_clean == b_clean:
        return True
    wa, wb = _norm_words(title_a), _norm_words(title_b)
    if len(wa) >= 2 and len(wb) >= 2:
        jaccard = len(wa & wb) / len(wa | wb)
        return jaccard >= 0.75
    return False


def _clean_raw_topic(raw: dict, min_page: int, max_page: int) -> dict | None:
    """Coerce raw LLM fields into safe types and clamp ranges before validation."""
    if not isinstance(raw, dict):
        return None
    title = str(raw.get("title", "")).strip()
    summary = str(raw.get("summary", "")).strip()
    if len(title) < 2:
        return None
    if len(summary) < 5:
        summary = f"Covers {title} based on the source material."

    try:
        p_start = int(raw.get("page_start", min_page))
        p_end = int(raw.get("page_end", p_start))
    except (TypeError, ValueError):
        p_start, p_end = min_page, min_page

    p_start = max(min_page, min(p_start, max_page))
    p_end = max(p_start, min(p_end, max_page))

    try:
        est = int(raw.get("est_minutes", 15))
    except (TypeError, ValueError):
        est = 15
    est = max(5, min(est, 40))

    return {
        "title": title,
        "summary": summary,
        "page_start": p_start,
        "page_end": p_end,
        "est_minutes": est,
    }


def _deduplicate_topics(topics: list[dict]) -> list[dict]:
    """Remove duplicate titles while preserving order and extending page ranges."""
    unique: list[dict] = []
    for topic in topics:
        match = next((u for u in unique if _is_duplicate(u["title"], topic["title"])), None)
        if match is not None:
            match["page_start"] = min(match["page_start"], topic["page_start"])
            match["page_end"] = max(match["page_end"], topic["page_end"])
            match["est_minutes"] = min(40, max(match["est_minutes"], topic["est_minutes"]))
        else:
            unique.append(topic)
    return unique


def _cap_topic_count(topics: list[dict], max_topics: int = MAX_TOPICS) -> list[dict]:
    """If batch merging produced > 20 topics, merge the smallest adjacent pairs."""
    items = list(topics)
    while len(items) > max_topics:
        # Find adjacent pair with smallest combined estimated teaching time
        best_idx = min(
            range(len(items) - 1),
            key=lambda i: items[i]["est_minutes"] + items[i + 1]["est_minutes"],
        )
        left, right = items[best_idx], items[best_idx + 1]
        merged = {
            "title": f"{left['title']} & {right['title']}" if len(left["title"]) + len(right["title"]) < 80 else left["title"],
            "summary": left["summary"],
            "page_start": min(left["page_start"], right["page_start"]),
            "page_end": max(left["page_end"], right["page_end"]),
            "est_minutes": min(40, left["est_minutes"] + right["est_minutes"]),
        }
        items[best_idx : best_idx + 2] = [merged]
    return items


def _normalize_page_ranges(topics: list[dict], min_page: int, max_page: int) -> list[dict]:
    """
    Make topic page ranges contiguous and non-overlapping across [min_page, max_page].

    When the source has at least as many pages as topics (the standard case for
    PDFs), every topic gets a strictly disjoint slice and consecutive topics
    satisfy `next.page_start == prev.page_end + 1`.
    If a very short file (e.g. a 1-page .md file) has fewer pages than topics,
    pages are distributed monotonically across [min_page, max_page] with no gaps.
    """
    n = len(topics)
    if n == 0:
        return []

    total_pages = max_page - min_page + 1

    if n <= total_pages:
        cur_start = min_page
        for i, topic in enumerate(topics):
            remaining_after = n - 1 - i
            max_end_allowed = max_page - remaining_after

            if i == n - 1:
                end = max_page
            else:
                suggested = topic["page_end"]
                next_start = topics[i + 1]["page_start"]
                # Close any gap between this topic and the next topic
                if next_start > suggested + 1:
                    suggested = next_start - 1
                end = max(cur_start, min(suggested, max_end_allowed))

            topic["page_start"] = cur_start
            topic["page_end"] = end
            cur_start = end + 1
    else:
        # Fewer pages than topics (e.g. a single-page markdown/text file)
        for i, topic in enumerate(topics):
            p = min_page + (i * total_pages) // n
            topic["page_start"] = p
            topic["page_end"] = p
        topics[0]["page_start"] = min_page
        topics[-1]["page_end"] = max_page

    return topics


# ---------------------------------------------------------------------------
# 4. Public entry point
# ---------------------------------------------------------------------------
def build_syllabus(source_ids: list[str]) -> list[SyllabusTopic]:
    """
    Build a validated, ordered syllabus of 8-20 teachable topics from `source_ids`.
    """
    chunks = load_ordered_chunks(source_ids)
    min_page = min(c["page"] for c in chunks)
    max_page = max(c["page"] for c in chunks)

    batches = make_batches(chunks)
    n_batches = len(batches)

    # Distribute the 8-20 target topic budget evenly across batches
    if n_batches == 1:
        target_min, target_max = MIN_TOPICS, 16
    else:
        target_min = max(2, round(10 / n_batches))
        target_max = max(target_min + 2, round(MAX_TOPICS / n_batches))

    raw_topics: list[dict] = []
    for idx, batch in enumerate(batches, start=1):
        extracted = _extract_batch_topics(batch, idx, n_batches, target_min, target_max)
        for item in extracted:
            cleaned = _clean_raw_topic(item, min_page, max_page)
            if cleaned is not None:
                raw_topics.append(cleaned)

    if not raw_topics:
        raise RuntimeError("Could not extract any valid topics from the source material.")

    # Order by page appearance, deduplicate, cap to 20, and enforce contiguous pages
    raw_topics.sort(key=lambda t: (t["page_start"], t["page_end"]))
    merged = _deduplicate_topics(raw_topics)
    merged = _cap_topic_count(merged, MAX_TOPICS)
    merged = _normalize_page_ranges(merged, min_page, max_page)

    # Final Pydantic validation for every topic
    validated: list[SyllabusTopic] = []
    for item in merged:
        try:
            validated.append(SyllabusTopic.model_validate(item))
        except ValidationError as err:
            raise RuntimeError(f"Syllabus topic failed validation: {err}") from err

    return validated

