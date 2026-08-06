"""FastAPI application entrypoint."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.db import close_db, init_db
from app.middlewares.logging import RequestLoggingMiddleware
from app.routes import (
    auth,
    audit,
    conversation,
    document,
    info_table,
    llm,
    user,
    voice,
)
from app.services import status_listener

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown hooks."""
    # Startup
    try:
        await init_db()
        logger.info("[db] Database initialized")
    except Exception:
        logger.exception("[db] Critical Error: Failed to initialize database")
        raise

    # Bug 1: subscribe to the ingest service's status push so a document's
    # terminal status is persisted even when no browser is watching. Best effort
    # — a Redis outage must not stop the gateway from serving; `/status` (the
    # pull path) still works either way.
    status_listener.start(app)

    yield

    # Shutdown
    await status_listener.stop(app)
    await close_db()


app = FastAPI(
    title="IntraMind Backend",
    version="1.0.0",
    lifespan=lifespan,
)

# ── CORS ────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# ── Request logging ─────────────────────────────────────────────────
app.add_middleware(RequestLoggingMiddleware)


# ── Global error handler ────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    if isinstance(exc, HTTPException):
        raise exc
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error"},
    )


# ── Health check ────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"ok": True}


# ── Mount routes ────────────────────────────────────────────────────
app.include_router(auth.router)
app.include_router(user.router)
app.include_router(conversation.router)
app.include_router(document.router)
app.include_router(info_table.router)
app.include_router(audit.router)
app.include_router(llm.router)
app.include_router(voice.router)
