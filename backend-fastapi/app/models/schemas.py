"""Pydantic request and response models for all API endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel



# ══════════════════════════════════════════════════════════════════════
# Common / Shared
# ══════════════════════════════════════════════════════════════════════

class SuccessResponse(BaseModel):
    success: bool = True


# ══════════════════════════════════════════════════════════════════════
# Auth
# ══════════════════════════════════════════════════════════════════════

class LoginRequest(BaseModel):
    username: str
    password: str


class UnitInfo(BaseModel):
    """Schema representing a department or organizational unit (tree node)."""
    id: int
    name: str
    parent_id: Optional[int] = None


class RoleInfo(BaseModel):
    """Schema representing a flat, unit-scoped role."""
    id: int
    name: str
    unit_id: Optional[int] = None
    is_admin: bool = False


class UserInfo(BaseModel):
    """Detailed user information schema."""
    id: int
    name: Optional[str] = None
    username: str
    unit_id: Optional[int] = None
    unit_name: Optional[str] = None
    role_id: Optional[int] = None
    role_name: Optional[str] = None
    is_admin: bool = False
    lock_status: Optional[bool] = None
    created_at: Optional[datetime] = None
    token_version: Optional[int] = None


class LoginResponse(BaseModel):
    token: str
    user: UserInfo


class MeResponse(BaseModel):
    id: int
    username: str
    is_admin: bool
    unit_id: Optional[int] = None
    unit_name: Optional[str] = None
    # Story 66: capability action strings the FE uses to gate the document/kho
    # domain by permission (not only is_admin). Additive — old clients ignore it.
    permissions: list[str] = []


# ══════════════════════════════════════════════════════════════════════
# User
# ══════════════════════════════════════════════════════════════════════

class CreateUserRequest(BaseModel):
    """Schema for creating a user with unit and role configuration."""
    name: str
    username: str
    password: str
    unit_id: Optional[int] = None
    role_id: Optional[int] = None
    unit_name: Optional[str] = None
    is_admin: Optional[bool] = False


class UpdateUserRequest(BaseModel):
    """Schema for updating a user's details, unit, or role."""
    name: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    unit_id: Optional[int] = None
    role_id: Optional[int] = None
    unit_name: Optional[str] = None
    is_admin: Optional[bool] = None


class CreateUserResponse(BaseModel):
    id: int


class LockUserRequest(BaseModel):
    lock: bool


# ══════════════════════════════════════════════════════════════════════
# Unit (đơn vị)
# ══════════════════════════════════════════════════════════════════════

class AdminAssign(BaseModel):
    """How a unit's administrator is set.

    Either ``user_id`` (promote an existing user) OR the trio
    ``full_name`` / ``username`` / ``password`` (create a brand-new admin
    user). Validation of the exclusive choice happens in the repository.
    """
    user_id: Optional[int] = None
    full_name: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None


class CreateUnitRequest(BaseModel):
    """Schema for creating a unit, optionally with an administrator."""
    name: str
    parent_id: Optional[int] = None
    admin: Optional[AdminAssign] = None


class UpdateUnitRequest(BaseModel):
    """Schema for updating a unit's name and/or administrator."""
    name: Optional[str] = None
    admin: Optional[AdminAssign] = None


class UnitListItem(BaseModel):
    """A unit row enriched with its administrator's display fields."""
    id: int
    name: str
    parent_id: Optional[int] = None
    admin_username: Optional[str] = None
    admin_full_name: Optional[str] = None


class UnitListResponse(BaseModel):
    """Paginated envelope for the unit list."""
    items: list[UnitListItem]
    total: int
    page: int
    page_size: int


class AdminCandidate(BaseModel):
    """A user eligible to be assigned as a unit's administrator."""
    id: int
    username: str
    full_name: Optional[str] = None


