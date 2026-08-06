# tests/test_repo_chat.py
"""Tests for chat-side repository access (story 16).

A regular (non-admin) user can browse their OWN unit's document repository from
the chat screen and "use" repo documents in a conversation by REFERENCE (the AI
retrieval is keyed by document_id; there is no copy/attach upstream). Selected
repo docs are LINKED to the conversation so the chat-query gate accepts them.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.middlewares.auth import get_current_user
from app.repositories.factory import (
    get_conversation_repository,
    get_document_repository,
)

USER_ID = 50
CONV_ID = 900
UNIT_ID = 7
DOC_A = "aaaaaaaa-0000-0000-0000-000000000001"
DOC_B = "bbbbbbbb-0000-0000-0000-000000000002"


@pytest.fixture
def client() -> TestClient:
    with patch("app.main.init_db", new_callable=AsyncMock), patch(
        "app.main.close_db", new_callable=AsyncMock
    ):
        return TestClient(app)


def _user(is_admin: bool = False, unit_id: int | None = UNIT_ID) -> dict:
    return {
        "id": USER_ID,
        "username": "member",
        "is_admin": is_admin,
        "unit_id": unit_id,
    }


def _clear() -> None:
    app.dependency_overrides.clear()


# ── List unit repository (non-admin) ────────────────────────────────────


def test_list_unit_repo_for_user_returns_groups_and_docs(
    client: TestClient,
) -> None:
    """A normal user lists their own unit's repository (no admin required)."""
    doc_repo = AsyncMock()
    doc_repo.list_unit_repository_for_user = AsyncMock(
        return_value={
            "groups": [{"id": 1, "name": "Kế hoạch"}],
            "documents": [
                {"id": DOC_A, "name": "a.pdf", "group_id": 1},
                {"id": DOC_B, "name": "b.pdf", "group_id": None},
            ],
        }
    )
    app.dependency_overrides[get_current_user] = lambda: _user()
    app.dependency_overrides[get_document_repository] = lambda: doc_repo

    resp = client.get("/repository/documents")
    assert resp.status_code == 200
    body = resp.json()
    assert [g["name"] for g in body["groups"]] == ["Kế hoạch"]
    assert {d["id"] for d in body["documents"]} == {DOC_A, DOC_B}
    # BE derives the unit from the principal — must not accept an arbitrary one.
    doc_repo.list_unit_repository_for_user.assert_awaited_once()
    _clear()


def test_list_unit_repo_for_user_no_admin_required(
    client: TestClient,
) -> None:
    """Non-admin gets 200 here, unlike /admin/documents (which is admin-only)."""
    doc_repo = AsyncMock()
    doc_repo.list_unit_repository_for_user = AsyncMock(
        return_value={"groups": [], "documents": []}
    )
    app.dependency_overrides[get_current_user] = lambda: _user(is_admin=False)
    app.dependency_overrides[get_document_repository] = lambda: doc_repo

    resp = client.get("/repository/documents")
    assert resp.status_code == 200
    _clear()


# ── Link repo docs into a conversation (reference, not copy) ────────────


def test_link_repo_docs_into_conversation(client: TestClient) -> None:
    conv_repo = AsyncMock()
    conv_repo.find_visible = AsyncMock(return_value={"id": CONV_ID})
    doc_repo = AsyncMock()
    doc_repo.link_repository_docs = AsyncMock(return_value=[DOC_A, DOC_B])
    doc_repo.find_by_conversation = AsyncMock(return_value=[])
    app.dependency_overrides[get_current_user] = lambda: _user()
    app.dependency_overrides[get_conversation_repository] = lambda: conv_repo
    app.dependency_overrides[get_document_repository] = lambda: doc_repo

    resp = client.post(
        f"/users/{USER_ID}/conversations/{CONV_ID}/documents/link-repository",
        json={"document_ids": [DOC_A, DOC_B]},
    )
    assert resp.status_code == 200
    doc_repo.link_repository_docs.assert_awaited_once()
    _clear()


