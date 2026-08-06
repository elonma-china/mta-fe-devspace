"""Async PostgreSQL + MongoDB connections and schema initialization.

The data layer uses SQLAlchemy 2.0 async (``engine`` / ``AsyncSessionLocal`` /
``get_session``). The legacy asyncpg ``get_pool`` is retained for the schema
bootstrap and any not-yet-migrated callers.
"""

import logging
from collections.abc import AsyncIterator
from pathlib import Path

import asyncpg
from motor.motor_asyncio import AsyncIOMotorClient
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import settings

logger = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None
_mongo_client: AsyncIOMotorClient | None = None
_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None

_INIT_SQL_PATH = (
    Path(__file__).resolve().parent.parent.parent / "db" / "psql" / "init.sql"
)


def get_database_url() -> str:
    """Build the SQLAlchemy async (asyncpg driver) database URL from settings."""
    return (
        f"postgresql+asyncpg://{settings.db_user}:{settings.db_password}"
        f"@{settings.db_host}:{settings.db_port}/{settings.db_name}"
    )


def get_engine() -> AsyncEngine:
    """Return the singleton SQLAlchemy async engine, creating it on first call."""
    global _engine
    if _engine is None:
        _engine = create_async_engine(
            get_database_url(),
            pool_size=10,
            max_overflow=5,
            pool_pre_ping=True,
        )
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Return the singleton async session factory."""
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            bind=get_engine(),
            expire_on_commit=False,
            autoflush=False,
        )
    return _session_factory


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding a request-scoped :class:`AsyncSession`."""
    factory = get_session_factory()
    async with factory() as session:
        yield session


async def get_pool() -> asyncpg.Pool:
    """Return the singleton PostgreSQL connection pool, creating it on first call."""
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            host=settings.db_host,
            port=settings.db_port,
            user=settings.db_user,
            password=settings.db_password,
            database=settings.db_name,
            min_size=2,
            max_size=10,
        )
    return _pool


def get_mongo_client() -> AsyncIOMotorClient:
    """Return the singleton Motor client, creating it on first call."""
    global _mongo_client
    if _mongo_client is None:
        uri = (
            f"mongodb://{settings.mongo_user}:{settings.mongo_password}"
            f"@{settings.mongo_host}:{settings.mongo_port}"
            f"/{settings.mongo_db}?authSource=admin"
        )
        _mongo_client = AsyncIOMotorClient(uri)
    return _mongo_client


def get_mongo_db():
    """Return the application MongoDB database."""
    return get_mongo_client()[settings.mongo_db]


async def init_db() -> None:
    """Run schema init SQL and verify the MongoDB connection.

    Reference data (root unit, roles) and the super-admin account are seeded
    out of band by the one-shot ``db-seed`` service (``db/psql/seed.py``), not
    here, so seeding has a single source of truth.
    """
    pool = await get_pool()

    # Run init.sql if present
    if _INIT_SQL_PATH.is_file():
        init_sql = _INIT_SQL_PATH.read_text(encoding="utf-8")
        async with pool.acquire() as conn:
            await conn.execute(init_sql)
        logger.info("[db] Schema initialized from %s", _INIT_SQL_PATH.name)
    else:
        logger.warning(
            "[db] init.sql not found at %s — skipping schema init",
            _INIT_SQL_PATH,
        )

    # Verify MongoDB connection
    mongo_db = get_mongo_db()
    try:
        await mongo_db.command("ping")
        logger.info("[db] MongoDB connected: %s", settings.mongo_db)
    except Exception:
        logger.exception("[db] Failed to connect to MongoDB")
        raise


async def close_db() -> None:
    """Gracefully close the connection pools."""
    global _pool, _mongo_client, _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _session_factory = None
        logger.info("[db] SQLAlchemy engine disposed")
    if _pool is not None:
        await _pool.close()
        _pool = None
        logger.info("[db] PostgreSQL pool closed")
    if _mongo_client is not None:
        _mongo_client.close()
        _mongo_client = None
        logger.info("[db] MongoDB client closed")
