"""The uploader's identity has to reach the ingestion service, or dedup is off.

`mta-be-intramind` scopes both dedup tiers to an owner on purpose: tier-0 keys on
`(content_hash, user_id)` and tier-1 on `(text_hash, user_id)`, and both return
"no match" when there is no `user_id` — anonymous uploads are never deduplicated
against anyone. It reads that owner from the query string
(`api/tracing/middleware.py`: `request.query_params.get("user_id")`).

The gateway posted the file with no query string at all. Every upload therefore
arrived anonymous, and since the UI is the only way real users upload anything,
both dedup tiers were dead in production while looking fully implemented on both
sides — re-uploading the identical file always re-parsed, re-embedded and
re-indexed it.

The owner is the authenticated principal, never the `{user_id}` in the path: the
caller chooses the path.

No upstream is contacted here; the transport is a recorder.
"""

from __future__ import annotations

import httpx
import pytest

from app.routes import document as document_routes


class _RecordingClient:
    """Stands in for `httpx.AsyncClient`, capturing the one POST that matters."""

    calls: list[dict] = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, **kwargs):
        _RecordingClient.calls.append({"url": url, **kwargs})
        return httpx.Response(
            200,
            json={"document_id": "doc-1"},
            request=httpx.Request("POST", url),
        )


@pytest.fixture
def recorded(monkeypatch):
    _RecordingClient.calls = []
    monkeypatch.setattr(document_routes.httpx, "AsyncClient", _RecordingClient)
    return _RecordingClient.calls


@pytest.mark.asyncio
async def test_the_upload_carries_the_owner_id(recorded):
    await document_routes._create_remote_document(
        b"file bytes", "quy-che.pdf", "application/pdf", owner_id=42
    )

    assert recorded, "no upstream call was made"
    assert recorded[0].get("params", {}).get("user_id") == "42", (
        "the ingestion service reads the owner from the query string; without it "
        "both dedup tiers return no match for every upload"
    )


@pytest.mark.asyncio
async def test_the_upload_carries_the_conversation_id(recorded):
    """Dedup is scoped to `(content_hash, user_id, conversation_id)`. BE reads the
    conversation from the same query string as the owner. Sending only the owner
    let an upload match a document belonging to a different conversation, and the
    id that came back could not be stored against this one."""
    await document_routes._create_remote_document(
        b"file bytes", "quy-che.pdf", "application/pdf", owner_id=42,
        conversation_id=73,
    )

    assert recorded[0].get("params", {}).get("conversation_id") == "73"


@pytest.mark.asyncio
async def test_the_owner_is_sent_as_a_string(recorded):
    """BE stores whatever arrives straight into `metadata.user_id` and later
    compares it for equality, so the type has to be stable across uploads."""
    await document_routes._create_remote_document(
        b"x", "a.pdf", "application/pdf", owner_id=7
    )

    assert isinstance(recorded[0]["params"]["user_id"], str)


@pytest.mark.asyncio
async def test_the_file_is_still_sent(recorded):
    """Guards the fix against dropping the payload while adding the parameter."""
    await document_routes._create_remote_document(
        b"file bytes", "quy-che.pdf", "application/pdf", owner_id=42
    )

    files = recorded[0].get("files") or {}
    name, content, content_type = files["file"]
    assert name == "quy-che.pdf"
    assert content == b"file bytes"
    assert content_type == "application/pdf"


@pytest.mark.asyncio
async def test_a_missing_content_type_still_falls_back(recorded):
    await document_routes._create_remote_document(b"x", "a.bin", None, owner_id=1)

    assert recorded[0]["files"]["file"][2] == "application/octet-stream"


def test_the_route_passes_the_authenticated_principal_not_the_path_user_id():
    """The path segment is caller-supplied; the principal is not."""
    import inspect

    source = inspect.getsource(document_routes.upload_document)

    assert "_create_remote_document" in source
    call = source[source.index("_create_remote_document"):]
    call = call[: call.index(")")]
    assert "principal.id" in call, (
        f"upload must forward the authenticated principal, got: {call!r}"
    )
