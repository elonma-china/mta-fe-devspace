"""Repository factories.

High-level code obtains repositories through these factories (which return the
ABC type), never by importing the concrete implementations directly. FastAPI
dependencies wire the request-scoped :class:`AsyncSession` in for you.
"""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.repositories.base import (
    ConversationRepository,
    DocumentRepository,
    InfoTableRepository,
    UserRepository,
)
from app.repositories.postgres import (
    SqlAlchemyConversationRepository,
    SqlAlchemyDocumentRepository,
    SqlAlchemyInfoTableRepository,
    SqlAlchemyUserRepository,
)


def make_user_repository(session: AsyncSession) -> UserRepository:
    """Return a :class:`UserRepository` bound to ``session``."""
    return SqlAlchemyUserRepository(session)


def make_conversation_repository(
    session: AsyncSession,
) -> ConversationRepository:
    """Return a :class:`ConversationRepository` bound to ``session``."""
    return SqlAlchemyConversationRepository(session)


def make_document_repository(session: AsyncSession) -> DocumentRepository:
    """Return a :class:`DocumentRepository` bound to ``session``."""
    return SqlAlchemyDocumentRepository(session)


def make_info_table_repository(session: AsyncSession) -> InfoTableRepository:
    """Return an :class:`InfoTableRepository` bound to ``session``."""
    return SqlAlchemyInfoTableRepository(session)


# ── FastAPI dependencies ───────────────────────────────────────────────────


def get_user_repository(
    session: AsyncSession = Depends(get_session),
) -> UserRepository:
    """FastAPI dependency providing a request-scoped user repository."""
    return make_user_repository(session)


def get_conversation_repository(
    session: AsyncSession = Depends(get_session),
) -> ConversationRepository:
    """FastAPI dependency providing a request-scoped conversation repository."""
    return make_conversation_repository(session)


def get_document_repository(
    session: AsyncSession = Depends(get_session),
) -> DocumentRepository:
    """FastAPI dependency providing a request-scoped document repository."""
    return make_document_repository(session)


def get_info_table_repository(
    session: AsyncSession = Depends(get_session),
) -> InfoTableRepository:
    """FastAPI dependency providing a request-scoped info_table repository."""
    return make_info_table_repository(session)
