// src/features/admin/api/admin.js
import { apiClient } from "lib/apiClient";

/* ======================= USERS ======================= */
export const listUsers = () => 
  apiClient.get("/users");

export const getUserById = (id) => 
  apiClient.get(`/users/${id}`);

export const createUser = (user) => 
  apiClient.post("/users", user);

export const updateUser = (id, payload) => 
  apiClient.put(`/users/${id}`, payload);

export const deleteUser = (id) =>
  apiClient.delete(`/users/${id}`);

// Story 108: related-data summary shown before deleting a user (documents /
// personal conversations / owned unit repositories) → drives the warning message.
export const getUserDeleteImpact = (id) =>
  apiClient.get(`/users/${id}/delete-impact`);

/* ======================= AUDIT ======================= */
export const getAuditLogs = (params) => 
  apiClient.get("/audit-logs", { params });

export const getAuditLogFields = () => 
  apiClient.get("/audit-logs/fields");

/* ======================= UNITS & ROLES ======================= */
export const getUnits = ({ search, page, page_size } = {}) => {
  const params = {};
  if (search) params.search = search;
  if (page) params.page = page;
  if (page_size) params.page_size = page_size;
  return apiClient.get("/units", { params });
};

export const createUnit = (payload) =>
  apiClient.post("/units", payload);

export const updateUnit = (id, payload) =>
  apiClient.put(`/units/${id}`, payload);

export const deleteUnit = (id, transferToUnitId) => {
  const suffix =
    transferToUnitId != null ? `?transfer_to_unit_id=${transferToUnitId}` : "";
  return apiClient.delete(`/units/${id}${suffix}`);
};

export const getAdminCandidates = (unitId) =>
  apiClient.get(`/units/${unitId}/admin-candidates`);

export const getRoles = () =>
  apiClient.get("/roles");

/* ================== DOCUMENT GROUPS (nhóm tài liệu) ================== */
export const getGroups = ({ search, page, page_size, unit_id } = {}) => {
  const params = {};
  if (search) params.search = search;
  if (page) params.page = page;
  if (page_size) params.page_size = page_size;
  // Story 77: groups are unit-scoped. Super-admin/commander send the focused
  // unit; a unit admin omits it (the backend uses their own unit).
  if (unit_id != null) params.unit_id = unit_id;
  return apiClient.get("/document-groups", { params });
};

// payload: { name, unit_id? } — unit_id is the focused unit for super-admin/
// commander; omitted for a unit admin (story 77).
export const createGroup = (payload) =>
  apiClient.post("/document-groups", payload);

export const updateGroup = (id, payload) =>
  apiClient.put(`/document-groups/${id}`, payload);

export const deleteGroup = (id) =>
  apiClient.delete(`/document-groups/${id}`);

/* ============ DOCUMENT REPOSITORY (kho tài liệu) ============ */
export const getRepositoryDocuments = ({
  search,
  group_ids,
  unit_id,
  page,
  page_size,
} = {}) => {
  // Build the query string by hand so multiple group_ids become repeated keys
  // (?group_ids=1&group_ids=2), which FastAPI parses as a list.
  const qs = new URLSearchParams();
  if (search) qs.append("search", search);
  if (page) qs.append("page", page);
  if (page_size) qs.append("page_size", page_size);
  // unit_id is the super-admin focus unit; unit admins omit it.
  if (unit_id != null) qs.append("unit_id", unit_id);
  (group_ids || []).forEach((id) => qs.append("group_ids", id));
  const suffix = qs.toString();
  return apiClient.get(`/admin/documents${suffix ? `?${suffix}` : ""}`);
};

export const uploadRepositoryDocument = (formData, unit_id, group_id) => {
  const qs = new URLSearchParams();
  if (unit_id != null) qs.append("unit_id", unit_id);
  // Story 45: when uploading from a group-scoped repository view, default the
  // new document into that group (BE reads ?group_id=).
  if (group_id != null) qs.append("group_id", group_id);
  const suffix = qs.toString();
  return apiClient.post(
    `/admin/documents/upload${suffix ? `?${suffix}` : ""}`,
    formData
  );
};

export const updateRepositoryDocument = (id, payload) =>
  apiClient.put(`/admin/documents/${id}`, payload);

export const deleteRepositoryDocument = (id) =>
  apiClient.delete(`/admin/documents/${id}`);

export const replaceRepositoryDocumentFile = (id, file) => {
  const formData = new FormData();
  formData.append("file", file);
  return apiClient.post(`/admin/documents/${id}/replace`, formData);
};

// Story 34: (re)process a stored repository document so it gets chunked + page
// images (e.g. one stuck UPLOADED). Idempotent on the BE; returns the doc with
// its new status.
export const processRepositoryDocument = (id) =>
  apiClient.post(`/admin/documents/${id}/process`);

// Story 46: sync a repository document's processing status from AI ingest. The
// BE reads the upstream task/document and writes COMPLETED/ERROR back when
// terminal, then returns the document. Idempotent; safe to poll.
export const getRepositoryDocumentStatus = (id) =>
  apiClient.get(`/admin/documents/${id}/status`);

// Story 48: mark a COMPLETED repository document as APPROVED ("Đã duyệt") — a
// manual admin review. The BE rejects (409) any doc not yet COMPLETED.
export const approveRepositoryDocument = (id) =>
  apiClient.post(`/admin/documents/${id}/approve`);

// Story 54/82: how many repository documents the CURRENT user has NOT read yet —
// drives the unread badge on the "Kho tài liệu" header button. Story 82 repoints
// this to the GENERAL endpoint (get_current_user) so it serves BOTH an admin and
// a regular user; both go through the same `count_unread_repo_documents` scope
// (`_repo_conv_ids_for`), so the admin badge value is unchanged. Returns { count }.
export const getRepositoryUnreadCount = () =>
  apiClient.get("/repository/documents/unread-count");

// Story 54: mark a repository document as read by the CURRENT user (any role —
// an admin in the repo screen, or a regular user opening a linked repo doc in
// chat). Idempotent; the BE gates visibility (not viewable → 404).
export const markRepositoryDocumentRead = (id) =>
  apiClient.post(`/repository/documents/${id}/read`);

/* ===== DOCUMENT VIEWER (story 39) — view a repo doc in "Quản lý kho tài liệu" =
 * Admin-scoped read routes (require_admin + find_visible on the BE), so the same
 * DocumentViewer used in chat can render a repo document. Shapes match the chat
 * viewer routes (pages text / original file blob / page image blob). */

// Per-page digitized text ("Nội dung đã số hóa").
export const getAdminDocumentPages = (id) =>
  apiClient.get(`/admin/documents/${id}/pages`);

// Original file ("File gốc") as a Blob (auth header — <iframe>/<img> can't).
export const fetchAdminDocumentFile = (id) =>
  apiClient.getBlob(`/admin/documents/${id}/file`);

// A single page's preview image (thumbnail rail) as a Blob. 1-based pageNo.
export const fetchAdminPageImage = (id, pageNo) =>
  apiClient.getBlob(`/admin/documents/${id}/pages/${pageNo}/image`);