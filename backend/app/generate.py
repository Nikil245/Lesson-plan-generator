"""
Step 4 - Generation.

    request -> retrieve chunks -> drop garbled chunks -> numbered context
            -> Groq (JSON mode) -> Pydantic validation -> checks -> LessonPlan

Retry policy: the LLM gets at most MAX_ATTEMPTS tries. If its answer is not
valid JSON / does not match the schema, or fails our checks (timing, citation
numbers), the error is sent back to the model and it tries again. Whatever is
still wrong after the last try is repaired in code (timings rescaled,
unknown citation numbers removed).

CLI usage (run from the backend folder):
    python -m app.generate "few-shot prompting" --level beginner --duration 60
    python -m app.generate "ReAct agents" --duration 45 --sources 2210-03629v3 --json
"""

import argparse
import json
import re

from groq import Groq
from pydantic import ValidationError

from app.config import settings
from app.retrieve import retrieve
from app.schemas import Citation, LessonPlan, LessonRequest

RETRIEVE_K = 8      # chunks fetched for the context
MAX_ATTEMPTS = 2    # first try + one retry
TEMPERATURE = 0.3   # low = more faithful to the context, less "creative"


# ---------------------------------------------------------------------------
# 1. Context building
# ---------------------------------------------------------------------------
# Very common English words. Normal prose is full of them; text extracted from
# a PDF with a broken font encoding (e.g. "Xkqz Tvbrp Wqmn") contains almost none.
COMMON_WORDS = {
    "the", "of", "and", "to", "a", "in", "is", "that", "for", "it", "as", "with",
    "on", "be", "by", "this", "are", "or", "an", "from", "we", "can", "at", "not",
    "which", "model", "models", "language", "prompt", "task", "you", "they", "has",
}
CONSONANT_RUN = re.compile(r"[bcdfghjklmnpqrstvwxz]{5,}", re.IGNORECASE)


def is_garbled(text: str) -> bool:
    """
    Heuristic check for chunks with broken text encoding. A chunk is garbled if:
      - fewer than 60% of its characters are letters or spaces, or
      - fewer than 70% of its words look like real words (have a vowel and
        no run of 5+ consonants), or
      - almost none (< 5%) of its words are common English words (only
        checked for chunks of 40+ words).
    """
    if not text.strip():
        return True
    letters_or_spaces = sum(ch.isalpha() or ch.isspace() for ch in text)
    if letters_or_spaces / len(text) < 0.6:
        return True

    words = re.findall(r"[A-Za-z]+", text)
    if len(words) < 5:
        return True
    word_like = sum(1 for w in words if re.search(r"[aeiouy]", w, re.I) and not CONSONANT_RUN.search(w))
    if word_like / len(words) < 0.7:
        return True
    # Short bullet-point slides naturally have few function words, so this
    # last test is only applied to longer chunks.
    if len(words) < 40:
        return False
    common = sum(1 for w in words if w.lower() in COMMON_WORDS)
    return common / len(words) < 0.05


def get_context_chunks(request: LessonRequest) -> list[dict]:
    """Retrieve chunks for the topic (+ objectives) and drop garbled ones."""
    query = request.topic
    if request.objectives:
        query += ". " + " ".join(request.objectives)
    chunks = retrieve(query, k=RETRIEVE_K, source_ids=request.source_ids)
    return [c for c in chunks if not is_garbled(c["text"])]


def format_context(chunks: list[dict]) -> str:
    """Number the chunks so the model can cite them: [1] (Title, p. 6) text..."""
    blocks = [f"[{i}] ({c['title']}, p. {c['page']})\n{c['text']}" for i, c in enumerate(chunks, start=1)]
    return "\n\n".join(blocks)


# ---------------------------------------------------------------------------
# 2. Prompt
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """You are Lessonwright, an assistant that writes lesson plans for teachers of prompt engineering.

RULES (follow all of them):
1. Use ONLY the information in the numbered CONTEXT. Do not use outside knowledge for facts.
2. Cite the context with [n] (e.g. "[2]" or "[1][3]") inside descriptions, objectives and assessment items whenever you use a fact from it.
3. If the context does not cover something the lesson needs, write "not in sources" for that part instead of guessing.
4. Never invent papers, authors, numbers, results or quotes. further_reading may only list documents that appear in the CONTEXT (use their titles).
5. The outline must start at minute 0, items must be contiguous (each start_min equals the previous end_min), and the last item's end_min must equal duration_min exactly.
6. Every outline item has a type that is exactly one of: "demo", "discuss", "hands-on". Include an example_prompt (a prompt students can try) for demo and hands-on items when helpful, otherwise null.
7. Match the requested level, audience and duration.

Respond with a single JSON object, no markdown, with exactly these keys:
{
  "title": str,
  "level": str,
  "audience": str,
  "duration_min": int,
  "objectives": [str],
  "prerequisites": [str],
  "outline": [{"start_min": int, "end_min": int, "title": str, "type": "demo|discuss|hands-on", "description": str, "example_prompt": str or null}],
  "assessment": [str],
  "further_reading": [str]
}"""


