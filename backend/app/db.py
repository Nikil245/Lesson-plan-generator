"""
SQLite persistence layer for courses, syllabus topics, and generated lessons.

Uses Python's built-in `sqlite3` module (zero external dependencies) with the
database file located at `settings.DB_PATH` (default: `data/lessonwright.db`).

Tables:
    courses(id, title, source_ids JSON, created_at)
    topics(id, course_id, position, title, summary, page_start, page_end,
           est_minutes, status 'not_started'|'planned'|'taught')
    lessons(id, course_id, seq, title, duration_min, topic_ids JSON,
            plan JSON, status 'planned'|'taught', created_at)
"""

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator

from app.config import settings

# How many upcoming 'not_started' topics to include in progress['next_topics']
NEXT_TOPICS_LIMIT = 5

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS courses (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    source_ids  TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS topics (
    id          TEXT PRIMARY KEY,
    course_id   TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    title       TEXT NOT NULL,
    summary     TEXT NOT NULL DEFAULT '',
    page_start  INTEGER NOT NULL,
    page_end    INTEGER NOT NULL,
    est_minutes INTEGER NOT NULL,
    status      TEXT NOT NULL DEFAULT 'not_started'
                CHECK (status IN ('not_started', 'planned', 'taught'))
);

CREATE TABLE IF NOT EXISTS lessons (
    id           TEXT PRIMARY KEY,
    course_id    TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    seq          INTEGER NOT NULL,
    title        TEXT NOT NULL,
    duration_min INTEGER NOT NULL,
    topic_ids    TEXT NOT NULL,
    plan         TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'planned'
                 CHECK (status IN ('planned', 'taught')),
    created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_topics_course_pos ON topics(course_id, position);
CREATE INDEX IF NOT EXISTS idx_lessons_course_seq ON lessons(course_id, seq);
"""


# ---------------------------------------------------------------------------
# 1. Connection & schema setup
# ---------------------------------------------------------------------------
def _now_iso() -> str:
    """Current UTC timestamp in ISO-8601 format."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _new_id(prefix: str) -> str:
    """Short, readable unique ID such as 'crs_a1b2c3d4'."""
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def init_db() -> None:
    """Ensure the parent folder exists and all three tables are created."""
    settings.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(settings.DB_PATH) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(SCHEMA_SQL)


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    """Yield a SQLite connection with Row dicts, foreign keys, and auto-commit."""
    init_db()
    conn = sqlite3.connect(settings.DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# 2. Row serializers
# ---------------------------------------------------------------------------
def _course_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "source_ids": json.loads(row["source_ids"]),
        "created_at": row["created_at"],
    }


def _topic_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "course_id": row["course_id"],
        "position": row["position"],
        "title": row["title"],
        "summary": row["summary"],
        "page_start": row["page_start"],
        "page_end": row["page_end"],
        "est_minutes": row["est_minutes"],
        "status": row["status"],
    }


def _lesson_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "course_id": row["course_id"],
        "seq": row["seq"],
        "title": row["title"],
        "duration_min": row["duration_min"],
        "topic_ids": json.loads(row["topic_ids"]),
        "plan": json.loads(row["plan"]),
        "status": row["status"],
        "created_at": row["created_at"],
    }


