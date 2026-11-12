"""
Step 5 test script - verify the POST /chat SSE stream, session history, and
GET /sources/{id} without needing the frontend UI.

Usage (with the FastAPI server running in another terminal):
    python tests/chat_test.py
    python tests/chat_test.py "chain-of-thought prompting"
    python tests/chat_test.py "ReAct agents" "make it more hands-on" "add a quiz"
"""

import argparse
import json
import uuid

import httpx

DEFAULT_URL = "http://127.0.0.1:8000"
DEFAULT_MESSAGES = [
    "few-shot prompting",
    "make it more hands-on and add a quiz",
    "What does the paper say about how model scale affects few-shot performance?",
]


def send_chat_turn(
    base_url: str,
    session_id: str,
    message: str,
    level: str = "beginner",
    duration_min: int = 60,
    audience: str = "university students",
    sources: list[str] | None = None,
) -> list[dict]:
    """Send one message to POST /chat and print every SSE event as it arrives."""
    payload = {
        "session_id": session_id,
        "message": message,
        "settings": {
            "level": level,
            "duration_min": duration_min,
            "audience": audience,
            "objectives": [],
            "source_ids": sources,
        },
    }

    print(f"\n{'=' * 72}")
    print(f"USER ({session_id}): {message}")
    print(f"{'=' * 72}")

    first_source_id: list[dict] = []
    in_token_stream = False
    event_type = "message"

    with httpx.stream("POST", f"{base_url}/chat", json=payload, timeout=120.0) as response:
        response.raise_for_status()
        for line in response.iter_lines():
            if not line:
                continue
            if line.startswith("event:"):
                event_type = line.removeprefix("event:").strip()
                continue
            if not line.startswith("data:"):
                continue

            data = json.loads(line.removeprefix("data:").strip())

            # Close the inline token line before printing a non-token event
            if event_type != "token" and in_token_stream:
                print()
                in_token_stream = False

            if event_type == "status":
                print(f"[status]  {data['step']}")

            elif event_type == "sources":
                items = data.get("items", [])
                first_source_id = items
                print(f"[sources] {len(items)} passages:")
                for item in items[:3]:
                    print(f"          [{item['n']}] {item['title']} (p. {item['page']}, id={item['id']})")
                if len(items) > 3:
                    print(f"          ... and {len(items) - 3} more")

            elif event_type == "token":
                if not in_token_stream:
                    print("[token]   ", end="", flush=True)
                    in_token_stream = True
                print(data.get("text", ""), end="", flush=True)

            elif event_type == "plan":
                plan = data["data"]
                print(
                    f"[plan]    {plan['title']} | {plan['level']} | "
                    f"{plan['duration_min']} min | {len(plan['outline'])} outline items | "
                    f"{len(plan.get('citations', []))} citations"
                )
                for block in plan["outline"]:
                    print(f"          {block['start_min']:>3}-{block['end_min']:<3}m [{block['type']}] {block['title']}")

            elif event_type == "error":
                print(f"[error]   {data.get('message')}")

            elif event_type == "done":
                print("[done]    {}")

    return first_source_id


def main() -> None:
    parser = argparse.ArgumentParser(description="Test POST /chat SSE streaming and session endpoints.")
    parser.add_argument("messages", nargs="*", help="messages to send in sequence (default: 3-turn demo)")
    parser.add_argument("--session", default=f"test-{uuid.uuid4().hex[:6]}", help="session_id to use")
    parser.add_argument("--level", default="beginner")
    parser.add_argument("--duration", type=int, default=60)
    parser.add_argument("--audience", default="university students")
    parser.add_argument("--sources", help="comma-separated source_ids")
    parser.add_argument("--url", default=DEFAULT_URL, help="backend base URL")
    args = parser.parse_args()

    messages = args.messages or DEFAULT_MESSAGES
    source_ids = [s.strip() for s in args.sources.split(",")] if args.sources else None

    last_sources = []
    for msg in messages:
        last_sources = send_chat_turn(
            base_url=args.url,
            session_id=args.session,
            message=msg,
            level=args.level,
            duration_min=args.duration,
            audience=args.audience,
            sources=source_ids,
        )

    # Verify GET /sessions/{session_id}
    session_resp = httpx.get(f"{args.url}/sessions/{args.session}", timeout=10.0)
    session_resp.raise_for_status()
    session_data = session_resp.json()
    plan_title = session_data["plan"]["title"] if session_data["plan"] else None
    print(f"\n[GET /sessions/{args.session}] history={len(session_data['history'])} messages, current_plan={plan_title!r}")

    # Verify GET /sources/{id} using the first source returned by /chat
    if last_sources:
        sid = last_sources[0]["id"]
        src_resp = httpx.get(f"{args.url}/sources/{sid}", timeout=10.0)
        src_resp.raise_for_status()
        src_data = src_resp.json()
        print(f"[GET /sources/{sid}] title={src_data['title']!r}, chunks={len(src_data['chunks'])}")


if __name__ == "__main__":
    main()

