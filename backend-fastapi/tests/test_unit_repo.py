# tests/test_unit_repo.py
"""Story 93: the user-side unit-repository list (RepoDoc) must carry the
columns the redesigned screen shows — Trích yếu (summary), Số văn bản
(doc_number) and a status (for the status filter). These are additive/optional
so the chat picker (which shares RepoDoc) is unaffected."""

from __future__ import annotations

from app.models.schemas import RepoDoc


def test_repodoc_carries_summary_doc_number_status() -> None:
    doc = RepoDoc(
        id="abc",
        name="Bao_cao.pdf",
        group_id=1,
        summary="Trích yếu mẫu",
        doc_number="ĐM-11/CN",
        status="COMPLETED",
    )
    assert doc.summary == "Trích yếu mẫu"
    assert doc.doc_number == "ĐM-11/CN"
    assert doc.status == "COMPLETED"


def test_repodoc_fields_optional_default_none() -> None:
    # The chat picker builds RepoDoc without the new fields → must default to None.
    doc = RepoDoc(id="abc", name="x.pdf")
    assert doc.summary is None
    assert doc.doc_number is None
    assert doc.status is None
