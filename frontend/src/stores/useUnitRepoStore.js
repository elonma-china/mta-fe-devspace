// src/stores/useUnitRepoStore.js
import { create } from "zustand";

import { getUnitRepositoryDocuments } from "features/documents/api";
import { markRepositoryDocumentRead } from "features/admin/api";
import { useDocRepoStore } from "stores/useDocRepoStore";

/**
 * Zustand store for a regular user's READ-ONLY view of their OWN unit's document
 * repository (story 82). Distinct from the admin {@link useDocRepoStore}
 * (paginated CRUD) and the chat picker store — this only lists + marks-read.
 *
 * The list endpoint (`GET /repository/documents`) returns `{ groups, documents }`
 * scoped by the backend to the caller's own unit; each document carries an
 * `is_unread` flag (story 82) so newly-uploaded documents can be highlighted.
 * All network access lives in the actions — the page never fetches directly.
 */
export const useUnitRepoStore = create((set, get) => ({
  documents: [],
  groups: [],
  loading: false,
  error: null,

  /** Load the current user's unit repository (own unit → no unit_id sent). */
  fetchDocuments: async () => {
    set({ loading: true, error: null });
    try {
      const data = await getUnitRepositoryDocuments();
      set({
        documents: data?.documents || [],
        groups: data?.groups || [],
        loading: false,
      });
    } catch (e) {
      set({
        error: e?.message || "Tải danh sách tài liệu thất bại",
        loading: false,
      });
    }
  },

  /**
   * Mark a document read when the user opens it. Optimistically clears the row's
   * `is_unread` flag and decrements the shared header badge (the single source
   * for the count is {@link useDocRepoStore}, polled by the Header) so the UI
   * updates without a refetch, then POSTs. Best-effort: a failed POST is logged,
   * not rethrown (viewing is primary, read-tracking secondary). The decrement
   * only happens when the row was actually unread, so it never goes negative.
   */
  markRead: async (id) => {
    const doc = get().documents.find((d) => d.id === id);
    const wasUnread = doc?.is_unread === true;
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === id ? { ...d, is_unread: false } : d
      ),
    }));
    if (wasUnread) {
      useDocRepoStore.setState((s) => ({
        unreadCount: Math.max(0, s.unreadCount - 1),
      }));
    }
    try {
      await markRepositoryDocumentRead(id);
    } catch (e) {
      // Best-effort: reading is secondary to viewing; don't block or rethrow.
      console.warn("[unitRepo] markRead failed", id, e);
    }
  },
}));

export default useUnitRepoStore;
