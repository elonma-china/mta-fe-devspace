"""Audio-overview proxy routes — streaming, status fidelity, poll traps."""

import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.middlewares.auth import get_current_user
from app.models.schemas import ToolStatusResponse
from app.routes import llm


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


# ── The two poll traps ──────────────────────────────────────────────


def test_tool_status_response_preserves_audio_overview_fields():
    """A finished episode carries fields ToolStatusResponse never declared.

    The schema relies on extra="allow" to pass them through. If that ever
    becomes extra="ignore", the FE silently loses the audio it just made —
    with no error anywhere to point at.
    """
    payload = {
        "task_id": "t-1",
        "object_key": "audio-overviews-devspace/t-1.wav",
        "audio_format": "wav",
        "duration_sec": 72.5,
        "size_bytes": 3_100_000,
        "transcript": [{"speaker": "host", "text": "xin chào"}],
    }
    dumped = ToolStatusResponse(**payload).model_dump()
    for key, value in payload.items():
        assert dumped[key] == value


def test_zombie_check_destroys_finished_episode_when_start_time_is_sent():
    """Guard on the trap, not just a note about it.

    A successful AudioOverviewResponse has no `status` field, which
    `_apply_zombie_check` reads as "stuck". This test pins the exact
    behaviour the FE must avoid — if someone later "fixes" the FE by
    passing startTime for consistency with the other tools, this is what
    they would be turning on.
    """
    finished = {"task_id": "t-1", "object_key": "k", "transcript": []}
    stale = str(int(time.time() * 1000) - settings.zombie_task_timeout_ms - 1)

    assert llm._apply_zombie_check(finished, stale)["status"] == "FAILURE"
    # …and the early-out that makes omitting startTime the correct fix.
    assert llm._apply_zombie_check(finished, None) == finished


# ── File streaming ──────────────────────────────────────────────────


def _stream_ctx(status_code: int, *, chunks=(b"",), headers=None, body=b""):
    """Build a mock httpx.AsyncClient whose send() returns a stream response."""
    upstream = MagicMock()
    upstream.status_code = status_code
    upstream.headers = headers or {}
    upstream.aclose = AsyncMock()
    upstream.aread = AsyncMock(return_value=body)

    async def _iter(_size):
        for chunk in chunks:
            yield chunk

    upstream.aiter_bytes = _iter

    client = MagicMock()
    client.build_request = MagicMock(return_value=MagicMock())
    client.send = AsyncMock(return_value=upstream)
    client.aclose = AsyncMock()
    return client


def test_audio_overview_file_streams_body_and_headers(client):
    """The episode must arrive whole, with its type and filename intact."""
    fake = _stream_ctx(
        200,
        chunks=(b"RIFF", b"data", b"more"),
        headers={
            "content-type": "audio/wav",
            "content-length": "12",
            "content-disposition": 'attachment; filename="ep.wav"',
        },
    )
    with patch.object(llm.httpx, "AsyncClient", MagicMock(return_value=fake)):
        resp = client.get("/tools/audio-overview/t-1/file")

    assert resp.status_code == 200
    assert resp.content == b"RIFFdatamore"
    assert resp.headers["content-type"] == "audio/wav"
    assert "ep.wav" in resp.headers["content-disposition"]


@pytest.mark.parametrize("upstream_status", [404, 409, 502])
def test_audio_overview_file_propagates_upstream_status(
    client, upstream_status
):
    """409 (still rendering), 404 (gone) and 502 (store down) are three
    different things the UI says differently. None may become a generic
    gateway error."""
    fake = _stream_ctx(upstream_status, body=b'{"detail":"nope"}')
    with patch.object(llm.httpx, "AsyncClient", MagicMock(return_value=fake)):
        resp = client.get("/tools/audio-overview/t-1/file")

    assert resp.status_code == upstream_status
    assert resp.json()["detail"] == "nope"
    fake.aclose.assert_awaited()


def test_audio_overview_file_closes_client_when_upstream_unreachable(client):
    """A failed send must not leak the AsyncClient it was made with."""
    fake = _stream_ctx(200)
    fake.send = AsyncMock(side_effect=RuntimeError("connection refused"))
    with patch.object(llm.httpx, "AsyncClient", MagicMock(return_value=fake)):
        resp = client.get("/tools/audio-overview/t-1/file")

    assert resp.status_code == 502
    fake.aclose.assert_awaited()


# ── Cancel / delete ─────────────────────────────────────────────────


def _request_ctx(status_code: int, payload: str):
    request = AsyncMock(
        return_value=MagicMock(status_code=status_code, text=payload)
    )
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=MagicMock(request=request))
    ctx.__aexit__ = AsyncMock(return_value=False)
    return patch.object(
        llm.httpx, "AsyncClient", MagicMock(return_value=ctx)
    ), request


def test_audio_overview_cancel_forwards_post(client):
    patcher, request = _request_ctx(200, '{"status":"cancel_requested"}')
    with patcher:
        resp = client.post("/tools/audio-overview/t-1/cancel")

    assert resp.status_code == 200
    assert resp.json()["status"] == "cancel_requested"
    method, url = request.call_args[0]
    assert method == "POST"
    assert url.endswith("/tools/audio-overview/t-1/cancel")


