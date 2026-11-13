"""
Step 5 test script - verify intent routing in POST /chat (answer / refine / new_plan),
the SSE stream, session history, and GET /sources/{id} without the frontend.

Usage (with the FastAPI server running in another terminal, from the backend folder):
    python tests/chat_test.py                 # default 5-turn intent sequence
    python tests/chat_test.py --sources nlp   # restrict to some source_ids
    python tests/chat_test.py "what is NLP" "plan a 30 minute lesson on NLP"   # custom messages (no expectations)

For each turn it prints the intent reported in the `done` event, whether a
`plan` event arrived, and (for the default sequence) PASS/FAIL against the
expected behaviour. Exit code is 1 if any default-sequence check fails.
"""

import argparse
import json
import sys
import uuid

import httpx

DEFAULT_URL = "http://127.0.0.1:8000"

# (message, expected intent, expect a plan event?)
DEFAULT_SEQUENCE = [
    ("plan a 45 minute lesson on few-shot prompting", "new_plan", True),
    ("make it more hands-on", "refine", True),
    ("what is chain of thought", "answer", False),
    ("can you answer this question: explain zero-shot vs few-shot for 5 marks", "answer", False),
    ("add a quiz", "refine", True),
]


def send_chat_turn(
    base_url: str,
    session_id: str,
    message: str,
    level: str = "beginner",
    duration_min: int = 45,
    audience: str = "university students",
    sources: list[str] | None = None,
) -> dict:
    """Send one message to POST /chat, print every SSE event, and return a summary."""
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

    result = {"intent": None, "plan": False, "plan_title": None, "error": None,
              "tokens": 0, "sources": [], "statuses": []}
    in_token_stream = False
    event_type = "message"

    with httpx.stream("POST", f"{base_url}/chat", json=payload, timeout=180.0) as response:
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
                result["statuses"].append(data["step"])
                print(f"[status]  {data['step']}")

            elif event_type == "sources":
                items = data.get("items", [])
                result["sources"] = items
                print(f"[sources] {len(items)} passages:")
                for item in items[:3]:
                    print(f"          [{item['n']}] {item['title']} (p. {item['page']}, id={item['id']})")
                if len(items) > 3:
                    print(f"          ... and {len(items) - 3} more")

            elif event_type == "token":
                if not in_token_stream:
                    print("[token]   ", end="", flush=True)
                    in_token_stream = True
                result["tokens"] += 1
                print(data.get("text", ""), end="", flush=True)

            elif event_type == "plan":
                plan = data["data"]
                result["plan"] = True
                result["plan_title"] = plan["title"]
                print(
                    f"[plan]    {plan['title']} | {plan['level']} | "
                    f"{plan['duration_min']} min | {len(plan['outline'])} outline items | "
                    f"{len(plan.get('citations', []))} citations"
                )
                for block in plan["outline"]:
                    print(f"          {block['start_min']:>3}-{block['end_min']:<3}m [{block['type']}] {block['title']}")

            elif event_type == "error":
                result["error"] = data.get("message")
                print(f"[error]   {data.get('message')}")

            elif event_type == "done":
                result["intent"] = data.get("intent")
                print(f"[done]    {json.dumps(data)}")

    if in_token_stream:
        print()
    print(f"--> intent={result['intent']}  plan_event={'yes' if result['plan'] else 'no'}")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Test POST /chat intent routing and SSE streaming.")
    parser.add_argument("messages", nargs="*", help="custom messages to send in sequence (default: 5-turn intent test)")
    parser.add_argument("--session", default=f"test-{uuid.uuid4().hex[:6]}", help="session_id to use")
    parser.add_argument("--level", default="beginner")
    parser.add_argument("--duration", type=int, default=45)
    parser.add_argument("--audience", default="university students")
    parser.add_argument("--sources", help="comma-separated source_ids")
    parser.add_argument("--url", default=DEFAULT_URL, help="backend base URL")
    args = parser.parse_args()

    source_ids = [s.strip() for s in args.sources.split(",")] if args.sources else None
    sequence = [(m, None, None) for m in args.messages] if args.messages else DEFAULT_SEQUENCE

    rows = []
    last_sources: list[dict] = []
    for message, expected_intent, expect_plan in sequence:
        result = send_chat_turn(
            base_url=args.url,
            session_id=args.session,
            message=message,
            level=args.level,
            duration_min=args.duration,
            audience=args.audience,
            sources=source_ids,
        )
        if result["sources"]:
            last_sources = result["sources"]

        checks = []
        if expected_intent is not None:
            checks.append(result["intent"] == expected_intent)
            checks.append(result["plan"] == expect_plan)
            checks.append(result["error"] is None and result["tokens"] > 0)
            if expected_intent == "answer":
                checks.append("Drafting plan" not in result["statuses"])
        status = "-" if not checks else ("PASS" if all(checks) else "FAIL")
        rows.append((message, expected_intent, expect_plan, result, status))

    # Summary table
    print(f"\n{'=' * 72}\nSUMMARY (session {args.session})\n{'=' * 72}")
    print(f"{'#':<3}{'intent':<10}{'expected':<10}{'plan':<6}{'exp':<6}{'result':<7}message")
    for i, (message, exp_intent, exp_plan, result, status) in enumerate(rows, start=1):
        exp_plan_txt = "-" if exp_plan is None else ("yes" if exp_plan else "no")
        print(
            f"{i:<3}{str(result['intent']):<10}{str(exp_intent or '-'):<10}"
            f"{'yes' if result['plan'] else 'no':<6}{exp_plan_txt:<6}{status:<7}{message[:60]}"
        )
        if result["error"]:
            print(f"     error: {result['error']}")

    # Verify GET /sessions/{session_id}: the plan must be the one from the last plan turn
    session_resp = httpx.get(f"{args.url}/sessions/{args.session}", timeout=10.0)
    session_resp.raise_for_status()
    session_data = session_resp.json()
    plan_title = session_data["plan"]["title"] if session_data["plan"] else None
    print(f"\n[GET /sessions/{args.session}] history={len(session_data['history'])} messages, current_plan={plan_title!r}")

    # Verify GET /sources/{id} using the last source list returned by /chat
    if last_sources:
        sid = last_sources[0]["id"]
        src_resp = httpx.get(f"{args.url}/sources/{sid}", timeout=10.0)
        src_resp.raise_for_status()
        src_data = src_resp.json()
        print(f"[GET /sources/{sid}] title={src_data['title']!r}, chunks={len(src_data['chunks'])}")

    if any(status == "FAIL" for *_, status in rows):
        print("\nRESULT: FAIL")
        sys.exit(1)
    if not args.messages:
        print("\nRESULT: PASS")


if __name__ == "__main__":
    main()