class CreateDocGroupRequest(BaseModel):
    """Schema for creating a document group (nhóm tài liệu).

    ``unit_id`` is the unit the group belongs to (story 77). Super-admins/the
    commander send the focused unit; unit admins omit it (the backend uses their
    own unit).
    """
    name: str
    unit_id: Optional[int] = None


class UpdateDocGroupRequest(BaseModel):
    """Schema for renaming a document group."""
    name: str


class DocGroupItem(BaseModel):
    """A single document-group row (unit-scoped — story 77)."""
    id: int
    name: str
    unit_id: Optional[int] = None
    # Story 80: the owning unit's name — shown as the "Đơn vị" column in the
    # super-admin/commander all-units groups view. None in the per-unit view.
    unit_name: Optional[str] = None


class DocGroupListResponse(BaseModel):
    """Paginated envelope for the document-group list."""
    items: list[DocGroupItem]
    total: int
    page: int
    page_size: int


class LockUserResponse(SuccessResponse):
    lock_status: bool


# ══════════════════════════════════════════════════════════════════════
# Conversation
# ══════════════════════════════════════════════════════════════════════

class CreateConversationRequest(BaseModel):
    name: str
    isPublic: Optional[bool] = True
    dataSource: Optional[dict] = None
    documents: Optional[list] = None
    initialSummary: Optional[str] = ""
    infoTables: Optional[list] = None


class CreateConversationResponse(BaseModel):
    id: int
    name: str
    user_id: int


class RenameRequest(BaseModel):
    name: str


class UpdateSummaryRequest(BaseModel):
    summary: str


class SourceItem(BaseModel):
    enriched_content: Optional[str] = None
    content: Optional[str] = None
    document_id: Optional[str] = ""
    metadata: Optional[dict] = None
    # Where ``content`` sits in the document's source text. Lets the viewer
    # mark the exact range instead of matching text against the page.
    char_start: Optional[int] = None
    char_end: Optional[int] = None
    # Cross-page citation fix: per-page breakdown of a window-enriched source
    # whose content spans more than one PDF page (page_segments). Optional/
    # additive — older callers that omit it are unaffected.
    context_metadata: Optional[dict] = None


class AddMessageRequest(BaseModel):
    question: Optional[str] = None
    answer: Optional[str] = None
    sources: Optional[list[SourceItem]] = None
    selected: Optional[list[str]] = None


class AddMessageResponse(SuccessResponse):
    data_source: dict


class DataSourceResponse(BaseModel):
    data_source: Any


# ══════════════════════════════════════════════════════════════════════
# Document
# ══════════════════════════════════════════════════════════════════════

class DocumentOut(BaseModel):
    """Serialized document row."""
    id: str
    conversation_id: int
    user_id: int
    name: str
    doc_number: Optional[str] = None
    summary: Optional[str] = None
    group_id: Optional[int] = None
    # Story 33: name of the repository folder (DocumentGroup) this document
    # belongs to, so the chat panel can group linked repo docs under
    # "Kho tài liệu". Optional/additive — null for ungrouped or self-uploaded
    # docs; existing callers that omit it are unaffected.
    group_name: Optional[str] = None
    # Story 35: name of the UNIT that owns the repository this doc came from, so
    # a super-admin's chat left menu can show which unit each linked repo doc
    # belongs to. Optional/additive — null for self-uploaded docs.
    unit_name: Optional[str] = None
    sha256: Optional[str] = None
    status: str = "PENDING"
    chunk_count: int = 0
    task_id: Optional[str] = None
    message: Optional[str] = None
    created_at: Optional[datetime] = None
    # Story 19: True when this row is a repository document linked into the
    # conversation by reference (vs a document uploaded into the conversation).
    # The FE uses it to skip the "processing" spinner and to show the
    # "Gỡ khỏi hội thoại" (unlink) menu instead of rename/delete.
    from_repository: bool = False

    model_config = {"from_attributes": True}


class DocumentListResponse(BaseModel):
    documents: list[DocumentOut]
    last_synced_at: Optional[datetime] = None
    syncResult: Optional[dict] = None


