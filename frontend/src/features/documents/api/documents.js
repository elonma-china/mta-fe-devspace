// src/features/documents/api/documents.js
import { apiClient } from "lib/apiClient";

// --- TASKS (Document Processing Status) ---
export const getDocumentTaskStatus = (taskId, startTime) => 
  apiClient.get(`/task/${taskId}`, { params: { startTime } });

// --- CONVERSATION DOCUMENTS ---
export const getConversationDocuments = (userId, convId) =>
  apiClient.get(`/users/${userId}/conversations/${convId}/documents`);

export const deleteConversationDocument = (userId, convId, docId) =>
  apiClient.delete(`/users/${userId}/conversations/${convId}/documents/${docId}`);

export const renameConversationDocument = (userId, convId, docId, name) =>
  apiClient.patch(`/users/${userId}/conversations/${convId}/documents/${docId}`, { name });

export const updateDocumentStatus = (userId, convId, docId, data) => 
  apiClient.patch(`/users/${userId}/conversations/${convId}/documents/${docId}`, data);

export const uploadConversationFile = (userId, convId, file) => {
  const fd = new FormData();
  fd.append("file", file);
  return apiClient.post(`/users/${userId}/conversations/${convId}/documents/upload`, fd);
};

export const uploadConversationFiles = async (userId, convId, files) => {
  const list = Array.isArray(files) ? files : [files];
  return Promise.all(list.map((file) => uploadConversationFile(userId, convId, file)));
};

export const processDocument = (userId, convId, docId) =>
  apiClient.post(`/users/${userId}/conversations/${convId}/documents/${docId}/process`);

export const previewDocument = (userId, convId, docId) =>
  apiClient.post(`/users/${userId}/conversations/${convId}/documents/${docId}/preview`);

// --- DOCUMENT VIEWER (story 15 / 22) ---
// Per-page digitized text ("Nội dung đã số hóa" tab). The BE sources the FULL
// per-page text from the AI ingest document detail (story 22).
export const getDocumentPages = (userId, convId, docId) =>
  apiClient.get(
    `/users/${userId}/conversations/${convId}/documents/${docId}/pages`
  );

/**
 * Fetch the original document file ("File gốc" tab) as a Blob (story 22).
 *
 * The BE proxies the AI ingest ``/file`` endpoint (e.g. a PDF). We fetch it as
 * a blob (auth header) and wrap it in an object URL because <iframe>/<img>
 * src cannot carry the Authorization header.
 *
 * @param {string|number} userId
 * @param {string|number} convId
 * @param {string|number} docId
 * @returns {Promise<Blob>}
 */
export const fetchDocumentFile = (userId, convId, docId) =>
  apiClient.getBlob(
    `/users/${userId}/conversations/${convId}/documents/${docId}/file`
  );

/**
 * Fetch a single page's preview image (thumbnail rail) as a Blob (story 25).
 *
 * The BE proxies the AI ingest ``/pages/{n}/image`` endpoint. Like the original
 * file, we fetch it as a blob (auth header) because an <img> src cannot carry
 * the Authorization header. Upstream 404 (no image yet) / 5xx surface as the
 * api client's error, so the viewer can fall back to a page-number thumbnail.
 *
 * @param {string|number} userId
 * @param {string|number} convId
 * @param {string|number} docId
 * @param {number} pageNo  1-based page number
 * @returns {Promise<Blob>}
 */
export const fetchPageImage = (userId, convId, docId, pageNo) =>
  apiClient.getBlob(
    `/users/${userId}/conversations/${convId}/documents/${docId}` +
      `/pages/${pageNo}/image`
  );

// --- CHAT REPOSITORY DOCS (story 16) ---
// List a unit's repository as a 2-level tree (groups + docs). Story 35: a
// super-admin passes `unitId` to focus a unit; a unit user/admin omits it (the
// BE uses their own unit, and rejects a foreign unit with 403).
export const getUnitRepositoryDocuments = (unitId) =>
  apiClient.get(
    `/repository/documents${unitId != null ? `?unit_id=${unitId}` : ""}`
  );

// --- CHAT REPOSITORY SEMANTIC SEARCH (story 107) ---
// Search a unit's repository by NAME + CONTENT. The BE merges a filename match
// (over the caller's own repository) with the AI semantic content search
// (/api/v1/search/documents) and returns a ranked, de-duplicated, unit-scoped
// document list — the SAME shape as the tree's `documents` (so the picker reuses
// its row/selection render). `unitId` (optional) focuses a unit for a
// super-admin; `topK` (optional) caps the content results.
export const searchUnitRepositoryDocuments = (query, unitId, topK) =>
  apiClient.post("/repository/documents/search", {
    query,
    ...(unitId != null ? { unit_id: unitId } : {}),
    ...(topK != null ? { top_k: topK } : {}),
  });

// --- USER REPOSITORY VIEWER (story 82) ---
// A regular user views their own unit's repository documents read-only. These
// mirror the admin viewer routes (story 39) but go through `get_current_user` +
// `find_visible` on the BE, which scopes a regular user to their OWN unit only.
// Injected into the shared DocumentViewer as `loaders`.

// Per-page digitized text ("Nội dung đã số hóa").
export const getUnitRepositoryDocumentPages = (docId) =>
  apiClient.get(`/repository/documents/${docId}/pages`);

// Original file ("File gốc") as a Blob (auth header — <iframe>/<img> can't).
export const fetchUnitRepositoryDocumentFile = (docId) =>
  apiClient.getBlob(`/repository/documents/${docId}/file`);

// A single page's preview image as a Blob. 1-based pageNo.
export const fetchUnitRepositoryPageImage = (docId, pageNo) =>
  apiClient.getBlob(`/repository/documents/${docId}/pages/${pageNo}/image`);

// Link selected repository docs into a conversation by reference (no copy).
// Story 35: `unitId` (optional) scopes the validation to that unit's repository
// for a super-admin; omitted for a unit user/admin.
export const linkRepositoryDocs = (userId, convId, documentIds, unitId) =>
  apiClient.post(
    `/users/${userId}/conversations/${convId}/documents/link-repository`,
    unitId != null
      ? { document_ids: documentIds, unit_id: unitId }
      : { document_ids: documentIds }
  );

// Unlink one repository doc from a conversation ("Gỡ khỏi hội thoại") — removes
// the reference link only; the repository document itself is untouched.
export const unlinkRepositoryDoc = (userId, convId, docId) =>
  apiClient.delete(
    `/users/${userId}/conversations/${convId}/documents/${docId}/link-repository`
  );

/**
 * Build the SSE EventSource URL for document status events.
 *
 * @param {string|number} userId
 * @param {string|number} convId
 * @param {string[]}      [docIds=[]] — document IDs for initial snapshot
 * @returns {string} absolute URL suitable for `new EventSource(url)`
 */
export const getDocumentEventsURL = (userId, convId, docIds = []) => {
  const base = `/db/users/${userId}/conversations/${convId}/documents/events`;
  const params = new URLSearchParams();
  if (docIds.length) params.set("doc_ids", docIds.join(","));
  const token = localStorage.getItem("token");
  if (token) params.set("token", token);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
};