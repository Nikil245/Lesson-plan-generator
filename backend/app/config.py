"""
Central configuration.

All settings are read from environment variables (loaded from the .env file
in the backend folder). Keeping them in one place means every other module
just does `from app.config import settings`.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

# Folder that contains this backend (…/backend)
BASE_DIR = Path(__file__).resolve().parent.parent

# Load variables from backend/.env into the process environment
load_dotenv(BASE_DIR / ".env")


class Settings:
    """Simple container for configuration values."""

    # LLM (Groq)
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    GROQ_MODEL: str = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")

    # Embeddings
    EMBEDDING_MODEL: str = os.getenv("EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")

    # Storage paths (relative paths are resolved against the backend folder)
    CHROMA_DIR: Path = BASE_DIR / os.getenv("CHROMA_DIR", "chroma_db")
    SOURCES_DIR: Path = BASE_DIR / os.getenv("SOURCES_DIR", "data/sources")

    # CORS
    FRONTEND_ORIGIN: str = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")


settings = Settings()