# ---------------------------------------------------------------------------
# 3. Progress calculation
# ---------------------------------------------------------------------------
def compute_progress(topics: list[dict]) -> dict:
    """
    Compute course progress metrics from its ordered topic list:
        topics_total, planned, taught, percent_topics, percent_pages, next_topics[]

    Percentages measure topics/pages that have been marked 'taught'.
    Using sets of page numbers avoids double-counting if a teacher manually
    creates overlapping page ranges.
    """
    total = len(topics)
    planned = sum(1 for t in topics if t["status"] == "planned")
    taught = sum(1 for t in topics if t["status"] == "taught")

    all_pages: set[int] = set()
    taught_pages: set[int] = set()
    for t in topics:
        start, end = min(t["page_start"], t["page_end"]), max(t["page_start"], t["page_end"])
        pages = range(start, end + 1)
        all_pages.update(pages)
        if t["status"] == "taught":
            taught_pages.update(pages)

    percent_topics = round(100.0 * taught / total, 1) if total > 0 else 0.0
    percent_pages = round(100.0 * len(taught_pages) / len(all_pages), 1) if all_pages else 0.0

    next_topics = [
        {
            "id": t["id"],
            "position": t["position"],
            "title": t["title"],
            "page_start": t["page_start"],
            "page_end": t["page_end"],
            "est_minutes": t["est_minutes"],
        }
        for t in topics
        if t["status"] == "not_started"
    ][:NEXT_TOPICS_LIMIT]

    return {
        "topics_total": total,
        "planned": planned,
        "taught": taught,
        "percent_topics": percent_topics,
        "percent_pages": percent_pages,
        "next_topics": next_topics,
    }


def _fetch_topics(conn: sqlite3.Connection, course_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM topics WHERE course_id = ? ORDER BY position ASC, id ASC",
        (course_id,),
    ).fetchall()
    return [_topic_row(r) for r in rows]


def _fetch_lessons(conn: sqlite3.Connection, course_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM lessons WHERE course_id = ? ORDER BY seq ASC",
        (course_id,),
    ).fetchall()
    return [_lesson_row(r) for r in rows]


def _renumber_topics(conn: sqlite3.Connection, course_id: str, ordered_ids: list[str]) -> None:
    """Assign contiguous 1..N positions to a course's topics."""
    for pos, tid in enumerate(ordered_ids, start=1):
        conn.execute(
            "UPDATE topics SET position = ? WHERE id = ? AND course_id = ?",
            (pos, tid, course_id),
        )


# ---------------------------------------------------------------------------
# 4. Courses CRUD
# ---------------------------------------------------------------------------
def create_course(title: str, source_ids: list[str], syllabus_topics: list[dict]) -> dict:
    """Create a course row and its initial syllabus topics inside one transaction."""
    course_id = _new_id("crs")
    created_at = _now_iso()

    with get_conn() as conn:
        conn.execute(
            "INSERT INTO courses (id, title, source_ids, created_at) VALUES (?, ?, ?, ?)",
            (course_id, title.strip(), json.dumps(source_ids), created_at),
        )
        for pos, topic in enumerate(syllabus_topics, start=1):
            conn.execute(
                """
                INSERT INTO topics
                    (id, course_id, position, title, summary, page_start, page_end, est_minutes, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'not_started')
                """,
                (
                    _new_id("top"),
                    course_id,
                    pos,
                    topic["title"],
                    topic.get("summary", ""),
                    topic["page_start"],
                    topic["page_end"],
                    topic["est_minutes"],
                ),
            )
        topics = _fetch_topics(conn, course_id)

    return {
        "id": course_id,
        "title": title.strip(),
        "source_ids": source_ids,
        "created_at": created_at,
        "topics": topics,
        "lessons": [],
        "progress": compute_progress(topics),
    }


def list_courses() -> list[dict]:
    """Return every course (newest first) along with its current progress summary."""
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM courses ORDER BY created_at DESC").fetchall()
        result = []
        for row in rows:
            course = _course_row(row)
            topics = _fetch_topics(conn, course["id"])
            course["progress"] = compute_progress(topics)
            result.append(course)
        return result


def get_course(course_id: str) -> dict | None:
    """Return one course with its topics, lessons, and progress (or None if missing)."""
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM courses WHERE id = ?", (course_id,)).fetchone()
        if row is None:
            return None
        course = _course_row(row)
        topics = _fetch_topics(conn, course_id)
        lessons = _fetch_lessons(conn, course_id)
        return {
            **course,
            "topics": topics,
            "lessons": lessons,
            "progress": compute_progress(topics),
        }


