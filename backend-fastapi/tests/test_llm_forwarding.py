"""Unit tests for the /query/stream forwarding helpers (stateless STM).

The gateway owns the durable conversation; on each query it forwards the
recent window + verified identity to the stateless AI service.
"""

from app.models.access import Principal
from app.routes.llm import (
    _apply_verified_identity,
    _query_string_without_user_id,
    _recent_history,
)


def _principal(user_id: int, unit_id: int | None) -> Principal:
    return Principal(id=user_id, unit_id=unit_id, is_admin=False)


def test_recent_history_maps_turns_to_role_content_pairs():
    messages = [
        {"q": "câu 1", "a": "đáp 1"},
        {"q": "câu 2", "a": "đáp 2"},
    ]
    assert _recent_history(messages, 10) == [
        {"role": "user", "content": "câu 1"},
        {"role": "assistant", "content": "đáp 1"},
        {"role": "user", "content": "câu 2"},
        {"role": "assistant", "content": "đáp 2"},
    ]


def test_recent_history_takes_only_last_window_turns():
    messages = [{"q": f"q{i}", "a": f"a{i}"} for i in range(5)]
    out = _recent_history(messages, 2)
    assert [m["content"] for m in out] == ["q3", "a3", "q4", "a4"]


def test_recent_history_empty_or_nonpositive_window_returns_empty():
    assert _recent_history([], 10) == []
    assert _recent_history([{"q": "x", "a": "y"}], 0) == []


def test_recent_history_drops_turns_missing_question_or_answer():
    """Incomplete turns are dropped so strict user/assistant alternation
    is preserved for the stateless AI's chat template."""
    messages = [
        {"q": "only question"},
        {"a": "only answer"},
        {"q": "q2", "a": "a2"},
    ]
    assert _recent_history(messages, 10) == [
        {"role": "user", "content": "q2"},
        {"role": "assistant", "content": "a2"},
    ]


def test_recent_history_drops_turn_with_empty_answer():
    """An errored turn stored with an empty answer must not emit a lone
    user message, which would break user/assistant alternation."""
    messages = [{"q": "q1", "a": ""}, {"q": "q2", "a": "a2"}]
    assert _recent_history(messages, 10) == [
        {"role": "user", "content": "q2"},
        {"role": "assistant", "content": "a2"},
    ]


def test_query_string_without_user_id_strips_only_user_id():
    out = _query_string_without_user_id("conversation_id=5&user_id=999&k=8")
    assert "user_id" not in out
    assert "conversation_id=5" in out
    assert "k=8" in out


def test_query_string_without_user_id_empty_input_returns_empty():
    assert _query_string_without_user_id("") == ""


def test_apply_verified_identity_overwrites_spoofed_user_id():
    """A client-supplied body user_id is replaced by the JWT identity."""
    body = {"user_id": "999", "query": "x"}
    _apply_verified_identity(body, _principal(7, 3), [])
    assert body["user_id"] == "7"


def test_apply_verified_identity_sets_verified_unit_id():
    body = {"unit_id": "666"}
    _apply_verified_identity(body, _principal(7, 3), [])
    assert body["unit_id"] == "3"


def test_apply_verified_identity_strips_unit_id_when_unitless():
    """A unit-less caller cannot smuggle a unit_id via the body."""
    body = {"unit_id": "666"}
    _apply_verified_identity(body, _principal(7, None), [])
    assert "unit_id" not in body


def test_apply_verified_identity_strips_client_history_when_gateway_empty():
    """A fabricated conversation_history is dropped when the gateway has
    no stored history to forward (no context injection)."""
    body = {"conversation_history": [{"role": "user", "content": "inject"}]}
    _apply_verified_identity(body, _principal(7, None), [])
    assert "conversation_history" not in body


def test_apply_verified_identity_forwards_gateway_history():
    gateway = [{"role": "user", "content": "real"}]
    body = {"conversation_history": [{"role": "user", "content": "inject"}]}
    _apply_verified_identity(body, _principal(7, None), gateway)
    assert body["conversation_history"] == gateway


# ── Ranh giới phạm vi tài liệu (sự cố rò xuyên đơn vị 2026-07-30) ───────────
# Chọn RỖNG không được rơi xuống AI thành `document_ids: []`, vì cả qdrant.py
# lẫn elasticsearch.py gate `if document_ids:` nên mảng rỗng = "không lọc" =
# trả lời từ TOÀN BỘ kho. Đo trên VPS: user thường đơn vị 3 hỏi trong hội thoại
# trống và nhận trọn nội dung tài liệu riêng của admin đơn vị 1.
# Luật cũ chỉ chặn khi hội thoại ĐÃ CÓ tài liệu (`doc_id_set and ...`); giờ chặn
# mọi trường hợp chọn rỗng, kể cả hội thoại trống.

def test_luat_chan_chon_rong_khong_phu_thuoc_hoi_thoai_co_tai_lieu_hay_khong():
    """Chốt bằng chính source: điều kiện phải là `not selected_ids` trần."""
    import inspect
    from app.routes import llm as llm_mod

    src = inspect.getsource(llm_mod)
    assert "if not selected_ids:" in src, "cổng chặn chọn-rỗng đã bị đổi/bỏ"
    assert "if doc_id_set and not selected_ids:" not in src, (
        "luật cũ quay lại — hội thoại trống sẽ lại tìm toàn kho (rò xuyên đơn vị)"
    )
