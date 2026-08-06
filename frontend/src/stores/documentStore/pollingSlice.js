// src/stores/documentStore/pollingSlice.js
import { PROCESSING_STATUS } from "constants/status";
import { toId } from "./helpers";

/**
 * Polling slice — owns pollingTasks state and status-update logic.
 *
 * `updateDocumentStatus` lives here because a COMPLETED transition
 * also auto-adds the doc to selectedDocumentIds.
 *
 * @param {Function} set  — Zustand set
 * @returns {object} slice state + actions
 */
export const createPollingSlice = (set) => ({
  // ── State ──
  pollingTasks: {},

  // ── Actions ──

  /**
   * Register a new polling task for a document.
   *
   * @param {string|number} docId
   * @param {string}        taskId
   * @param {string}        createdAt — ISO timestamp
   */
  startPolling: (docId, taskId, createdAt) =>
    set((s) => ({
      pollingTasks: {
        ...s.pollingTasks,
        [toId(docId)]: { taskId, createdAt },
      },
    })),

  /**
   * Remove a document's polling task (processing finished).
   *
   * @param {string|number} docId
   */
  completePolling: (docId) =>
    set((s) => {
      const next = { ...s.pollingTasks };
      delete next[toId(docId)];
      return { pollingTasks: next };
    }),

  /**
   * Update a single document's status in the store and, when it
   * transitions to COMPLETED, auto-select it.
   *
   * @param {string|number} docId
   * @param {string}        status
   * @param {object}        [extraData={}]
   */
  updateDocumentStatus: (docId, status, extraData = {}) =>
    set((s) => {
      const nextDocs = s.documents.map((d) =>
        toId(d.id) === toId(docId)
          ? { ...d, status, ...extraData }
          : d,
      );

      let nextSelected = s.selectedDocumentIds;
      if (
        status?.toUpperCase() === PROCESSING_STATUS.COMPLETED
      ) {
        nextSelected = Array.from(
          new Set([
            ...s.selectedDocumentIds.map(toId),
            toId(docId),
          ]),
        );
      }

      return {
        documents: nextDocs,
        selectedDocumentIds: nextSelected,
      };
    }),
});