def test_get_documents_includes_linked_repo_docs(client: TestClient) -> None:
    """The conversation document list appends linked repository docs."""
    conv_repo = AsyncMock()
    conv_repo.find_visible = AsyncMock(
        return_value={"id": CONV_ID, "last_synced_at": None}
    )
    doc_repo = AsyncMock()
    doc_repo.find_by_conversation = AsyncMock(return_value=[])
    doc_repo.find_linked_repo_documents = AsyncMock(
        return_value=[
            {
                "id": DOC_A,
                "conversation_id": 1,
                "user_id": 9,
                "name": "kho.pdf",
                "status": "COMPLETED",
                "chunk_count": 3,
                "task_id": None,
            }
        ]
    )
    app.dependency_overrides[get_current_user] = lambda: _user()
    app.dependency_overrides[get_conversation_repository] = lambda: conv_repo
    app.dependency_overrides[get_document_repository] = lambda: doc_repo

    with patch(
        "app.routes.document.sync_documents_internal",
        new_callable=AsyncMock,
        return_value=None,
    ):
        resp = client.get(
            f"/users/{USER_ID}/conversations/{CONV_ID}/documents"
        )
    assert resp.status_code == 200
    names = [d["name"] for d in resp.json()["documents"]]
    assert "kho.pdf" in names
    _clear()


def test_link_repo_docs_empty_returns_400(client: TestClient) -> None:
    conv_repo = AsyncMock()
    conv_repo.find_visible = AsyncMock(return_value={"id": CONV_ID})
    doc_repo = AsyncMock()
    app.dependency_overrides[get_current_user] = lambda: _user()
    app.dependency_overrides[get_conversation_repository] = lambda: conv_repo
    app.dependency_overrides[get_document_repository] = lambda: doc_repo

    resp = client.post(
        f"/users/{USER_ID}/conversations/{CONV_ID}/documents/link-repository",
        json={"document_ids": []},
    )
    assert resp.status_code == 400
    _clear()


def test_link_repo_docs_foreign_unit_returns_403(client: TestClient) -> None:
    """Linking a doc outside the user's unit repository is forbidden."""
    conv_repo = AsyncMock()
    conv_repo.find_visible = AsyncMock(return_value={"id": CONV_ID})
    doc_repo = AsyncMock()
    doc_repo.link_repository_docs = AsyncMock(
        side_effect=PermissionError("FORBIDDEN")
    )
    app.dependency_overrides[get_current_user] = lambda: _user()
    app.dependency_overrides[get_conversation_repository] = lambda: conv_repo
    app.dependency_overrides[get_document_repository] = lambda: doc_repo

    resp = client.post(
        f"/users/{USER_ID}/conversations/{CONV_ID}/documents/link-repository",
        json={"document_ids": [DOC_A]},
    )
    assert resp.status_code == 403
    _clear()


def test_link_repo_docs_conversation_not_found_returns_404(
    client: TestClient,
) -> None:
    conv_repo = AsyncMock()
    conv_repo.find_visible = AsyncMock(return_value=None)
    doc_repo = AsyncMock()
    app.dependency_overrides[get_current_user] = lambda: _user()
    app.dependency_overrides[get_conversation_repository] = lambda: conv_repo
    app.dependency_overrides[get_document_repository] = lambda: doc_repo

    resp = client.post(
        f"/users/{USER_ID}/conversations/{CONV_ID}/documents/link-repository",
        json={"document_ids": [DOC_A]},
    )
    assert resp.status_code == 404
    _clear()


# ── from_repository flag on the conversation document list (story 19) ────


def test_get_documents_marks_linked_repo_from_repository(
    client: TestClient,
) -> None:
    """Linked repo docs carry from_repository=True; own conv docs don't."""
    conv_repo = AsyncMock()
    conv_repo.find_visible = AsyncMock(
        return_value={"id": CONV_ID, "last_synced_at": None}
    )
    doc_repo = AsyncMock()
    doc_repo.find_by_conversation = AsyncMock(
        return_value=[
            {
                "id": DOC_B,
                "conversation_id": CONV_ID,
                "user_id": USER_ID,
                "name": "own.pdf",
                "status": "COMPLETED",
            }
        ]
    )
    doc_repo.find_linked_repo_documents = AsyncMock(
        return_value=[
            {
                "id": DOC_A,
                "conversation_id": 1,
                "user_id": 9,
                "name": "kho.pdf",
                "status": "UPLOADED",
            }
        ]
    )
    app.dependency_overrides[get_current_user] = lambda: _user()
    app.dependency_overrides[get_conversation_repository] = lambda: conv_repo
    app.dependency_overrides[get_document_repository] = lambda: doc_repo

    with patch(
        "app.routes.document.sync_documents_internal",
        new_callable=AsyncMock,
        return_value=None,
    ):
        resp = client.get(
            f"/users/{USER_ID}/conversations/{CONV_ID}/documents"
        )
    assert resp.status_code == 200
    by_id = {d["id"]: d for d in resp.json()["documents"]}
    assert by_id[DOC_A]["from_repository"] is True
    assert by_id[DOC_B]["from_repository"] is False
    _clear()


