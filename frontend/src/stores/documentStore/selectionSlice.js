// src/stores/documentStore/selectionSlice.js

/**
 * Selection slice — owns selectedDocumentIds and selectionInitialized.
 *
 * @param {Function} set  — Zustand set
 * @returns {object} slice state + actions
 */
export const createSelectionSlice = (set) => ({
  // ── State ──
  selectedDocumentIds: [],
  selectionInitialized: false,

  // ── Actions ──

  /**
   * Replace or functionally update the selected document IDs.
   *
   * @param {string[]|Function} ids — new array or updater fn
   */
  setSelectedDocumentIds: (ids) =>
    set((s) => ({
      selectedDocumentIds:
        typeof ids === "function"
          ? ids(s.selectedDocumentIds)
          : ids,
      selectionInitialized: true,
    })),
});
