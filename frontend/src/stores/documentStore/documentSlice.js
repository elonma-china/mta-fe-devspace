// src/stores/documentStore/documentSlice.js
import {
  getConversationDocuments,
  deleteConversationDocument,
  renameConversationDocument,
} from "features/documents/api";
import {
  normalizePayload,
  extractPollingTasks,
  reconcileSelection,
  toId,
} from "./helpers";

/**
 * Document slice — owns documents[], conversationId, loading,
 * numDocuments, pending[], and the core fetch / CRUD / reset actions.
 *
 * @param {Function} set — Zustand set
 * @param {Function} get — Zustand get
 * @returns {object} slice state + actions
 */
export const createDocumentSlice = (set, get) => ({
  // ── State ──
  documents: [],
  conversationId: null,
  loading: false,
  numDocuments: 0,
  pending: [],

  // ── Actions ──

  /**
   * Fetch documents for a conversation.
   *
   * On conversation change the previous list is cleared immediately
   * to prevent stale UI flashes.  After the API response arrives an
   * atomic `set()` reconciles documents, polling tasks and selection.
   *
   * @param {string}        userId
   * @param {string|number} conversationId
   * @returns {Promise<{ documents: object[], syncResult: *|null }>}
   */
  fetchDocuments: async (userId, conversationId) => {
    // Clear stale data when switching conversations
    if (get().conversationId !== conversationId) {
      set({
        documents: [],
        numDocuments: 0,
        conversationId,
        loading: true,
        selectedDocumentIds: [],
        selectionInitialized: false,
      });
    } else {
      set({ loading: true });
    }

    if (!userId || !conversationId) {
      set({ loading: false });
      return { documents: [], syncResult: null };
    }

    try {
      const payload = await getConversationDocuments(
        userId,
        conversationId,
      );

      // Discard if user navigated away during the request
      if (get().conversationId !== conversationId) {
        return { documents: [], syncResult: null };
      }

      const docs = normalizePayload(payload);
      const newPollingTasks = extractPollingTasks(docs);

      // Atomic state update — closes the race window between
      // the guard above and the actual write
      set((s) => {
        if (s.conversationId !== conversationId) return s;

        const selection = reconcileSelection(s, docs);

        return {
          documents: docs,
          numDocuments: docs.length,
          loading: false,
          pollingTasks: Object.keys(newPollingTasks).length
            ? newPollingTasks
            : {},
          ...selection,
        };
      });

      return {
        documents: docs,
        syncResult: payload?.syncResult,
      };
    } catch (e) {
      console.error("getConversationDocuments failed:", e);
      if (get().conversationId === conversationId) {
        set({ documents: [], numDocuments: 0, loading: false });
      }
      return { documents: [], syncResult: null };
    }
  },

  /**
   * Delete a document and remove it from both the list and selection.
   *
   * @param {string}        userId
   * @param {string|number} conversationId
   * @param {string|number} docId
   */
  deleteDocument: async (userId, conversationId, docId) => {
    try {
      await deleteConversationDocument(
        userId,
        conversationId,
        docId,
      );
      set((s) => ({
        documents: s.documents.filter(
          (d) => toId(d.id) !== toId(docId),
        ),
        numDocuments: Math.max(0, s.numDocuments - 1),
        selectedDocumentIds: s.selectedDocumentIds.filter(
          (id) => toId(id) !== toId(docId),
        ),
      }));
    } catch (e) {
      console.error("Delete document failed:", e);
      throw e;
    }
  },

  /**
   * Rename a document in-place.
   *
   * @param {string}        userId
   * @param {string|number} conversationId
   * @param {string|number} docId
   * @param {string}        newName
   */
  renameDocument: async (
    userId,
    conversationId,
    docId,
    newName,
  ) => {
    try {
      await renameConversationDocument(
        userId,
        conversationId,
        docId,
        newName,
      );
      set((s) => ({
        documents: s.documents.map((d) =>
          toId(d.id) === toId(docId)
            ? { ...d, name: newName }
            : d,
        ),
      }));
    } catch (e) {
      console.error("Rename document failed:", e);
      throw e;
    }
  },

  /**
   * Reset all document state (called on conversation switch).
   */
  clearDocuments: () => {
    get().disconnectSSE?.();
    set({
      documents: [],
      conversationId: null,
      selectedDocumentIds: [],
      selectionInitialized: false,
      numDocuments: 0,
      pollingTasks: {},
      pending: [],
    });
  },
});
