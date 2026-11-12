"""
Step 2 - Ingestion pipeline.

    source files  ->  load  ->  clean  ->  chunk  ->  embed  ->  store in Chroma

Supported formats: .pdf, .md, .txt (placed in data/sources/).

Each chunk is stored with this metadata:
    source_id   stable id derived from the file name (e.g. "module1")
    title       human-readable title of the document
    url         link to the original (empty string if unknown)
    page        page number in the PDF (always 1 for .md / .txt)
    topic       broad topic label, used later for filtering/display
    filename    original file name
    chunk_index position of the chunk inside its page

Optional extra metadata (title / url / topic) can be given per file in
data/sources/sources.json, for example:
    {
      "2201.11903v6.pdf": {
        "title": "Chain-of-Thought Prompting Elicits Reasoning in LLMs",
        "url": "https://arxiv.org/abs/2201.11903",
        "topic": "chain-of-thought"
      }
    }

CLI usage (run from the backend folder):
    python -m app.ingest            # ingest every file in data/sources
    python -m app.ingest --reset    # wipe the collection first, then ingest
    python -m app.ingest --file data/sources/notes.md   # a single file
"""

import argparse
import json
import re
import unicodedata
from pathlib import Path

from pypdf import PdfReader

from app.config import settings
from app.store import embed_texts, get_collection, get_embedder

# ---------------------------------------------------------------------------
# Settings for this step
# ---------------------------------------------------------------------------
SUPPORTED_EXTENSIONS = {".pdf", ".md", ".txt"}
CHUNK_TOKENS = 500      # target chunk size, measured in embedding-model tokens
CHUNK_OVERLAP = 50      # tokens shared between consecutive chunks
MIN_CHUNK_TOKENS = 10   # skip tiny fragments (e.g. a page with only "12")
MANIFEST_NAME = "sources.json"
DEFAULT_TOPIC = "general"


# ---------------------------------------------------------------------------
# 1. Loading
# ---------------------------------------------------------------------------
def load_pdf(path: Path) -> list[tuple[int, str]]:
    """Return a list of (page_number, text) pairs, page numbers start at 1."""
    reader = PdfReader(str(path))
    return [(i + 1, page.extract_text() or "") for i, page in enumerate(reader.pages)]


def load_text_file(path: Path) -> list[tuple[int, str]]:
    """Markdown / plain text files have no pages, so treat them as one page."""
    return [(1, path.read_text(encoding="utf-8", errors="ignore"))]


def load_document(path: Path) -> list[tuple[int, str]]:
    """Dispatch to the right loader based on the file extension."""
    if path.suffix.lower() == ".pdf":
        return load_pdf(path)
    return load_text_file(path)


