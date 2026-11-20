"""
Course lesson generation service.

Handles the workflow for `POST /courses/{id}/lessons`:
  1. Select topics: either the teacher's explicit `topic_ids`, or the next
     'not_started' topics in syllabus order whose `est_minutes` fill ~85% of
     `duration_min` (leaving ~15% for recap, discussion, and wrap-up).
  2. Retrieve ONLY chunks inside those topics' page ranges (via `retrieve()`).
  3. Build course context (ordered topic list, previous lesson recap, stop list)
     and call `generate_from_chunks()` so all existing validation/timing checks run.
  4. Save the lesson in SQLite, mark its topics 'planned', and return the plan,
     covered_topics, remaining_topics, and updated progress.
"""

from app import db
from app.generate import RETRIEVE_K, generate_from_chunks, is_garbled
from app.retrieve import retrieve
from app.schemas import CourseCreate, CourseLessonCreate, LessonRequest
from app.syllabus import build_syllabus

TARGET_FILL_RATIO = 0.85  # target ~85% of lesson duration for topic est_minutes


def create_course_with_syllabus(request: CourseCreate) -> dict:
    """Build a syllabus from `request.source_ids` and persist the new course."""
    topics = build_syllabus(request.source_ids)
    return db.create_course(
        title=request.title,
        source_ids=request.source_ids,
        syllabus_topics=[t.model_dump() for t in topics],
    )


def select_next_topics(topics: list[dict], duration_min: int) -> list[dict]:
    """
    Pick consecutive 'not_started' topics in syllabus order until their
    estimated teaching time fills roughly 85% of `duration_min`.
    Always picks at least one topic if any 'not_started' topics exist.
    """
    pending = [t for t in topics if t["status"] == "not_started"]
    if not pending:
        raise ValueError("All topics in this course are already planned or taught.")

    target = duration_min * TARGET_FILL_RATIO
    selected: list[dict] = []
    total_min = 0

    for topic in pending:
        est = topic["est_minutes"]
        if not selected:
            # Always include the first pending topic even if it exceeds 85%
            selected.append(topic)
            total_min += est
            continue

        if total_min + est <= target:
            selected.append(topic)
            total_min += est
        elif total_min + est <= duration_min and abs((total_min + est) - target) < abs(total_min - target):
            # Include one more topic if it lands closer to 85% without exceeding duration_min
            selected.append(topic)
            total_min += est
            break
        else:
            break

    return selected


def _resolve_selected_topics(course: dict, requested_ids: list[str] | None, duration_min: int) -> list[dict]:
    """Either validate explicit `topic_ids` or auto-pick the next pending topics."""
    all_topics = course["topics"]
    if requested_ids is None:
        return select_next_topics(all_topics, duration_min)

    if not requested_ids:
        raise ValueError("topic_ids cannot be an empty list.")

    by_id = {t["id"]: t for t in all_topics}
    missing = [tid for tid in requested_ids if tid not in by_id]
    if missing:
        raise ValueError(f"Unknown topic_id(s) for course '{course['id']}': {missing}")

    # Preserve syllabus order and drop duplicates
    wanted = set(requested_ids)
    return [t for t in all_topics if t["id"] in wanted]


def _previous_lesson_recap(course: dict) -> dict | None:
    """Return the most recent lesson's title and covered topic titles (or None)."""
    lessons = course["lessons"]
    if not lessons:
        return None
    prev = lessons[-1]
    by_id = {t["id"]: t["title"] for t in course["topics"]}
    covered = prev["plan"].get("covered_topics") or [
        by_id[tid] for tid in prev["topic_ids"] if tid in by_id
    ]
    return {"title": prev["title"], "covered_topics": covered}


def generate_course_lesson(course_id: str, request: CourseLessonCreate) -> dict:
    """Generate, validate, save, and return the next lesson for a course."""
    course = db.get_course(course_id)
    if course is None:
        raise KeyError(f"Course '{course_id}' not found.")

    selected_topics = _resolve_selected_topics(course, request.topic_ids, request.duration_min)
    selected_ids = [t["id"] for t in selected_topics]
    selected_set = set(selected_ids)

    # Topics that will still remain 'not_started' after this lesson is saved
    remaining_before_save = [
        t for t in course["topics"]
        if t["status"] == "not_started" and t["id"] not in selected_set
    ]

    # Retrieve ONLY chunks inside the selected topics' page ranges
    page_ranges = [(t["page_start"], t["page_end"]) for t in selected_topics]
    query_parts = [f"{t['title']}: {t['summary']}" for t in selected_topics]
    if request.objectives:
        query_parts.extend(request.objectives)
    query = " ".join(query_parts)

    k = min(12, max(RETRIEVE_K, len(selected_topics) * 3))
    chunks = [
        c for c in retrieve(query, k=k, source_ids=course["source_ids"], page_ranges=page_ranges)
        if not is_garbled(c["text"])
    ]
    if not chunks:
        raise ValueError(
            f"No readable source chunks found inside page ranges {page_ranges} for the selected topics."
        )

    lesson_seq = (course["lessons"][-1]["seq"] + 1) if course["lessons"] else 1
    topic_label = ", ".join(t["title"] for t in selected_topics)
    lesson_req = LessonRequest(
        topic=f"{course['title']} - Lesson {lesson_seq}: {topic_label}",
        level=request.level,
        duration_min=request.duration_min,
        audience=request.audience,
        objectives=request.objectives,
        source_ids=course["source_ids"],
    )
    course_context = {
        "course_title": course["title"],
        "lesson_seq": lesson_seq,
        "topics": selected_topics,
        "previous_lesson": _previous_lesson_recap(course),
        "not_covered_yet": [t["title"] for t in remaining_before_save],
    }

    # Existing schema, timing, and citation validation checks run inside generate_from_chunks()
    plan = generate_from_chunks(lesson_req, chunks, course_context=course_context)

    saved = db.save_lesson(
        course_id=course_id,
        title=plan.title,
        duration_min=request.duration_min,
        topic_ids=selected_ids,
        plan_dict=plan.model_dump(),
    )

    # Re-read updated topic statuses and course progress after saving
    updated = db.get_course(course_id)
    topics_by_id = {t["id"]: t for t in updated["topics"]}
    covered_topics = [topics_by_id[tid] for tid in selected_ids if tid in topics_by_id]
    remaining_topics = [t for t in updated["topics"] if t["status"] == "not_started"]

    return {
        **saved,
        "covered_topics": covered_topics,
        "remaining_topics": remaining_topics,
        "progress": updated["progress"],
    }