class DocumentsResponse(SuccessResponse):
    documents: list[DocumentOut]
    document_id: Optional[str] = None


class ProcessResponse(SuccessResponse):
    """Response for POST /{document_id}/process."""
    document_id: str
    status: str
    task_id: Optional[str] = None


class UpdateDocumentRequest(BaseModel):
    name: Optional[str] = None
    doc_number: Optional[str] = None
    summary: Optional[str] = None
    group_id: Optional[int] = None
    status: Optional[str] = None
    chunk_count: Optional[int] = None
    task_id: Optional[str] = None


class DocRepoItem(BaseModel):
    """A document row as shown in the admin "Quản lý kho tài liệu" screen."""
    id: str
    name: str
    doc_number: Optional[str] = None
    summary: Optional[str] = None
    group_id: Optional[int] = None
    group_name: Optional[str] = None
    # Story 78: which unit this document belongs to (shown as the "Đơn vị" column
    # in the super-admin/commander all-units view). None in the per-unit view.
    unit_name: Optional[str] = None
    created_at: Optional[datetime] = None
    # Story 34: processing status (UPLOADED/PENDING/PROCESSING/COMPLETED/ERROR)
    # so the admin screen can flag "chưa số hoá" and offer "Số hoá lại".
    # Optional/additive — older callers that omit it are unaffected.
    status: Optional[str] = None
    # Story 54: per-viewer "unread" flag (the admin has not opened this doc yet)
    # so the management screen can highlight it. Optional/additive — None when the
    # list was built without a viewer context (older callers unaffected).
    is_unread: Optional[bool] = None


class DocRepoListResponse(BaseModel):
    """Paginated envelope for the document-repository list."""
    items: list[DocRepoItem]
    total: int
    page: int
    page_size: int


class UpdateDocRepoRequest(BaseModel):
    """Schema for editing a repository document's metadata."""
    name: Optional[str] = None
    doc_number: Optional[str] = None
    summary: Optional[str] = None
    group_id: Optional[int] = None


class DocumentPreviewRequest(BaseModel):
    """Request model for document preview."""
    pass


class PagePreview(BaseModel):
    """Schema representing a page in the document preview.

    ``char_start``/``char_end`` locate this page inside the same source text a
    citation's offsets are measured in, so the viewer can convert one to the
    other by subtraction. Null when upstream does not publish them.
    """
    page_number: int
    content: Optional[str] = None
    char_start: Optional[int] = None
    char_end: Optional[int] = None


class DocumentPreviewResponse(BaseModel):
    """Response model for document preview."""
    name: str
    page_count: int
    summary: Optional[str] = None
    first_5_pages: list[PagePreview] = []


class DocumentPagesResponse(BaseModel):
    """Per-page digitized text for the viewer "Nội dung số hoá" tab.

    Reuses the upstream preview proxy (``document.pages[].content``). Returns as
    many pages as the upstream provides; see story 15 for the deferred
    all-pages upstream endpoint.
    """
    name: str
    page_count: int
    pages: list[PagePreview] = []


class RepoGroup(BaseModel):
    """A document group ("folder") in a unit repository tree (story 16)."""
    id: int
    name: str


class RepoDoc(BaseModel):
    """A repository document for the chat picker tree (story 16).

    ``group_id`` null = a flat document (left column); otherwise it lives under
    the matching :class:`RepoGroup` folder.
    """
    id: str
    name: str
    group_id: Optional[int] = None
    # Story 82: surface read-state + date so a regular user's read-only repo view
    # can highlight new documents (additive; the chat picker ignores them).
    created_at: Optional[datetime] = None
    is_unread: Optional[bool] = None
    # Story 93: columns/filter for the redesigned unit-repository screen — Trích
    # yếu (summary), Số văn bản (doc_number) and status (for the status filter).
    # Optional/additive so the chat picker (same RepoDoc) is unaffected.
    summary: Optional[str] = None
    doc_number: Optional[str] = None
    status: Optional[str] = None


