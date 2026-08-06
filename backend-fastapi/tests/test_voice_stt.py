"""STT proxy route — size cap, status fidelity, multipart shape."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.middlewares.auth import get_current_user
from app.routes import voice


@pytest.fixture
def client() -> TestClient:
    """Test client with the db lifespan and auth stubbed out."""
    with patch("app.main.init_db", new_callable=AsyncMock), patch(
        "app.main.close_db", new_callable=AsyncMock
    ):
        app.dependency_overrides[get_current_user] = lambda: {
            "id": 1,
            "username": "tester",
            "is_admin": False,
        }
        yield TestClient(app)
        app.dependency_overrides.clear()


def _upstream(status_code: int, payload: str) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.text = payload
    return resp


def _patch_upstream(resp: MagicMock):
    """Patch the httpx client used by the STT proxy, returning the post mock."""
    post = AsyncMock(return_value=resp)
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=MagicMock(post=post))
    ctx.__aexit__ = AsyncMock(return_value=False)
    return patch.object(
        voice.httpx, "AsyncClient", MagicMock(return_value=ctx)
    ), post


def test_stt_transcribe_oversize_rejected_without_upstream_call(client):
    """A clip over the cap must fail locally, not after a 26 MB round trip."""
    blob = b"\x00" * (voice._STT_MAX_UPLOAD + 1)
    patcher, post = _patch_upstream(_upstream(200, "{}"))
    with patcher:
        resp = client.post(
            "/stt/transcribe",
            files={"file": ("voice.wav", blob, "audio/wav")},
            data={"language": "vi"},
        )
    assert resp.status_code == 413
    post.assert_not_called()


def test_stt_transcribe_empty_upload_rejected(client):
    """An empty blob is a client error, not something to forward."""
    patcher, post = _patch_upstream(_upstream(200, "{}"))
    with patcher:
        resp = client.post(
            "/stt/transcribe",
            files={"file": ("voice.wav", b"", "audio/wav")},
            data={"language": "vi"},
        )
    assert resp.status_code == 422
    post.assert_not_called()


@pytest.mark.parametrize("upstream_status", [403, 413, 415, 422, 503])
def test_stt_transcribe_propagates_upstream_status(client, upstream_status):
    """Upstream statuses must survive: each drives a different UI message.

    Collapsing them to 502 would make "feature is switched off" (403) and
    "engine failed to load" (503) indistinguishable to the user.
    """
    patcher, _ = _patch_upstream(
        _upstream(upstream_status, '{"detail":"nope"}')
    )
    with patcher:
        resp = client.post(
            "/stt/transcribe",
            files={"file": ("voice.wav", b"RIFFxxxx", "audio/wav")},
            data={"language": "vi"},
        )
    assert resp.status_code == upstream_status
    assert resp.json()["detail"] == "nope"


def test_stt_transcribe_forwards_filename_and_language(client):
    """The AI service gates on the file extension and reads language as a
    form field, so both must arrive in the shape it expects."""
    patcher, post = _patch_upstream(
        _upstream(200, '{"text":"xin chào","language":"vi"}')
    )
    with patcher:
        resp = client.post(
            "/stt/transcribe",
            files={"file": ("voice.wav", b"RIFFxxxx", "audio/wav")},
            data={"language": "en"},
        )
    assert resp.status_code == 200
    assert resp.json()["text"] == "xin chào"

    _, kwargs = post.call_args
    filename, content, _content_type = kwargs["files"]["file"]
    assert filename == "voice.wav"
    assert content == b"RIFFxxxx"
    assert kwargs["data"] == {"language": "en"}


def test_stt_transcribe_unreachable_upstream_is_502(client):
    """A dead AI service is a gateway error, unlike an upstream refusal."""
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(side_effect=RuntimeError("connection refused"))
    ctx.__aexit__ = AsyncMock(return_value=False)
    with patch.object(
        voice.httpx, "AsyncClient", MagicMock(return_value=ctx)
    ):
        resp = client.post(
            "/stt/transcribe",
            files={"file": ("voice.wav", b"RIFFxxxx", "audio/wav")},
            data={"language": "vi"},
        )
    assert resp.status_code == 502
