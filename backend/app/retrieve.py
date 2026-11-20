"""
Step 3 - Retrieval.

    query text  ->  embed  ->  nearest-neighbour search in Chroma  ->  top-k chunks

The same embedding model that indexed the documents (step 2) embeds the
query, so query and chunks live in the same vector space and can be compared.

CLI usage (run from the backend folder):
    python -m app.retrieve "few-shot prompting"
    python -m app.retrieve "chain of thought" --k 3 --sources 2201-11903v6,module1
"""

import argparse

from app.store import embed_query, get_collection

DEFAULT_K = 6


def _merge_page_ranges(page_ranges: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Collapse overlapping or adjacent (start, end) ranges to simplify Chroma's filter."""
    cleaned = sorted((min(s, e), max(s, e)) for s, e in page_ranges)
    merged: list[tuple[int, int]] = []
    for start, end in cleaned:
        if merged and start <= merged[-1][1] + 1:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _build_where_filter(
    source_ids: list[str] | None,
    page_ranges: list[tuple[int, int]] | None,
) -> dict | None:
    """
    Build a Chroma `where` filter for optional source_ids and page_ranges.
    When page_ranges is None, returns the exact same filter as before.
    """
    clauses: list[dict] = []
    if source_ids:
        clauses.append({"source_id": {"$in": source_ids}})

    if page_ranges:
        merged = _merge_page_ranges(page_ranges)
        range_clauses = [
            {"page": start} if start == end
            else {"$and": [{"page": {"$gte": start}}, {"page": {"$lte": end}}]}
            for start, end in merged
        ]
        clauses.append(range_clauses[0] if len(range_clauses) == 1 else {"$or": range_clauses})

    if not clauses:
        return None
    return clauses[0] if len(clauses) == 1 else {"$and": clauses}


def retrieve(
    query: str,
    k: int = DEFAULT_K,
    source_ids: list[str] | None = None,
    page_ranges: list[tuple[int, int]] | None = None,
) -> list[dict]:
    """
    Return the `k` chunks most similar to `query`, best first.

    Args:
        query:       the user's question or topic.
        k:           how many chunks to return.
        source_ids:  optional list of source ids; if given, only chunks from
                     these documents are searched.
        page_ranges: optional list of inclusive (page_start, page_end) tuples;
                     if given, only chunks inside those pages are searched.

    Each result is a dict with: text, score, source_id, title, url, page,
    chunk_index. `score` is cosine similarity in [0, 1] (higher = more similar).
    """
    collection = get_collection()
    total = collection.count()
    if total == 0 or not query.strip():
        return []  # nothing ingested yet, or empty query

    where = _build_where_filter(source_ids, page_ranges)

    # When restricting to narrow page ranges, clamp n_results to the number of
    # matching chunks so Chroma never raises an error for asking more than exist.
    n_results = min(k, total)
    if page_ranges:
        matching = len(collection.get(where=where, include=[])["ids"])
        if matching == 0:
            return []
        n_results = min(k, matching)

    results = collection.query(
        query_embeddings=[embed_query(query)],
        n_results=n_results,
        where=where,
        include=["documents", "metadatas", "distances"],
    )

    # Chroma returns one list per query; we sent a single query, so take [0]
    chunks = []
    for text, meta, distance in zip(
        results["documents"][0], results["metadatas"][0], results["distances"][0]
    ):
        # The collection uses cosine distance (= 1 - cosine similarity).
        # Convert back to similarity and clamp into [0, 1] for display.
        score = max(0.0, min(1.0, 1.0 - distance))
        chunks.append({
            "text": text,
            "score": round(score, 4),
            "source_id": meta["source_id"],
            "title": meta["title"],
            "url": meta["url"],
            "page": meta["page"],
            "chunk_index": meta["chunk_index"],
        })
    return chunks


# ---------------------------------------------------------------------------
# CLI entry point:  python -m app.retrieve "your query"
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser(description="Search the ingested documents.")
    parser.add_argument("query", help="text to search for")
    parser.add_argument("--k", type=int, default=DEFAULT_K, help="number of chunks to return")
    parser.add_argument("--sources", help="comma-separated source ids to search in")
    args = parser.parse_args()

    source_ids = [s.strip() for s in args.sources.split(",")] if args.sources else None
    chunks = retrieve(args.query, k=args.k, source_ids=source_ids)

    print(f'\nQuery: "{args.query}"   (k={args.k}, sources={source_ids or "all"})\n')
    if not chunks:
        print("No results. Have you run `python -m app.ingest`? Are the source ids correct?")
    for rank, c in enumerate(chunks, start=1):
        preview = c["text"][:200].replace("\n", " ")
        print(f"[{rank}] score={c['score']:.3f} | {c['title']} | page {c['page']} | {c['source_id']}")
        print(f"    {preview}...\n")


if __name__ == "__main__":
    main()