# ── Unlink a repo doc from the conversation (story 19) ───────────────────


def test_unlink_repository_doc_removes_link_only(client: TestClient) -> None:
    conv_repo = AsyncMock()
    conv_repo.find_visible = AsyncMock(return_value={"id": CONV_ID})
    doc_repo = AsyncMock()
    doc_repo.unlink_repository_doc = AsyncMock(return_value={"changes": 1})
    doc_repo.find_by_conversation = AsyncMock(return_value=[])
    doc_repo.find_linked_repo_documents = AsyncMock(return_value=[])
    app.dependency_overrides[get_current_user] = lambda: _user()
    app.dependency_overrides[get_conversation_repository] = lambda: conv_repo
    app.dependency_overrides[get_document_repository] = lambda: doc_repo

    resp = client.delete(
        f"/users/{USER_ID}/conversations/{CONV_ID}"
        f"/documents/{DOC_A}/link-repository"
    )
    assert resp.status_code == 200
    doc_repo.unlink_repository_doc.assert_awaited_once()
    # Must NOT delete the document itself (repository copy stays).
    doc_repo.delete.assert_not_awaited()
    _clear()


def test_unlink_repository_doc_conversation_not_found_404(
    client: TestClient,
) -> None:
    conv_repo = AsyncMock()
    conv_repo.find_visible = AsyncMock(return_value=None)
    doc_repo = AsyncMock()
    app.dependency_overrides[get_current_user] = lambda: _user()
    app.dependency_overrides[get_conversation_repository] = lambda: conv_repo
    app.dependency_overrides[get_document_repository] = lambda: doc_repo

    resp = client.delete(
        f"/users/{USER_ID}/conversations/{CONV_ID}"
        f"/documents/{DOC_A}/link-repository"
    )
    assert resp.status_code == 404
    _clear()


def test_unlink_repository_doc_non_admin_allowed(client: TestClient) -> None:
    """A normal user can unlink from their own visible conversation."""
    conv_repo = AsyncMock()
    conv_repo.find_visible = AsyncMock(return_value={"id": CONV_ID})
    doc_repo = AsyncMock()
    doc_repo.unlink_repository_doc = AsyncMock(return_value={"changes": 1})
    doc_repo.find_by_conversation = AsyncMock(return_value=[])
    doc_repo.find_linked_repo_documents = AsyncMock(return_value=[])
    app.dependency_overrides[get_current_user] = lambda: _user(is_admin=False)
    app.dependency_overrides[get_conversation_repository] = lambda: conv_repo
    app.dependency_overrides[get_document_repository] = lambda: doc_repo

    resp = client.delete(
        f"/users/{USER_ID}/conversations/{CONV_ID}"
        f"/documents/{DOC_A}/link-repository"
    )
    assert resp.status_code == 200
    _clear()


# ── Regression: chat-query gate (llm.py) accepts linked repo docs but still ─
#    rejects truly foreign documents. ────────────────────────────────────────


def _gate_repos(conv_docs, linked_ids):
    conv_repo = AsyncMock()
    conv_repo.find_visible = AsyncMock(return_value={"id": CONV_ID})
    doc_repo = AsyncMock()
    doc_repo.find_by_conversation = AsyncMock(return_value=conv_docs)
    doc_repo.linked_repo_doc_ids = AsyncMock(return_value=linked_ids)
    app.dependency_overrides[get_conversation_repository] = lambda: conv_repo
    app.dependency_overrides[get_document_repository] = lambda: doc_repo