# ---------------------------------------------------------------------------
# 2. Cleaning
# ---------------------------------------------------------------------------
def clean_text(text: str, is_pdf: bool = False) -> str:
    """Normalise raw extracted text so chunks are tidy and embeddings are better."""
    # Unicode normalisation: turns ligatures like "ﬁ" into "fi", fancy spaces into " "
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("\x00", "")

    # Re-join words hyphenated across line breaks: "exam-\nple" -> "example"
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)

    # Collapse runs of spaces/tabs and trim spaces around newlines
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)

    if is_pdf:
        # PDFs break lines in the middle of sentences. A single newline is
        # usually just a visual line break, so join it with a space; keep
        # blank lines (double newlines) as paragraph breaks.
        text = re.sub(r"(?<!\n)\n(?!\n)", " ", text)

    # At most one blank line between paragraphs
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# ---------------------------------------------------------------------------
# 3. Chunking
# ---------------------------------------------------------------------------
def chunk_text(text: str, chunk_tokens: int = CHUNK_TOKENS, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """
    Split text into windows of `chunk_tokens` tokens that overlap by `overlap`.

    We count tokens with the embedding model's own tokenizer, so a chunk never
    exceeds what the model can embed (bge-small / MiniLM accept 512 tokens).
    The tokenizer's "offset mapping" tells us where each token starts and ends
    in the original string, so we can slice the ORIGINAL text (keeping its
    capitalisation and punctuation) instead of decoding tokens back to text.
    """
    tokenizer = get_embedder().tokenizer
    encoding = tokenizer(
        text,
        add_special_tokens=False,
        return_offsets_mapping=True,
        verbose=False,  # silence the "sequence longer than 512" warning
    )
    offsets = encoding["offset_mapping"]  # list of (char_start, char_end) per token

    chunks = []
    step = chunk_tokens - overlap
    for start in range(0, len(offsets), step):
        end = min(start + chunk_tokens, len(offsets))
        if end - start >= MIN_CHUNK_TOKENS:
            char_start = offsets[start][0]
            char_end = offsets[end - 1][1]
            chunks.append(text[char_start:char_end].strip())
        if end == len(offsets):  # reached the end of the text
            break
    return chunks


# ---------------------------------------------------------------------------
# Helpers: ids, titles, manifest
# ---------------------------------------------------------------------------
def make_source_id(path: Path) -> str:
    """Stable, URL-safe id from the file name: 'Module_1 notes.pdf' -> 'module-1-notes'."""
    return re.sub(r"[^a-z0-9]+", "-", path.stem.lower()).strip("-")


def guess_title(path: Path, pages: list[tuple[int, str]]) -> str:
    """Use the first '# Heading' of a Markdown file, otherwise a tidied file name."""
    if path.suffix.lower() == ".md":
        for line in pages[0][1].splitlines():
            if line.startswith("# "):
                return line[2:].strip()
    return re.sub(r"[_\-]+", " ", path.stem).strip()


def load_manifest() -> dict:
    """Read data/sources/sources.json (optional per-file title/url/topic)."""
    manifest_path = settings.SOURCES_DIR / MANIFEST_NAME
    if manifest_path.exists():
        return json.loads(manifest_path.read_text(encoding="utf-8"))
    return {}


def save_manifest(manifest: dict) -> None:
    manifest_path = settings.SOURCES_DIR / MANIFEST_NAME
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


# ---------------------------------------------------------------------------
# 4 + 5. Embed and store one file
# ---------------------------------------------------------------------------
def ingest_file(path: Path, title: str | None = None, url: str | None = None,
                topic: str | None = None) -> dict:
    """
    Run the full pipeline for one file and return a short summary.

    Re-ingesting the same file first deletes its old chunks, so the
    collection never contains duplicates.
    """
    path = Path(path)
    if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {path.suffix}")

    # Metadata priority: explicit arguments > sources.json > automatic guess
    extra = load_manifest().get(path.name, {})
    pages = load_document(path)
    source_id = make_source_id(path)
    title = title or extra.get("title") or guess_title(path, pages)
    url = url or extra.get("url") or ""          # Chroma metadata cannot be None
    topic = topic or extra.get("topic") or DEFAULT_TOPIC

    # Build chunks page by page so every chunk knows its page number
    is_pdf = path.suffix.lower() == ".pdf"
    ids, documents, metadatas = [], [], []
    for page_number, raw_text in pages:
        for chunk_index, chunk in enumerate(chunk_text(clean_text(raw_text, is_pdf))):
            ids.append(f"{source_id}::p{page_number}::c{chunk_index}")
            documents.append(chunk)
            metadatas.append({
                "source_id": source_id,
                "title": title,
                "url": url,
                "page": page_number,
                "topic": topic,
                "filename": path.name,
                "chunk_index": chunk_index,
            })

    collection = get_collection()
    collection.delete(where={"source_id": source_id})  # remove old version, if any

    # Embed + store in batches (keeps memory use low for big PDFs)
    batch = 256
    for i in range(0, len(documents), batch):
        collection.add(
            ids=ids[i:i + batch],
            documents=documents[i:i + batch],
            metadatas=metadatas[i:i + batch],
            embeddings=embed_texts(documents[i:i + batch]),
        )

    summary = {
        "source_id": source_id,
        "title": title,
        "filename": path.name,
        "pages": len(pages),
        "chunks": len(documents),
    }
    if not documents:
        # Usually a scanned PDF (images only) - pypdf cannot extract text
        summary["warning"] = "No text extracted (scanned PDF?)"
    return summary


def ingest_directory(reset: bool = False) -> list[dict]:
    """Ingest every supported file in data/sources."""
    if reset:
        clear_collection()
    files = sorted(p for p in settings.SOURCES_DIR.iterdir()
                   if p.suffix.lower() in SUPPORTED_EXTENSIONS)
    results = []
    for path in files:
        print(f"-> Ingesting {path.name} ...", flush=True)
        results.append(ingest_file(path))
    return results


def clear_collection() -> None:
    """Delete every chunk from the collection."""
    collection = get_collection()
    all_ids = collection.get(include=[])["ids"]
    if all_ids:
        collection.delete(ids=all_ids)


# ---------------------------------------------------------------------------
# Used by the API
# ---------------------------------------------------------------------------
def save_upload_and_ingest(filename: str, content: bytes, title: str | None = None,
                           url: str | None = None, topic: str | None = None) -> dict:
    """Save an uploaded file into data/sources, remember its metadata, then ingest it."""
    safe_name = Path(filename).name  # drop any directory parts sent by the client
    if Path(safe_name).suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported file type. Allowed: {sorted(SUPPORTED_EXTENSIONS)}")

    settings.SOURCES_DIR.mkdir(parents=True, exist_ok=True)
    path = settings.SOURCES_DIR / safe_name
    path.write_bytes(content)

    # Store user-provided metadata in sources.json so a later CLI re-ingest keeps it
    provided = {k: v for k, v in {"title": title, "url": url, "topic": topic}.items() if v}
    if provided:
        manifest = load_manifest()
        manifest[safe_name] = {**manifest.get(safe_name, {}), **provided}
        save_manifest(manifest)

    return ingest_file(path, title=title, url=url, topic=topic)


def list_sources() -> list[dict]:
    """Group all stored chunks by source_id and count them (for GET /sources)."""
    metadatas = get_collection().get(include=["metadatas"])["metadatas"]
    sources: dict[str, dict] = {}
    for meta in metadatas:
        sid = meta["source_id"]
        if sid not in sources:
            sources[sid] = {
                "id": sid,
                "title": meta["title"],
                "url": meta["url"],
                "topic": meta["topic"],
                "filename": meta["filename"],
                "pages": 0,
                "chunk_count": 0,
            }
        sources[sid]["chunk_count"] += 1
        sources[sid]["pages"] = max(sources[sid]["pages"], meta["page"])
    return sorted(sources.values(), key=lambda s: s["title"].lower())


def get_source(source_id: str) -> dict | None:
    """Return one document's info and all of its chunks (for GET /sources/{id})."""
    result = get_collection().get(
        where={"source_id": source_id},
        include=["documents", "metadatas"],
    )
    if not result["ids"]:
        return None

    meta0 = result["metadatas"][0]
    chunks = [
        {
            "id": chunk_id,
            "page": meta["page"],
            "chunk_index": meta["chunk_index"],
            "text": text,
        }
        for chunk_id, text, meta in sorted(
            zip(result["ids"], result["documents"], result["metadatas"]),
            key=lambda item: (item[2]["page"], item[2]["chunk_index"]),
        )
    ]
    return {
        "id": source_id,
        "title": meta0["title"],
        "url": meta0["url"],
        "topic": meta0["topic"],
        "filename": meta0["filename"],
        "pages": max(m["page"] for m in result["metadatas"]),
        "chunk_count": len(chunks),
        "chunks": chunks,
    }



# ---------------------------------------------------------------------------
# CLI entry point:  python -m app.ingest
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest documents into Chroma.")
    parser.add_argument("--reset", action="store_true", help="delete all chunks before ingesting")
    parser.add_argument("--file", type=Path, help="ingest a single file instead of the whole folder")
    args = parser.parse_args()

    print(f"Embedding model : {settings.EMBEDDING_MODEL}")
    print(f"Sources folder  : {settings.SOURCES_DIR}")
    print(f"Chroma folder   : {settings.CHROMA_DIR}\n")

    if args.file:
        if args.reset:
            clear_collection()
        results = [ingest_file(args.file)]
    else:
        results = ingest_directory(reset=args.reset)

    print(f"\n{'source_id':<28} {'pages':>5} {'chunks':>6}  title")
    print("-" * 80)
    for r in results:
        line = f"{r['source_id']:<28} {r['pages']:>5} {r['chunks']:>6}  {r['title']}"
        print(line + (f"   [!] {r['warning']}" if "warning" in r else ""))
    print("-" * 80)
    print(f"Files: {len(results)}   Chunks added: {sum(r['chunks'] for r in results)}   "
          f"Total in collection: {get_collection().count()}")


if __name__ == "__main__":
    main()

