# =============================================================================
# Lessonwright Backend Dockerfile (FastAPI + ChromaDB + Sentence-Transformers)
# =============================================================================
FROM python:3.12-slim

# Prevent Python from writing .pyc files and buffering stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Create a non-root user and prepare directories for Hugging Face cache & data mounts
RUN useradd --create-home --uid 1000 appuser && \
    mkdir -p /app/.cache/huggingface /app/chroma_db /app/data/sources && \
    chown -R appuser:appuser /app

# Store pre-downloaded Hugging Face / Sentence-Transformers models in a known cache dir
ENV HF_HOME=/app/.cache/huggingface

# 1. Install dependencies first (cached unless requirements.txt changes).
#    Use the CPU-only PyTorch wheel index so the image stays compact instead of
#    pulling multi-gigabyte CUDA libraries.
COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt

# 2. Pre-download the sentence-transformers embedding model at build time so the
#    container never needs to contact Hugging Face Hub at runtime.
ARG EMBEDDING_MODEL=BAAI/bge-small-en-v1.5
ENV EMBEDDING_MODEL=${EMBEDDING_MODEL}
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('${EMBEDDING_MODEL}')" && \
    chown -R appuser:appuser /app/.cache/huggingface

# 3. Copy application code
COPY --chown=appuser:appuser app ./app

# Switch to non-root user before starting the server
USER appuser

EXPOSE 8000

# Liveness check against FastAPI GET /health
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

