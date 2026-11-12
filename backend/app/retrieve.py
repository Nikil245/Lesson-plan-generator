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


def retrieve(query: str, k: int = DEFAULT_K, source_ids: list[str] | None = None) -> list[dict]:
    """
    Return the `k` chunks most similar to `query`, best first.

    Args:
        query:      the user's question or topic.
        k:          how many chunks to return.
        source_ids: optional list of source ids; if given, only chunks from
                    these documents are searched.

    Each result is a dict with: text, score, source_id, title, url, page,
    chunk_index. `score` is cosine similarity in [0, 1] (higher = more similar).
    """
    collection = get_collection()
    total = collection.count()
    if total == 0 or not query.strip():
        return []  # nothing ingested yet, or empty query

    # Optional metadata filter: "source_id must be one of these values"
    where = {"source_id": {"$in": source_ids}} if source_ids else None

    results = collection.query(
        query_embeddings=[embed_query(query)],
        n_results=min(k, total),  # cannot ask for more chunks than exist
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

