# Docker Guide — Lessonwright

This guide explains how to build, run, index sources, and troubleshoot the containerized **Lessonwright** stack (`backend` + `frontend`).

---

## Architecture Overview

- **`backend` (`python:3.12-slim`)**: Runs FastAPI with Uvicorn on port `8000` as a non-root user (`appuser`). Installs CPU-only PyTorch wheels and pre-downloads the `BAAI/bge-small-en-v1.5` embedding model into `/app/.cache/huggingface` (`HF_HOME`) at build time so no runtime downloads from Hugging Face Hub are needed.
- **`frontend` (`node:20-alpine` → `nginx:alpine`)**: Builds the static React + Vite + TypeScript bundle with `VITE_API_BASE=/api` and serves `/dist` via Nginx on host port `5173` (mapped to container port `80`). Nginx proxies `/api/*` requests to `http://backend:8000/*` with proxy buffering disabled so `POST /chat` Server-Sent Events (SSE) stream in real time.
- **Persistence**:
  - `chroma_db` named Docker volume mounted at `/app/chroma_db` so the Chroma vector index survives container restarts and image rebuilds.
  - `./backend/data/sources` bind-mounted at `/app/data/sources` so you can drop new `.pdf`, `.md`, or `.txt` files into `backend/data/sources` on your host machine without rebuilding the image.

---

## 1. First Run

1. **Create `backend/.env` from the example template and add your real Groq API key**:
   ```bash
   cp backend/.env.example backend/.env
   ```
   Open `backend/.env` and set `GROQ_API_KEY=gsk_...` with your key from [console.groq.com/keys](https://console.groq.com/keys).

2. **Build and start the containers**:
   ```bash
   docker compose up --build
   ```
   *(To run in the background, pass `-d`: `docker compose up --build -d`)*

---

## 2. Indexing the Sources Inside the Container

Once the containers are running, index (or re-index) all documents in `backend/data/sources` into the persistent ChromaDB volume:

```bash
docker compose exec backend python -m app.ingest --reset
```

To ingest without wiping existing chunks (for example, after adding a new PDF to `backend/data/sources/`):

```bash
docker compose exec backend python -m app.ingest
```

You can also upload files directly from the web UI using the **+ Add sources** button in the left panel.

---

## 3. Where to Open the App & API Docs

- **Lessonwright Web Studio (Frontend)**: [http://localhost:5173](http://localhost:5173)
- **FastAPI Interactive Swagger Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **Backend Health Check**: [http://localhost:8000/health](http://localhost:8000/health)

---

## 4. Viewing Logs, Stopping, and Wiping Volumes

- **Follow logs for both services**:
  ```bash
  docker compose logs -f
  ```
- **Follow logs for the backend only**:
  ```bash
  docker compose logs -f backend
  ```
- **Stop containers (keeps the ChromaDB index volume intact)**:
  ```bash
  docker compose down
  ```
- **Stop containers AND wipe the `chroma_db` named volume**:
  ```bash
  docker compose down -v
  ```

---

## 5. Optional: Development Mode with Hot Reload

To run Uvicorn with `--reload` and the Vite dev server with live source mounts:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

---

## 6. Common Problems & Fixes

### 1. Port Already in Use (`5173` or `8000`)
- **Symptom**: `Bind for 0.0.0.0:5173 failed: port is already allocated` or `address already in use`.
- **Fix**: Stop any local `npm run dev` or `uvicorn` processes occupying ports `5173` or `8000`, or override the published host ports via `.env`:
  ```bash
  cp .env.example .env
  # Edit FRONTEND_PORT or BACKEND_PORT in .env, then run:
  docker compose up
  ```

### 2. `GROQ_API_KEY` Missing or Invalid
- **Symptom**: Chat requests return an error (`GROQ_API_KEY is not set in backend/.env` or `401 Unauthorized`), or `GET http://localhost:8000/health` shows `"groq_configured": false`.
- **Fix**: Ensure `backend/.env` exists and has a valid `GROQ_API_KEY` (no quotes or trailing spaces needed), then restart the backend container:
  ```bash
  docker compose up -d backend
  ```

### 3. Embedding Model Download Failing During Build
- **Symptom**: `docker compose build backend` fails on the `SentenceTransformer('BAAI/bge-small-en-v1.5')` step due to a transient network/DNS timeout reaching Hugging Face Hub.
- **Fix**: Check your internet connection or corporate proxy/DNS settings and re-run `docker compose build backend`. Once that layer builds once, Docker caches the model inside the image (`/app/.cache/huggingface`) and never downloads it at runtime.

### 4. Server-Sent Events (SSE) Arriving All at Once at the End
- **Symptom**: In `POST /chat`, status updates (`Searching sources` → `Reading N passages` → `Drafting plan`) and assistant tokens do not stream progressively, appearing only after the entire turn finishes.
- **Cause & Fix**: Reverse proxies buffer upstream responses by default. Verify that `frontend/nginx.conf` is mounted in the `frontend` image and includes:
  - `proxy_buffering off;`
  - `proxy_cache off;`
  - `proxy_http_version 1.1;`
  - `proxy_set_header Connection "";`
  - `proxy_read_timeout 300s;`