def test_stream_query_foreign_doc_still_400(client: TestClient) -> None:
    """A document neither in the conversation nor linked is still rejected."""
    app.dependency_overrides[get_current_user] = lambda: _user()
    _gate_repos(conv_docs=[], linked_ids=[])

    resp = client.post(
        f"/query/stream?conversation_id={CONV_ID}&user_id={USER_ID}"
        f"&document_ids={DOC_A}",
        json={"query": "hi"},
    )
    assert resp.status_code == 400
    _clear()


def test_stream_query_linked_repo_doc_passes_gate(client: TestClient) -> None:
    """A linked repository doc passes the gate (then reaches the upstream).

    We make the remote-existence check pass and the upstream call fail fast, so
    a non-400 status proves the validation gate accepted the linked doc.
    """
    app.dependency_overrides[get_current_user] = lambda: _user()
    _gate_repos(conv_docs=[], linked_ids=[DOC_A])

    with patch(
        "app.routes.llm._check_remote_document",
        new_callable=AsyncMock,
        return_value=True,
    ), patch(
        "app.routes.llm.httpx.AsyncClient.send",
        new_callable=AsyncMock,
        side_effect=Exception("upstream unreachable"),
    ):
        resp = client.post(
            f"/query/stream?conversation_id={CONV_ID}&user_id={USER_ID}"
            f"&document_ids={DOC_A}",
            json={"query": "hi"},
        )
    # Not a 400 (gate passed); upstream failure surfaces as 502.
    assert resp.status_code != 400
    _clear()


# ── story 134: no document selected → block (don't answer globally) ──────


def test_stream_query_no_document_selected_returns_400(
    client: TestClient,
) -> None:
    """A conversation WITH documents but an EMPTY selection must be blocked.

    Story 134: unchecking every document used to fall through the gate and
    forward to the AI service with no document restriction (global search), so
    the model still answered from unchecked docs. The gate must now reject an
    empty selection when the conversation actually has documents.
    """
    app.dependency_overrides[get_current_user] = lambda: _user()
    _gate_repos(
        conv_docs=[{"id": DOC_A, "status": "COMPLETED"}],
        linked_ids=[],
    )

    resp = client.post(
        f"/query/stream?conversation_id={CONV_ID}&user_id={USER_ID}",
        json={"query": "hi"},
    )
    assert resp.status_code == 400
    _clear()


def test_stream_query_empty_conversation_no_docs_is_blocked(
    client: TestClient,
) -> None:
    """A conversation with NO documents is blocked too — story 134 as amended by
    the cross-unit leak fix (commit a49b5bc, 2026-07-30).

    This test previously asserted the opposite: story 134 only demanded a
    selection when the conversation already had documents, so an EMPTY
    conversation fell through as "general chat". Measured on the staging VPS,
    that was a data leak, not a feature — a plain member of unit 3 (is_admin
    false, no permissions) asked in an empty conversation and got the full text
    of unit 1's admin-only documents back, with citations to five of them. An
    empty selection reaches the AI service as ``document_ids: []``, and both
    ``qdrant.py`` and ``elasticsearch.py`` gate on ``if document_ids:`` — an
    empty list means NO filter, i.e. the entire corpus. The AI tier has no
    per-user or per-unit scoping of its own; the gateway is the only component
    that knows who may read what, so it has to refuse.

    The accepted product consequence: asking requires selecting a document.
    General chat with no document at all is no longer possible through this
    endpoint. If it is wanted back, it needs a real scope filter in the AI tier
    (unit/user), not a hole in this gate.
    """
    app.dependency_overrides[get_current_user] = lambda: _user()
    _gate_repos(conv_docs=[], linked_ids=[])

    resp = client.post(
        f"/query/stream?conversation_id={CONV_ID}&user_id={USER_ID}",
        json={"query": "hi"},
    )
    assert resp.status_code == 400
    _clear()


# ── group_name on linked repo docs (story 33) ───────────────────────────