class UnitRepoListResponse(BaseModel):
    """A unit's repository as a 2-level tree for the chat picker (story 16)."""
    groups: list[RepoGroup] = []
    documents: list[RepoDoc] = []


class LinkRepoDocsRequest(BaseModel):
    """Link selected repository documents into a conversation by reference."""
    document_ids: list[str] = []
    # Story 35: which unit's repository the docs come from. Super-admin sends the
    # focused unit; unit users/admins omit it (BE uses their own unit). A foreign
    # unit from a non-super caller is rejected (403) by the route resolver.
    unit_id: Optional[int] = None


class RepoSearchRequest(BaseModel):
    """Search a unit's repository by NAME + CONTENT (story 107).

    The route matches ``query`` against the document filename (a substring, on
    the caller's own candidate list) AND the document content (the AI semantic
    ``/search/documents`` endpoint), then returns the merged/deduped list.
    ``unit_id`` focuses a unit for a super-admin (a non-super foreign unit → 403).
    """
    query: str
    unit_id: Optional[int] = None
    top_k: int = 20


class UserDeleteImpact(BaseModel):
    """Related-data summary shown before deleting a user (story 108).

    ``documents`` = files the user uploaded (deleted for clean data);
    ``conversations`` = their personal conversations (cascade-deleted);
    ``owns_repo_units`` = names of units whose repository the user owns (the kho is
    KEPT — reassigned — only the user's own documents are removed).
    """
    documents: int = 0
    conversations: int = 0
    owns_repo_units: list[str] = []


# ══════════════════════════════════════════════════════════════════════
# Info Table
# ══════════════════════════════════════════════════════════════════════

class CreateInfoTableRequest(BaseModel):
    type: str
    name: str
    content: Optional[str] = None
    selected: Optional[Any] = None
    status: Optional[str] = None
    task_id: Optional[str] = None


class InfoTableOut(BaseModel):
    id: str
    conversation_id: Optional[int] = None
    type: str
    name: str
    content: Optional[str] = None
    selected: Optional[Any] = None
    status: str = "PENDING"
    task_id: Optional[str] = None
    date_created: Optional[datetime] = None
    date_updated: Optional[datetime] = None

    model_config = {"from_attributes": True}


class InfoTableListResponse(BaseModel):
    info_tables: list[InfoTableOut]


class CreateInfoTableResponse(SuccessResponse):
    info: InfoTableOut


class DeleteInfoTableResponse(SuccessResponse):
    removed: InfoTableOut


class UpdateInfoTableRequest(BaseModel):
    name: Optional[str] = None
    content: Optional[str] = None
    status: Optional[str] = None
    task_id: Optional[str] = None
    selected: Optional[Any] = None


class UpdateInfoTableResponse(SuccessResponse):
    info_tables: list[InfoTableOut]


# ══════════════════════════════════════════════════════════════════════
# Audit
# ══════════════════════════════════════════════════════════════════════

class AuditPagination(BaseModel):
    total: int
    page: int
    limit: int


class AuditLogResponse(BaseModel):
    data: list[dict]
    pagination: AuditPagination


# ══════════════════════════════════════════════════════════════════════
# LLM / Tools
# ══════════════════════════════════════════════════════════════════════

class StreamQueryRequest(BaseModel):
    """Body of a /query/stream request — flexible to accommodate AI service."""
    query: Optional[str] = None
    k: Optional[int] = None
    language: Optional[str] = None
    include_sources: Optional[bool] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    documents: Optional[list[str]] = None
    document_ids: Optional[list[str]] = None
    conversation_id: Optional[str] = None
    user_id: Optional[str] = None

    model_config = {"extra": "allow"}


class ToolStatusResponse(BaseModel):
    status: Optional[str] = None
    message: Optional[str] = None
    error: Optional[str] = None

    model_config = {"extra": "allow"}