def test_audio_overview_delete_forwards_delete(client):
    patcher, request = _request_ctx(200, '{"status":"ok","deleted":true}')
    with patcher:
        resp = client.delete("/tools/audio-overview/t-1")

    assert resp.status_code == 200
    assert resp.json()["deleted"] is True
    method, url = request.call_args[0]
    assert method == "DELETE"
    assert url.endswith("/tools/audio-overview/t-1")


def test_audio_overview_delete_propagates_409_while_running(client):
    """Deleting a running task is refused upstream; the UI tells the user to
    cancel first, which it can only do if the 409 survives."""
    patcher, _ = _request_ctx(409, '{"detail":"task is running"}')
    with patcher:
        resp = client.delete("/tools/audio-overview/t-1")

    assert resp.status_code == 409
    assert resp.json()["detail"] == "task is running"


def test_audio_overview_routes_are_declared_before_the_tool_catch_all():
    """`POST /tools/{tool_name}` reads request.json(); anything that must not
    go through it has to be matched first. Route order is the only thing
    enforcing that, so assert it rather than trusting a comment."""
    paths = [getattr(r, "path", "") for r in app.routes]
    catch_all = paths.index("/tools/{tool_name}")
    for path in (
        "/tools/audio-overview/{task_id}/file",
        "/tools/audio-overview/{task_id}/cancel",
        "/tools/audio-overview/{task_id}",
    ):
        assert paths.index(path) < catch_all, f"{path} declared too late"


# ── Submit: the upstream status must survive the proxy ──────────────


def _upstream(status_code: int, payload):
    """A stand-in httpx response for the AI service."""
    import json as _json

    resp = MagicMock()
    resp.status_code = status_code
    resp.text = _json.dumps(payload)
    return resp


def _patched_post(resp):
    """Patch the AsyncClient used by the submit proxy to return `resp`."""
    client = MagicMock()
    client.post = AsyncMock(return_value=resp)
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=client)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return patch.object(llm.httpx, "AsyncClient", MagicMock(return_value=ctx))


def test_submit_forwards_success(client):
    with _patched_post(_upstream(200, {"task_id": "t1", "status": "submitted"})):
        r = client.post(
            "/tools/audio-overview",
            json={"document_ids": ["d1"], "mode": "podcast", "voice_gender": "male"},
        )
    assert r.status_code == 200
    assert r.json()["task_id"] == "t1"


def test_submit_preserves_a_422_instead_of_returning_200(client):
    """The whole reason this route exists.

    The `/tools/{tool_name}` catch-all returns `parsed` without looking at
    `upstream.status_code`, so a validation error came back as HTTP 200 with
    the error in the body. The FE keys off `ApiError.status`, so a 200 means
    the modal closes and the store polls an undefined task_id forever.
    """
    detail = [{"loc": ["body", "tone"], "msg": "input không hợp lệ"}]
    with _patched_post(_upstream(422, {"detail": detail})):
        r = client.post(
            "/tools/audio-overview",
            json={"document_ids": ["d1"], "tone": "nonsense"},
        )
    assert r.status_code == 422


def test_submit_flattens_fastapi_list_detail_into_a_string(client):
    """A list detail reaches the FE's message field as "[object Object]"."""
    detail = [{"loc": ["body", "tone"], "msg": "input không hợp lệ"}]
    with _patched_post(_upstream(422, {"detail": detail})):
        r = client.post("/tools/audio-overview", json={"document_ids": ["d1"]})
    body_detail = r.json()["detail"]
    assert isinstance(body_detail, str)
    assert "tone" in body_detail and "input không hợp lệ" in body_detail


def test_submit_preserves_a_400_from_the_mode_contract(client):
    with _patched_post(_upstream(400, {"detail": "'focus' chỉ dùng cho mode='podcast'"})):
        r = client.post(
            "/tools/audio-overview",
            json={"document_ids": ["d1"], "mode": "narration", "focus": "x"},
        )
    assert r.status_code == 400
    assert "podcast" in r.json()["detail"]


def test_malformed_json_body_is_400_not_500(client):
    """Body hỏng là lỗi của client — gateway không được biến nó thành 500.

    Đo trên ccoex 2026-08-19: POST /tools/audio-overview với body `{"mode":`
    qua gateway trả 500 {"error":"Internal server error"}, trong khi CHÍNH
    request đó gửi thẳng lên AI trả 422. `await request.json()` ném
    JSONDecodeError và handler toàn cục nuốt thành 500. Hậu quả: giám sát báo
    động nhầm, và client tưởng máy chủ hỏng nên thử lại mãi một body sẽ không
    bao giờ hợp lệ.
    """
    resp = client.post(
        "/tools/audio-overview",
        content=b'{"mode":',
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 400
    assert "JSON" in resp.json()["detail"]


def test_wrong_content_type_is_400_not_500(client):
    resp = client.post(
        "/tools/audio-overview",
        content=b"khong phai json",
        headers={"Content-Type": "text/plain"},
    )
    assert resp.status_code == 400
