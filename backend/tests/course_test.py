"""
End-to-end test script for course and progress tracking.

Verifies:
  1. POST /courses creates a course and builds a valid syllabus from one source.
  2. POST /courses/{id}/lessons generates Lesson 1 (60 min) and marks its topics 'planned'.
  3. POST /courses/{id}/lessons generates Lesson 2 starting at the exact first topic
     Lesson 1 did not cover, with zero topic overlap between Lesson 1 and Lesson 2.
  4. PATCH /courses/{id}/lessons/{lesson1_id} {status: 'taught'} marks Lesson 1 and
     its topics 'taught' and updates progress percentages.
  5. POST /chat with course_id answers a progress question directly from SQLite
     progress data (no vector retrieval) and mentions the next topics.

Usage (with the FastAPI server running in another terminal, from the backend folder):
    python tests/course_test.py
    python tests/course_test.py --source 2210-03629v3
    python tests/course_test.py --url http://127.0.0.1:8000 --duration 60
"""

import argparse
import json
import sys
import uuid

import httpx

DEFAULT_URL = "http://127.0.0.1:8000"


def print_header(title: str) -> None:
    print(f"\n{'=' * 76}")
    print(title)
    print("=" * 76)


def print_syllabus(topics: list[dict]) -> None:
    print(f"{'#':<4}{'Pages':<10}{'Min':<5}{'Status':<13}Title")
    print("-" * 76)
    for t in topics:
        pages = f"p.{t['page_start']}-{t['page_end']}"
        print(f"{t['position']:<4}{pages:<10}{t['est_minutes']:<5}{t['status']:<13}{t['title']}")
        print(f"    Summary: {t['summary']}")


def print_progress(label: str, progress: dict) -> None:
    next_titles = [t["title"] for t in progress.get("next_topics", [])]
    print(f"\n[Progress — {label}]")
    print(
        f"  topics_total={progress['topics_total']} | "
        f"planned={progress['planned']} | taught={progress['taught']} | "
        f"percent_topics={progress['percent_topics']}% | "
        f"percent_pages={progress['percent_pages']}%"
    )
    print(f"  next_topics ({len(next_titles)}): {next_titles[:3]}")


def print_lesson(label: str, lesson: dict) -> None:
    plan = lesson["plan"]
    covered = [t["title"] for t in lesson["covered_topics"]]
    remaining = [t["title"] for t in lesson["remaining_topics"]]
    pages_used = sorted({c["page"] for c in plan.get("citations", [])})
    print(f"\n[{label}] seq={lesson['seq']} | id={lesson['id']} | status={lesson['status']}")
    print(f"  Title            : {plan['title']}")
    print(f"  Covered topics   : {covered}")
    print(f"  Remaining count  : {len(remaining)} (next: {remaining[0] if remaining else 'none'})")
    print(f"  Citation pages   : {pages_used}")
    print("  Outline:")
    for block in plan["outline"]:
        print(f"    {block['start_min']:>3}-{block['end_min']:<3} min  [{block['type']}] {block['title']}")


def pick_source(client: httpx.Client, requested_source: str | None) -> dict:
    resp = client.get("/sources")
    resp.raise_for_status()
    sources = resp.json()
    if not sources:
        raise RuntimeError("No ingested sources found. Run `python -m app.ingest` first.")

    if requested_source:
        match = next((s for s in sources if s["id"] == requested_source), None)
        if match is None:
            ids = [s["id"] for s in sources]
            raise RuntimeError(f"Source '{requested_source}' not found. Available: {ids}")
        return match

    # Default: pick the smallest multi-page source (>= 10 pages) for a fast, thorough test
    multi_page = [s for s in sources if s.get("pages", 0) >= 10]
    pool = multi_page or sources
    return min(pool, key=lambda s: s["chunk_count"])