def build_user_message(request: LessonRequest, context: str) -> str:
    """The per-request message: numbered context first, then the teacher's request."""
    objectives = "\n".join(f"- {o}" for o in request.objectives) or "- (none given: derive 3-4 from the context)"
    return (
        f"CONTEXT:\n{context}\n\n"
        f"---\nLESSON REQUEST:\n"
        f"Topic: {request.topic}\n"
        f"Level: {request.level}\n"
        f"Audience: {request.audience}\n"
        f"duration_min: {request.duration_min}\n"
        f"Teacher's objectives:\n{objectives}\n\n"
        f"Return the lesson plan as JSON."
    )


def build_refinement_message(request: LessonRequest, context: str, current_plan: LessonPlan) -> str:
    """Prompt for updating an existing plan with a follow-up instruction."""
    existing_json = json.dumps(current_plan.model_dump(exclude={"citations"}), indent=2)
    objectives = "\n".join(f"- {o}" for o in request.objectives) or "- (keep or refine current objectives)"
    return (
        f"CONTEXT:\n{context}\n\n"
        f"---\nCURRENT LESSON PLAN (JSON):\n{existing_json}\n\n"
        f"---\nREFINEMENT REQUEST:\n"
        f"Instruction: {request.topic}\n"
        f"Level: {request.level}\n"
        f"Audience: {request.audience}\n"
        f"duration_min: {request.duration_min}\n"
        f"Teacher's objectives:\n{objectives}\n\n"
        f"Update the current lesson plan according to the instruction. Keep facts grounded in the "
        f"CONTEXT with [n] citations and return the complete updated lesson plan as JSON."
    )



# ---------------------------------------------------------------------------
# 3. Checks and repairs
# ---------------------------------------------------------------------------
CITATION_PATTERN = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")  # matches [3] and [1, 3]


def map_strings(value, fn):
    """Apply fn to every string inside nested dicts/lists (used to scan/edit the plan)."""
    if isinstance(value, str):
        return fn(value)
    if isinstance(value, list):
        return [map_strings(v, fn) for v in value]
    if isinstance(value, dict):
        return {k: map_strings(v, fn) for k, v in value.items()}
    return value


def used_citation_numbers(plan: LessonPlan) -> set[int]:
    """Collect every n that appears as [n] anywhere in the plan."""
    found: set[int] = set()

    def collect(text: str) -> str:
        for group in CITATION_PATTERN.findall(text):
            found.update(int(n) for n in group.split(","))
        return text

    map_strings(plan.model_dump(exclude={"citations"}), collect)
    return found


def check_plan(plan: LessonPlan, duration: int, n_chunks: int) -> list[str]:
    """Return a list of human-readable problems (empty list = plan is fine)."""
    problems = []
    outline = plan.outline
    if outline[0].start_min != 0:
        problems.append("The first outline item must start at minute 0.")
    for prev, item in zip(outline, outline[1:]):
        if item.start_min != prev.end_min:
            problems.append(f"'{item.title}' starts at {item.start_min} but the previous item ends at {prev.end_min}.")
    if any(item.end_min <= item.start_min for item in outline):
        problems.append("Every outline item must have end_min greater than start_min.")
    if outline[-1].end_min != duration:
        problems.append(f"The last item ends at {outline[-1].end_min}, but duration_min is {duration}.")

    invalid = sorted(n for n in used_citation_numbers(plan) if not 1 <= n <= n_chunks)
    if invalid:
        problems.append(f"Citations {invalid} do not exist; only [1]..[{n_chunks}] are allowed.")
    return problems


def fix_timing(plan: LessonPlan, duration: int) -> None:
    """Rescale item lengths so they are contiguous and add up to `duration`."""
    lengths = [max(1, item.end_min - item.start_min) for item in plan.outline]
    total = sum(lengths)
    scaled = [max(1, round(length * duration / total)) for length in lengths]
    scaled[-1] += duration - sum(scaled)   # put rounding leftovers in the last item
    while scaled[-1] < 1:                  # rare: last item went to 0 or below
        biggest = scaled.index(max(scaled[:-1]))
        scaled[biggest] -= 1
        scaled[-1] += 1
    start = 0
    for item, length in zip(plan.outline, scaled):
        item.start_min, item.end_min = start, start + length
        start += length


def remove_invalid_citations(plan: LessonPlan, n_chunks: int) -> LessonPlan:
    """Drop citation numbers that do not match a context chunk, e.g. [9] when only 6 exist."""
    def clean(text: str) -> str:
        def keep_valid(match: re.Match) -> str:
            valid = [n.strip() for n in match.group(1).split(",") if 1 <= int(n) <= n_chunks]
            return f"[{', '.join(valid)}]" if valid else ""
        return CITATION_PATTERN.sub(keep_valid, text)

    return LessonPlan.model_validate(map_strings(plan.model_dump(), clean))