def get_course_progress(course_id: str) -> dict | None:
    """Return only the progress summary for a course (or None if course does not exist)."""
    with get_conn() as conn:
        exists = conn.execute("SELECT 1 FROM courses WHERE id = ?", (course_id,)).fetchone()
        if exists is None:
            return None
        topics = _fetch_topics(conn, course_id)
        return compute_progress(topics)


# ---------------------------------------------------------------------------
# 5. Topics CRUD (teacher edits the syllabus)
# ---------------------------------------------------------------------------
def add_topic(
    course_id: str,
    title: str,
    summary: str,
    page_start: int,
    page_end: int,
    est_minutes: int,
    position: int | None = None,
) -> dict | None:
    """Insert a new topic into a course's syllabus at `position` (default: end)."""
    if page_end < page_start:
        raise ValueError("page_end must be greater than or equal to page_start.")

    with get_conn() as conn:
        exists = conn.execute("SELECT 1 FROM courses WHERE id = ?", (course_id,)).fetchone()
        if exists is None:
            return None

        existing = _fetch_topics(conn, course_id)
        topic_id = _new_id("top")
        insert_idx = len(existing) if position is None else max(0, min(position - 1, len(existing)))

        conn.execute(
            """
            INSERT INTO topics
                (id, course_id, position, title, summary, page_start, page_end, est_minutes, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'not_started')
            """,
            (topic_id, course_id, insert_idx + 1, title.strip(), summary.strip(), page_start, page_end, est_minutes),
        )

        # Keep positions strictly contiguous 1..N
        ordered_ids = [t["id"] for t in existing]
        ordered_ids.insert(insert_idx, topic_id)
        _renumber_topics(conn, course_id, ordered_ids)

        row = conn.execute("SELECT * FROM topics WHERE id = ?", (topic_id,)).fetchone()
        return _topic_row(row)