def send_progress_chat(client: httpx.Client, course_id: str, message: str) -> dict:
    """Send a progress question to POST /chat with course_id and collect SSE events."""
    payload = {
        "session_id": f"course-test-{uuid.uuid4().hex[:6]}",
        "course_id": course_id,
        "message": message,
        "settings": {"level": "beginner", "duration_min": 60, "audience": "university students"},
    }
    result = {"sources": None, "text": "", "intent": None, "error": None}
    event_type = "message"
    with client.stream("POST", "/chat", json=payload, timeout=60.0) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines():
            if not line:
                continue
            if line.startswith("event:"):
                event_type = line.removeprefix("event:").strip()
            elif line.startswith("data:"):
                data = json.loads(line.removeprefix("data:").strip())
                if event_type == "sources":
                    result["sources"] = data.get("items", [])
                elif event_type == "token":
                    result["text"] += data.get("text", "")
                elif event_type == "error":
                    result["error"] = data.get("message")
                elif event_type == "done":
                    result["intent"] = data.get("intent")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="End-to-end test for course & progress tracking.")
    parser.add_argument("--url", default=DEFAULT_URL, help="FastAPI backend base URL")
    parser.add_argument("--source", help="specific source_id to build the course from")
    parser.add_argument("--duration", type=int, default=60, help="lesson duration in minutes (default: 60)")
    args = parser.parse_args()

    checks: list[tuple[str, bool, str]] = []

    def record(name: str, passed: bool, detail: str = "") -> None:
        checks.append((name, passed, detail))
        tag = "PASS" if passed else "FAIL"
        print(f"  [{tag}] {name}" + (f" — {detail}" if detail else ""))

    with httpx.Client(base_url=args.url, timeout=180.0) as client:
        # 1. Pick a source and create the course
        source = pick_source(client, args.source)
        print_header(f"STEP 1: Create course from source '{source['id']}' ({source['pages']} pages)")
        create_resp = client.post(
            "/courses",
            json={"title": f"Course: {source['title']}", "source_ids": [source["id"]]},
        )
        create_resp.raise_for_status()
        course = create_resp.json()
        course_id = course["id"]
        topics = course["topics"]

        print(f"Created course_id = {course_id} ({len(topics)} topics)")
        print_syllabus(topics)

        # Verify syllabus quality
        contiguous = all(
            topics[i + 1]["page_start"] == topics[i]["page_end"] + 1
            for i in range(len(topics) - 1)
        ) if source["pages"] >= len(topics) else True
        minutes_ok = all(5 <= t["est_minutes"] <= 40 for t in topics)

        prog0 = client.get(f"/courses/{course_id}/progress").json()
        print_progress("After course creation", prog0)

        # 2. Generate Lesson 1 (60 min)
        print_header(f"STEP 2: Generate Lesson 1 ({args.duration} min)")
        l1_resp = client.post(
            f"/courses/{course_id}/lessons",
            json={
                "duration_min": args.duration,
                "level": "beginner",
                "audience": "university students",
            },
        )
        l1_resp.raise_for_status()
        lesson1 = l1_resp.json()
        print_lesson("Lesson 1", lesson1)

        prog1 = client.get(f"/courses/{course_id}/progress").json()
        print_progress("After Lesson 1 generated", prog1)

        # 3. Generate Lesson 2 (60 min)
        print_header(f"STEP 3: Generate Lesson 2 ({args.duration} min)")
        l2_resp = client.post(
            f"/courses/{course_id}/lessons",
            json={
                "duration_min": args.duration,
                "level": "beginner",
                "audience": "university students",
            },
        )
        l2_resp.raise_for_status()
        lesson2 = l2_resp.json()
        print_lesson("Lesson 2", lesson2)

        prog2 = client.get(f"/courses/{course_id}/progress").json()
        print_progress("After Lesson 2 generated", prog2)

        # 4. Mark Lesson 1 as taught
        print_header("STEP 4: Mark Lesson 1 as 'taught'")
        patch_resp = client.patch(
            f"/courses/{course_id}/lessons/{lesson1['id']}",
            json={"status": "taught"},
        )
        patch_resp.raise_for_status()
        prog3 = client.get(f"/courses/{course_id}/progress").json()
        print_progress("After Lesson 1 marked taught", prog3)

        # 5. Ask /chat about course progress
        print_header("STEP 5: Ask /chat about course progress (with course_id)")
        chat_res = send_progress_chat(client, course_id, "How much is covered, what is pending, and what is next?")
        print(chat_res["text"])

        # 6. Run assertions
        print_header("VERIFICATION CHECKS")
        l1_ids = lesson1["topic_ids"]
        l2_ids = lesson2["topic_ids"]
        l1_remaining = lesson1["remaining_topics"]

        record(
            "Syllabus has topics with valid est_minutes (5-40) and contiguous non-overlapping pages",
            len(topics) >= 2 and contiguous and minutes_ok,
            f"count={len(topics)}, contiguous={contiguous}, minutes_ok={minutes_ok}",
        )
        record(
            "Lesson 2 starts at the exact first topic Lesson 1 did not cover",
            bool(l1_remaining) and l2_ids[0] == l1_remaining[0]["id"],
            f"expected={l1_remaining[0]['title'] if l1_remaining else None!r}, "
            f"actual={lesson2['covered_topics'][0]['title']!r}",
        )
        record(
            "No topic appears in both Lesson 1 and Lesson 2",
            set(l1_ids).isdisjoint(set(l2_ids)),
            f"l1={len(l1_ids)} topics, l2={len(l2_ids)} topics, overlap={set(l1_ids) & set(l2_ids)}",
        )
        record(
            "LessonPlan includes covered_topics and not_covered_yet",
            len(lesson1["plan"].get("covered_topics", [])) == len(l1_ids)
            and len(lesson2["plan"].get("covered_topics", [])) == len(l2_ids)
            and "not_covered_yet" in lesson1["plan"],
            f"l1 covered={len(lesson1['plan'].get('covered_topics', []))}, "
            f"l2 covered={len(lesson2['plan'].get('covered_topics', []))}",
        )
        record(
            "Lesson 1 and Lesson 2 citations stay within their selected topics' page ranges",
            all(
                any(t["page_start"] <= c["page"] <= t["page_end"] for t in lesson1["covered_topics"])
                for c in lesson1["plan"].get("citations", [])
            ) and all(
                any(t["page_start"] <= c["page"] <= t["page_end"] for t in lesson2["covered_topics"])
                for c in lesson2["plan"].get("citations", [])
            ),
        )
        record(
            "Progress reflects Lesson 1 taught and Lesson 2 planned",
            prog3["taught"] == len(l1_ids)
            and prog3["planned"] == len(l2_ids)
            and prog3["percent_topics"] > 0
            and prog3["percent_pages"] > 0,
            f"taught={prog3['taught']}, planned={prog3['planned']}, "
            f"topics={prog3['percent_topics']}%, pages={prog3['percent_pages']}%",
        )
        expected_next_title = prog3["next_topics"][0]["title"] if prog3["next_topics"] else ""
        record(
            "/chat answers progress from SQLite (no retrieval) and mentions next topic",
            chat_res["error"] is None
            and chat_res["sources"] == []
            and (not expected_next_title or expected_next_title in chat_res["text"]),
            f"sources={len(chat_res['sources'] or [])}, mentions_next={expected_next_title in chat_res['text']}",
        )

    failed = [c for c in checks if not c[1]]
    print(f"\nRESULT: {'PASS' if not failed else f'FAIL ({len(failed)} failed)'}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()

