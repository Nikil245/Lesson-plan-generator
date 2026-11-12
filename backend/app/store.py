"""
Shared access to the embedding model and the Chroma vector store.

Both objects are expensive to create (the model is loaded into memory, the
database opens files on disk), so we create each one only once and reuse it.
`functools.lru_cache` on a zero-argument function is a simple way to do that.

Used by ingestion now, and by retrieval in step 3.
"""

from functools import lru_cache

import chromadb
from chromadb.config import Settings as ChromaSettings
from sentence_transformers import SentenceTransformer

from app.config import settings

# Name of the Chroma collection that holds all document chunks
COLLECTION_NAME = "lessonwright_chunks"


@lru_cache
def get_embedder() -> SentenceTransformer:
    """Load the sentence-transformers model named in .env (downloaded on first use)."""
    return SentenceTransformer(settings.EMBEDDING_MODEL)


@lru_cache
def get_collection():
    """Open (or create) the persistent Chroma collection on disk."""
    client = chromadb.PersistentClient(
        path=str(settings.CHROMA_DIR),
        settings=ChromaSettings(anonymized_telemetry=False),
    )
    # "cosine" distance: we store normalised embeddings, so
    # similarity = 1 - distance, which is easy to explain and to display.
    return client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Turn a list of strings into a list of embedding vectors."""
    vectors = get_embedder().encode(
        texts,
        batch_size=32,
        normalize_embeddings=True,  # unit-length vectors -> cosine similarity
        show_progress_bar=False,
    )
    return vectors.tolist()


# BGE models were trained with this instruction in front of short search
# queries (documents are embedded WITHOUT it). Adding it improves retrieval.
BGE_QUERY_INSTRUCTION = "Represent this sentence for searching relevant passages: "


def embed_query(query: str) -> list[float]:
    """Embed a single search query (adds the BGE instruction when relevant)."""
    if "bge" in settings.EMBEDDING_MODEL.lower():
        query = BGE_QUERY_INSTRUCTION + query
    return embed_texts([query])[0]