def update_topic(course_id: str, topic_id: str, updates: dict) -> dict | None:
    """Update one topic's fields and renumber positions if `position` changed."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM topics WHERE id = ? AND course_id = ?",
            (topic_id, course_id),
        ).fetchone()
        if row is None:
            return None

        current = _topic_row(row)
        new_start = updates.get("page_start", current["page_start"])
        new_end = updates.get("page_end", current["page_end"])
        if new_end < new_start:
            raise ValueError("page_end must be greater than or equal to page_start.")

        allowed = ("title", "summary", "page_start", "page_end", "est_minutes", "status")
        fields = {k: updates[k] for k in allowed if k in updates and updates[k] is not None}
        if "title" in fields:
            fields["title"] = fields["title"].strip()
        if "summary" in fields:
            fields["summary"] = fields["summary"].strip()

        if fields:
            assignments = ", ".join(f"{col} = ?" for col in fields)
            conn.execute(
                f"UPDATE topics SET {assignments} WHERE id = ? AND course_id = ?",
                (*fields.values(), topic_id, course_id),
            )

        if "position" in updates and updates["position"] is not None:
            existing = _fetch_topics(conn, course_id)
            ordered_ids = [t["id"] for t in existing if t["id"] != topic_id]
            target_idx = max(0, min(updates["position"] - 1, len(ordered_ids)))
            ordered_ids.insert(target_idx, topic_id)
            _renumber_topics(conn, course_id, ordered_ids)

        updated = conn.execute("SELECT * FROM topics WHERE id = ?", (topic_id,)).fetchone()
        return _topic_row(updated)


def delete_topic(course_id: str, topic_id: str) -> bool:
    """Delete a topic, clean its ID out of existing lessons, and renumber remaining topics."""
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM topics WHERE id = ? AND course_id = ?",
            (topic_id, course_id),
        )
        if cur.rowcount == 0:
            return False

        # Remove dangling references from any saved lessons in the same course
        for lesson in _fetch_lessons(conn, course_id):
            if topic_id in lesson["topic_ids"]:
                cleaned = [tid for tid in lesson["topic_ids"] if tid != topic_id]
                conn.execute(
                    "UPDATE lessons SET topic_ids = ? WHERE id = ?",
                    (json.dumps(cleaned), lesson["id"]),
                )

        remaining = _fetch_topics(conn, course_id)
        _renumber_topics(conn, course_id, [t["id"] for t in remaining])
        return True


# ---------------------------------------------------------------------------
# 6. Lessons CRUD + topic status synchronization
# ---------------------------------------------------------------------------
def save_lesson(
    course_id: str,
    title: str,
    duration_min: int,
    topic_ids: list[str],
    plan_dict: dict,
) -> dict:
    """Save a generated lesson as 'planned' and mark its covered topics 'planned'."""
    lesson_id = _new_id("les")
    created_at = _now_iso()

    with get_conn() as conn:
        max_seq = conn.execute(
            "SELECT COALESCE(MAX(seq), 0) FROM lessons WHERE course_id = ?",
            (course_id,),
        ).fetchone()[0]
        seq = max_seq + 1

        conn.execute(
            """
            INSERT INTO lessons
                (id, course_id, seq, title, duration_min, topic_ids, plan, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'planned', ?)
            """,
            (
                lesson_id,
                course_id,
                seq,
                title,
                duration_min,
                json.dumps(topic_ids),
                json.dumps(plan_dict),
                created_at,
            ),
        )

        # Mark every topic covered by this lesson as 'planned'
        for tid in topic_ids:
            conn.execute(
                "UPDATE topics SET status = 'planned' WHERE id = ? AND course_id = ?",
                (tid, course_id),
            )

        row = conn.execute("SELECT * FROM lessons WHERE id = ?", (lesson_id,)).fetchone()
        return _lesson_row(row)


def _sync_topics_from_lessons(conn: sqlite3.Connection, course_id: str, topic_ids: list[str]) -> None:
    """
    Recompute the status of each topic in `topic_ids` from the course's lessons:
      - 'taught'      if any 'taught' lesson includes this topic
      - 'planned'     else if any 'planned' lesson includes this topic
      - 'not_started' if no lesson includes this topic
    """
    lessons = _fetch_lessons(conn, course_id)
    for tid in topic_ids:
        statuses = {les["status"] for les in lessons if tid in les["topic_ids"]}
        if "taught" in statuses:
            new_status = "taught"
        elif "planned" in statuses:
            new_status = "planned"
        else:
            new_status = "not_started"
        conn.execute(
            "UPDATE topics SET status = ? WHERE id = ? AND course_id = ?",
            (new_status, tid, course_id),
        )


def update_lesson_status(course_id: str, lesson_id: str, status: str) -> dict | None:
    """
    Set a lesson to 'taught' (marking its topics 'taught') or revert it back
    to 'planned' (reverting its topics unless another taught lesson covers them).
    """
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM lessons WHERE id = ? AND course_id = ?",
            (lesson_id, course_id),
        ).fetchone()
        if row is None:
            return None

        lesson = _lesson_row(row)
        conn.execute(
            "UPDATE lessons SET status = ? WHERE id = ? AND course_id = ?",
            (status, lesson_id, course_id),
        )
        _sync_topics_from_lessons(conn, course_id, lesson["topic_ids"])

        updated_row = conn.execute("SELECT * FROM lessons WHERE id = ?", (lesson_id,)).fetchone()
        topics = _fetch_topics(conn, course_id)
        return {
            **_lesson_row(updated_row),
            "progress": compute_progress(topics),
        }


def delete_lesson(course_id: str, lesson_id: str) -> dict | None:
    """
    Delete a lesson and revert its topics to 'not_started' if no other lesson
    in the course references them.
    """
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM lessons WHERE id = ? AND course_id = ?",
            (lesson_id, course_id),
        ).fetchone()
        if row is None:
            return None

        lesson = _lesson_row(row)
        conn.execute("DELETE FROM lessons WHERE id = ? AND course_id = ?", (lesson_id, course_id))
        _sync_topics_from_lessons(conn, course_id, lesson["topic_ids"])

        topics = _fetch_topics(conn, course_id)
        return {
            "deleted": True,
            "lesson_id": lesson_id,
            "progress": compute_progress(topics),
        }

