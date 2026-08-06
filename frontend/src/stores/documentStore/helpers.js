// src/stores/documentStore/helpers.js
import { PROCESSING_STATUS } from "constants/status";

/**
 * Coerce any value to a string ID.
 * Single point of coercion to avoid scattered `String(x)` calls.
 *
 * @param {*} value
 * @returns {string}
 */
export const toId = (value) => String(value);

/**
 * Returns true when the status represents an in-progress document.
 *
 * @param {string|undefined} status — raw or uppercased status string
 * @returns {boolean}
 */
export const isActiveStatus = (status) => {
  const upper = status?.toUpperCase();
  return (
    upper === PROCESSING_STATUS.PROCESSING ||
    upper === PROCESSING_STATUS.PENDING
  );
};

/**
 * Normalize the varying API response shapes into a plain array of
 * document objects.
 *
 * Handles: `payload` (array), `payload.documents` (array), or `[]`.
 *
 * @param {*} payload — raw response from getConversationDocuments
 * @returns {object[]}
 */
export const normalizePayload = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.documents)) return payload.documents;
  return [];
};

/**
 * Build a `Record<docId, { taskId, createdAt }>` from documents that
 * are still processing and have a `task_id`.
 *
 * @param {object[]} docs
 * @returns {Record<string, { taskId: string, createdAt: string }>}
 */
export const extractPollingTasks = (docs) => {
  const tasks = {};
  docs.forEach((doc) => {
    if (isActiveStatus(doc.status) && doc.task_id) {
      tasks[toId(doc.id)] = {
        taskId: doc.task_id,
        createdAt: doc.created_at,
      };
    }
  });
  return tasks;
};

/**
 * Reconcile the selection list after a fresh fetch.
 *
 * - First load (`!selectionInitialized`): auto-select every COMPLETED doc.
 * - Subsequent loads: auto-add documents that just transitioned from
 *   PROCESSING/PENDING/UPLOADED → COMPLETED.
 *
 * @param {object}   state     — current store slice
 * @param {object[]} freshDocs — newly fetched documents
 * @returns {{ selectedDocumentIds: string[], selectionInitialized: boolean }}
 */
export const reconcileSelection = (state, freshDocs) => {
  const { selectedDocumentIds, selectionInitialized, documents } =
    state;

  // First load: select all completed docs
  if (!selectionInitialized && !selectedDocumentIds?.length && freshDocs.length) {
    return {
      selectedDocumentIds: freshDocs
        .filter(
          (d) =>
            d.status?.toUpperCase() === PROCESSING_STATUS.COMPLETED,
        )
        .map((d) => toId(d.id)),
      selectionInitialized: true,
    };
  }

  // Subsequent loads: auto-add newly completed docs
  const newlyCompletedIds = freshDocs
    .filter((d) => {
      if (d.status?.toUpperCase() !== PROCESSING_STATUS.COMPLETED) {
        return false;
      }
      const oldDoc = documents.find(
        (old) => toId(old.id) === toId(d.id),
      );
      if (!oldDoc) return false;
      const oldStatus = oldDoc.status?.toUpperCase();
      return (
        oldStatus === PROCESSING_STATUS.PROCESSING ||
        oldStatus === PROCESSING_STATUS.PENDING ||
        oldStatus === PROCESSING_STATUS.UPLOADED
      );
    })
    .map((d) => toId(d.id));

  if (newlyCompletedIds.length > 0) {
    return {
      selectedDocumentIds: Array.from(
        new Set([
          ...selectedDocumentIds.map(toId),
          ...newlyCompletedIds,
        ]),
      ),
      selectionInitialized,
    };
  }

  return { selectedDocumentIds, selectionInitialized };
};
