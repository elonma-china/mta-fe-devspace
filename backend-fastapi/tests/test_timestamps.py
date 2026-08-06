"""Regression tests for naive-UTC timestamp writes.

The ``conversation``/``info_table`` timestamp columns are
``TIMESTAMP WITHOUT TIME ZONE``.  Writing a timezone-aware datetime to them
makes asyncpg raise ``can't subtract offset-naive and offset-aware
datetimes``.  Writes must therefore produce tz-naive UTC values.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.models.access import Principal
from app.repositories.postgres import SqlAlchemyConversationRepository
from app.utils.helpers import utcnow


def test_utcnow_returns_naive_datetime() -> None:
    """utcnow() must return a tz-naive datetime (no tzinfo)."""
    now = utcnow()
    assert now.tzinfo is None


@pytest.mark.asyncio
async def test_update_field_assigns_naive_timestamps() -> None:
    """update_field must store tz-naive last_synced_at and date_updated."""
    session = AsyncMock()
    repo = SqlAlchemyConversationRepository(session)
    conv = SimpleNamespace(last_synced_at=None, date_updated=None)
    principal = Principal(id=1, unit_id=None, is_admin=True)

    with patch.object(
        repo, "_get_if_visible", AsyncMock(return_value=conv)
    ):
        result = await repo.update_field(
            principal, 1, "last_synced_at", utcnow()
        )

    assert result == {"changes": 1}
    assert conv.last_synced_at.tzinfo is None
    assert conv.date_updated.tzinfo is None