def test_get_documents_includes_group_name_for_grouped_repo_doc(
    client: TestClient,
) -> None:
    """Linked repo docs carry their folder name (group_name) so the chat panel
    can group them under "Kho tài liệu"; ungrouped repo docs leave it null."""
    conv_repo = AsyncMock()
    conv_repo.find_visible = AsyncMock(
        return_value={"id": CONV_ID, "last_synced_at": None}
    )
    doc_repo = AsyncMock()
    doc_repo.find_by_conversation = AsyncMock(return_value=[])
    doc_repo.find_linked_repo_documents = AsyncMock(
        return_value=[
            {
                "id": DOC_A,
                "conversation_id": 1,
                "user_id": 9,
                "name": "ke_hoach.pdf",
                "status": "COMPLETED",
                "group_id": 5,
                "group_name": "Kế hoạch",
            },
            {
                "id": DOC_B,
                "conversation_id": 1,
                "user_id": 9,
                "name": "le.pdf",
                "status": "COMPLETED",
                "group_id": None,
                "group_name": None,
            },
        ]
    )
    app.dependency_overrides[get_current_user] = lambda: _user()
    app.dependency_overrides[get_conversation_repository] = lambda: conv_repo
    app.dependency_overrides[get_document_repository] = lambda: doc_repo

    with patch(
        "app.routes.document.sync_documents_internal",
        new_callable=AsyncMock,
        return_value=None,
    ):
        resp = client.get(
            f"/users/{USER_ID}/conversations/{CONV_ID}/documents"
        )
    assert resp.status_code == 200
    by_id = {d["id"]: d for d in resp.json()["documents"]}
    assert by_id[DOC_A]["group_name"] == "Kế hoạch"
    assert by_id[DOC_A]["group_id"] == 5
    assert by_id[DOC_B]["group_name"] is None
    _clear()


def test_document_out_group_name_optional_defaults_none() -> None:
    """DocumentOut accepts an optional group_name and defaults it to None
    (additive: existing callers that omit it must not break)."""
    from app.models.schemas import DocumentOut

    without = DocumentOut(id="x", conversation_id=1, user_id=2, name="a.pdf")
    assert without.group_name is None

    with_name = DocumentOut(
        id="y",
        conversation_id=1,
        user_id=2,
        name="b.pdf",
        group_name="Kế hoạch",
    )
    assert with_name.group_name == "Kế hoạch"


# ── Story 35: super-admin picks a unit; non-super locked to own (security) ──


def test_list_unit_repo_superadmin_with_unit_scopes_to_it(
    client: TestClient,
) -> None:
    """Super admin (unit-less) passes unit_id → repo of THAT unit is listed."""
    doc_repo = AsyncMock()
    doc_repo.list_unit_repository_for_user = AsyncMock(
        return_value={"groups": [], "documents": []}
    )
    app.dependency_overrides[get_current_user] = lambda: _user(
        is_admin=True, unit_id=None
    )
    app.dependency_overrides[get_document_repository] = lambda: doc_repo

    resp = client.get("/repository/documents", params={"unit_id": 5})
    assert resp.status_code == 200
    # Resolved target unit forwarded to the repo (super admin sees any unit).
    _, kwargs = doc_repo.list_unit_repository_for_user.await_args
    assert kwargs.get("target_unit_id") == 5
    _clear()


def test_list_unit_repo_superadmin_without_unit_returns_400(
    client: TestClient,
) -> None:
    """Super admin must focus a unit first — no unit_id → 400."""
    doc_repo = AsyncMock()
    app.dependency_overrides[get_current_user] = lambda: _user(
        is_admin=True, unit_id=None
    )
    app.dependency_overrides[get_document_repository] = lambda: doc_repo

    resp = client.get("/repository/documents")
    assert resp.status_code == 400
    _clear()


def test_list_unit_repo_non_super_foreign_unit_returns_403(
    client: TestClient,
) -> None:
    """A unit user/admin cannot read another unit's repository (security)."""
    doc_repo = AsyncMock()
    app.dependency_overrides[get_current_user] = lambda: _user(unit_id=7)
    app.dependency_overrides[get_document_repository] = lambda: doc_repo

    resp = client.get("/repository/documents", params={"unit_id": 9})
    assert resp.status_code == 403
    _clear()