def build_citations(plan: LessonPlan, chunks: list[dict]) -> list[Citation]:
    """Turn every [n] used in the plan into a Citation pointing at chunk n."""
    citations = []
    for n in sorted(used_citation_numbers(plan)):
        if 1 <= n <= len(chunks):
            c = chunks[n - 1]
            citations.append(Citation(n=n, source_id=c["source_id"], title=c["title"], page=c["page"], url=c["url"]))
    return citations


# ---------------------------------------------------------------------------
# 4. LLM call + main function
# ---------------------------------------------------------------------------
def call_groq(messages: list[dict]) -> str:
    """Send the conversation to Groq in JSON mode and return the raw text."""
    if not settings.GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not set in backend/.env")
    client = Groq(api_key=settings.GROQ_API_KEY)
    response = client.chat.completions.create(
        model=settings.GROQ_MODEL,
        messages=messages,
        temperature=TEMPERATURE,
        response_format={"type": "json_object"},  # Groq guarantees syntactically valid JSON
    )
    return response.choices[0].message.content


def generate_from_chunks(
    request: LessonRequest,
    chunks: list[dict],
    history: list[dict] | None = None,
    current_plan: LessonPlan | None = None,
) -> LessonPlan:
    """
    Generate a new plan (or refine `current_plan`) from already-retrieved chunks.
    Shared by POST /lesson-plan and POST /chat.
    """
    if not chunks:
        raise ValueError("No usable source material found for this topic. Ingest documents or change the source filter.")

    context = format_context(chunks)
    user_msg = (
        build_refinement_message(request, context, current_plan)
        if current_plan is not None
        else build_user_message(request, context)
    )
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *(history or []),
        {"role": "user", "content": user_msg},
    ]

    plan = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        raw = call_groq(messages)
        try:
            plan = LessonPlan.model_validate(json.loads(raw))
            problems = check_plan(plan, request.duration_min, len(chunks))
        except (json.JSONDecodeError, ValidationError) as err:
            plan, problems = None, [f"Your JSON did not match the required schema: {err}"]

        if not problems:
            break
        if attempt < MAX_ATTEMPTS:
            # Show the model its own answer and what was wrong with it, then retry
            messages += [
                {"role": "assistant", "content": raw},
                {"role": "user", "content": "Fix these problems and return the full corrected JSON:\n- " + "\n- ".join(problems)},
            ]

    if plan is None:
        raise RuntimeError("The model did not return a valid lesson plan after retrying.")

    # Final repairs for anything the retry did not fix
    plan = remove_invalid_citations(plan, len(chunks))
    fix_timing(plan, request.duration_min)

    # Fields we control ourselves rather than trusting the model
    plan.level = request.level
    plan.audience = request.audience
    plan.duration_min = request.duration_min
    plan.citations = build_citations(plan, chunks)
    return plan


def generate_lesson_plan(request: LessonRequest, history: list[dict] | None = None) -> LessonPlan:
    """
    Build a lesson plan grounded in the retrieved sources.

    `history` is an optional list of earlier chat messages
    ({"role": "user"|"assistant", "content": ...}); it is placed between the
    system prompt and the new request so the model can refine a previous plan.
    """
    chunks = get_context_chunks(request)
    return generate_from_chunks(request, chunks, history=history)



# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------
def print_plan(plan: LessonPlan) -> None:
    """Pretty-print a plan in the terminal."""
    def section(name: str, items: list[str]) -> None:
        print(f"\n{name}:")
        for item in items or ["-"]:
            print(f"  - {item}")

    print(f"\n=== {plan.title} ===")
    print(f"Level: {plan.level} | Audience: {plan.audience} | Duration: {plan.duration_min} min")
    section("Objectives", plan.objectives)
    section("Prerequisites", plan.prerequisites)
    print("\nOutline:")
    for item in plan.outline:
        print(f"  {item.start_min:>3}-{item.end_min:<3} min  [{item.type}] {item.title}")
        print(f"             {item.description}")
        if item.example_prompt:
            prompt = item.example_prompt.replace("\n", "\n" + " " * 29)  # keep indentation
            print(f"             Example prompt: {prompt}")
    section("Assessment", plan.assessment)
    section("Further reading", plan.further_reading)
    print("\nCitations:")
    for c in plan.citations:
        print(f"  [{c.n}] {c.title}, p. {c.page}  {c.url}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a lesson plan from the ingested sources.")
    parser.add_argument("topic")
    parser.add_argument("--level", default="beginner")
    parser.add_argument("--duration", type=int, default=60, help="minutes")
    parser.add_argument("--audience", default="university students")
    parser.add_argument("--objective", action="append", default=[], help="repeat for several objectives")
    parser.add_argument("--sources", help="comma-separated source ids")
    parser.add_argument("--json", action="store_true", help="print raw JSON instead of text")
    args = parser.parse_args()

    request = LessonRequest(
        topic=args.topic,
        level=args.level,
        duration_min=args.duration,
        audience=args.audience,
        objectives=args.objective,
        source_ids=[s.strip() for s in args.sources.split(",")] if args.sources else None,
    )
    plan = generate_lesson_plan(request)
    if args.json:
        print(plan.model_dump_json(indent=2))
    else:
        print_plan(plan)


if __name__ == "__main__":
    main()
