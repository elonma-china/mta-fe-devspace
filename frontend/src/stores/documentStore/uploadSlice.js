// src/stores/documentStore/uploadSlice.js
import {
  uploadConversationFile,
  processDocument,
} from "features/documents/api";
import { PROCESSING_STATUS } from "constants/status";
import { toId, isActiveStatus } from "./helpers";

/**
 * Upload slice — owns the two-phase upload + process orchestration.
 *
 * Phase 1 — Upload: POST /upload for each file → status = UPLOADED
 * Phase 2 — Process: POST /{document_id}/process → status = PROCESSING
 *
 * @param {Function} set — Zustand set
 * @param {Function} get — Zustand get
 * @returns {object} slice actions (no additional state)
 */
export const createUploadSlice = (set, get) => ({
  /**
   * Upload one or more files to an existing conversation, then
   * automatically trigger processing for each uploaded document.
   *
   * @param {string}        userId
   * @param {string|number} conversationId — must be non-null
   * @param {File[]}        files
   * @param {object}        opts
   * @param {Function}      [opts.onError] — (message) => void
   * @returns {Promise<{convId, successCount, errorCount, errors}>}
   */
  uploadFiles: async (
    userId,
    conversationId,
    files,
    opts = {},
  ) => {
    // Guard: conversation must exist
    if (!conversationId) {
      const msg =
        "Vui lòng tạo hoặc chọn một sổ ghi chú trước khi tải tài liệu.";
      opts.onError?.(msg);
      return {
        convId: null,
        successCount: 0,
        errorCount: Array.isArray(files) ? files.length : 1,
        errors: [msg],
      };
    }

    const list = Array.isArray(files) ? files : [files];
    const ts = Date.now();
    const newPending = list.map((f, idx) => ({
      id: `pending-${ts}-${idx}`,
      name: f.name,
      _pending: true,
    }));

    // Add pending placeholders
    set((s) => ({ pending: [...s.pending, ...newPending] }));

    const uploadErrors = [];
    const uploadedDocIds = [];

    // Phase 1: Upload each file
    const uploadPromises = list.map((file, idx) =>
      (async () => {
        try {
          const resp = await uploadConversationFile(
            userId,
            conversationId,
            file,
          );
          const respDocs = Array.isArray(resp?.documents)
            ? resp.documents
            : [];
          const documentId = resp?.document_id;

          if (documentId) {
            uploadedDocIds.push(documentId);
          }

          // Pending → documents (status = UPLOADED)
          set((s) => {
            const nextPending = s.pending.filter(
              (p) => p.id !== newPending[idx].id,
            );

            // If user switched conversations, just remove pending
            if (s.conversationId !== conversationId) {
              return { pending: nextPending };
            }

            // Story 28: the upload response carries only find_by_conversation
            // docs — NOT linked repository docs (only the list route appends
            // those). Replacing the list wholesale would drop repo docs the
            // user picked from the kho. Keep existing from_repository docs that
            // aren't in the response (dedup by id).
            let docsToApply =
              respDocs.length > 0 ? respDocs : s.documents;
            if (respDocs.length > 0) {
              const respIds = new Set(respDocs.map((d) => toId(d.id)));
              const keptRepo = s.documents.filter(
                (d) => d.from_repository && !respIds.has(toId(d.id)),
              );
              if (keptRepo.length) {
                docsToApply = [...respDocs, ...keptRepo];
              }
            }

            return {
              pending: nextPending,
              documents: docsToApply,
              numDocuments: docsToApply.length,
            };
          });

          return { success: true, documentId };
        } catch (e) {
          console.error("Upload document failed:", e);
          const msg =
            e.message ||
            `Thêm tài liệu "${file.name}" thất bại`;
          uploadErrors.push(msg);
          // Remove failed pending placeholder
          set((s) => ({
            pending: s.pending.filter(
              (p) => p.id !== newPending[idx].id,
            ),
          }));
          return { success: false };
        }
      })(),
    );

    await Promise.all(uploadPromises);

    // Per-document outcome: each file is counted exactly once. A file that
    // fails Phase 1 is an upload failure and is never processed. A file that
    // uploads is then processed in Phase 2, where it lands in exactly one of
    // success/failure. So upload failures and processing outcomes are
    // disjoint and never double-count a single document.
    let successCount = 0;
    const errors = [...uploadErrors];

    // Phase 2: Auto-trigger processing
    if (uploadedDocIds.length > 0) {
      const processResult = await get().processDocuments(
        userId,
        conversationId,
        uploadedDocIds,
        opts,
      );
      successCount = processResult.successCount;
      if (processResult.errors?.length) {
        errors.push(...processResult.errors);
      }
    }

    return {
      convId: conversationId,
      successCount,
      errorCount: errors.length,
      errors,
    };
  },

  /**
   * Trigger processing for uploaded documents.
   * Calls POST /{document_id}/process for each document_id.
   *
   * @param {string}        userId
   * @param {string|number} conversationId
   * @param {string[]}      documentIds
   * @param {object}        opts
   * @param {Function}      [opts.onError]
   * @returns {Promise<{successCount, errorCount, errors}>}
   */
  processDocuments: async (
    userId,
    conversationId,
    documentIds,
    opts = {},
  ) => {
    const processErrors = [];

    const processPromises = documentIds.map((docId) =>
      (async () => {
        try {
          const resp = await processDocument(
            userId,
            conversationId,
            docId,
          );
          const status =
            resp?.status?.toUpperCase() ||
            PROCESSING_STATUS.PROCESSING;
          const taskId = resp?.task_id;

          set((s) => {
            if (s.conversationId !== conversationId) return s;

            const nextDocs = s.documents.map((d) =>
              toId(d.id) === toId(docId)
                ? { ...d, status, task_id: taskId }
                : d,
            );

            const mergedPolling = { ...s.pollingTasks };
            if (isActiveStatus(status) && taskId) {
              mergedPolling[toId(docId)] = {
                taskId,
                createdAt: new Date().toISOString(),
              };
            }

            return {
              documents: nextDocs,
              pollingTasks: mergedPolling,
            };
          });

          return { success: true };
        } catch (e) {
          console.error("Process document failed:", e);
          const msg =
            e.message ||
            `Xử lý tài liệu ${docId} thất bại`;
          processErrors.push(msg);

          // Mark the document as failed so the UI stops showing a spinner
          // (UPLOADED/PROCESSING/PENDING all render as loading). Without
          // this the doc is stuck loading forever, since no polling task
          // is started on a failed process.
          set((s) => {
            if (s.conversationId !== conversationId) return s;
            const nextDocs = s.documents.map((d) =>
              toId(d.id) === toId(docId)
                ? { ...d, status: PROCESSING_STATUS.ERROR, message: msg }
                : d,
            );
            return { documents: nextDocs };
          });

          return { success: false };
        }
      })(),
    );

    const results = await Promise.all(processPromises);
    const successCount = results.filter(
      (r) => r.success,
    ).length;

    return {
      successCount,
      errorCount: processErrors.length,
      errors: processErrors,
    };
  },
});