def test_list_unit_repo_non_super_no_unit_uses_own(
    client: TestClient,
) -> None:
    """Non-super without unit_id → own unit (backward-compatible)."""
    doc_repo = AsyncMock()
    doc_repo.list_unit_repository_for_user = AsyncMock(
        return_value={"groups": [], "documents": []}
    )
    app.dependency_overrides[get_current_user] = lambda: _user(unit_id=7)
    app.dependency_overrides[get_document_repository] = lambda: doc_repo

    resp = client.get("/repository/documents")
    assert resp.status_code == 200
    _, kwargs = doc_repo.list_unit_repository_for_user.await_args
    assert kwargs.get("target_unit_id") == 7
    _clear()


def test_link_repo_superadmin_with_unit_validates_that_unit(
    client: TestClient,
) -> None:
    """Super admin links docs of a chosen unit → that unit forwarded to link."""
    conv_repo = AsyncMock()
    conv_repo.find_visible = AsyncMock(return_value={"id": CONV_ID})
    doc_repo = AsyncMock()
    doc_repo.link_repository_docs = AsyncMock(return_value=[DOC_A])
    doc_repo.find_by_conversation = AsyncMock(return_value=[])
    app.dependency_overrides[get_current_user] = lambda: _user(
        is_admin=True, unit_id=None
    )
    app.dependency_overrides[get_conversation_repository] = lambda: conv_repo
    app.dependency_overrides[get_document_repository] = lambda: doc_repo

    resp = client.post(
        f"/users/{USER_ID}/conversations/{CONV_ID}/documents/link-repository",
        json={"document_ids": [DOC_A], "unit_id": 5},
    )
    assert resp.status_code == 200
    _, kwargs = doc_repo.link_repository_docs.await_args
    assert kwargs.get("target_unit_id") == 5
    _clear()


def test_link_repo_non_super_foreign_unit_returns_403(
    client: TestClient,
) -> None:
    conv_repo = AsyncMock()
    conv_repo.find_visible = AsyncMock(return_value={"id": CONV_ID})
    doc_repo = AsyncMock()
    app.dependency_overrides[get_current_user] = lambda: _user(unit_id=7)
    app.dependency_overrides[get_conversation_repository] = lambda: conv_repo
    app.dependency_overrides[get_document_repository] = lambda: doc_repo

    resp = client.post(
        f"/users/{USER_ID}/conversations/{CONV_ID}/documents/link-repository",
        json={"document_ids": [DOC_A], "unit_id": 9},
    )
    assert resp.status_code == 403
    _clear()


def test_get_documents_includes_unit_name_for_repo_doc(
    client: TestClient,
) -> None:
    """Linked repo docs carry their source unit name (super-admin left menu)."""
    conv_repo = AsyncMock()
    conv_repo.find_visible = AsyncMock(
        return_value={"id": CONV_ID, "last_synced_at": None}
    )
    doc_repo = AsyncMock()
    doc_repo.find_by_conversation = AsyncMock(return_value=[])
    doc_repo.find_linked_repo_documents = AsyncMock(
        return_value=[
            {
                "id": DOC_A,
                "conversation_id": 1,
                "user_id": 9,
                "name": "kho.pdf",
                "status": "COMPLETED",
                "unit_name": "Phòng Kế hoạch",
            }
        ]
    )
    app.dependency_overrides[get_current_user] = lambda: _user()
    app.dependency_overrides[get_conversation_repository] = lambda: conv_repo
    app.dependency_overrides[get_document_repository] = lambda: doc_repo

    with patch(
        "app.routes.document.sync_documents_internal",
        new_callable=AsyncMock,
        return_value=None,
    ):
        resp = client.get(
            f"/users/{USER_ID}/conversations/{CONV_ID}/documents"
        )
    assert resp.status_code == 200
    by_id = {d["id"]: d for d in resp.json()["documents"]}
    assert by_id[DOC_A]["unit_name"] == "Phòng Kế hoạch"
    _clear()


def test_document_out_unit_name_optional_defaults_none() -> None:
    from app.models.schemas import DocumentOut

    assert (
        DocumentOut(id="x", conversation_id=1, user_id=2, name="a.pdf").unit_name
        is None
    )
    assert (
        DocumentOut(
            id="y", conversation_id=1, user_id=2, name="b.pdf", unit_name="U"
        ).unit_name
        == "U"
    )
