// src/stores/useChatRepoStore.js
import { create } from "zustand";

import {
  getUnitRepositoryDocuments,
  linkRepositoryDocs,
  searchUnitRepositoryDocuments,
} from "features/documents/api";
import {
  toggleDoc,
  toggleGroup,
  toggleAll,
} from "features/documents/components/repoPicker/repoTree";

/**
 * Zustand store for the chat-side repository picker (story 16).
 *
 * Distinct from the admin ``useDocRepoStore`` (admin repository management) and
 * the conversation-bound ``useDocumentStore`` — this drives the "Chọn tài liệu
 * kho" modal where a member browses their own unit's repository as a 2-level
 * tree and links selected docs into the active conversation by reference.
 *
 * All network access lives in the actions; components never fetch directly.
 */
const useChatRepoStore = create((set, get) => ({
  groups: [],
  documents: [],
  openFolderId: null, // which folder's docs fill the right column
  selectedIds: [],
  loading: false,
  error: null,
  importing: false,
  // Story 107: semantic search (name + content). Kept SEPARATE from the tree
  // (`groups`/`documents`) so clearing the query restores the tree instantly
  // without a refetch. `searchResults` is the BE-merged, ranked, deduped list.
  searchResults: [],
  searching: false,
  searchError: null,

  /**
   * Fetch a unit repository tree. Story 35: pass `unitId` for a super-admin's
   * focused unit; omit it for a unit user/admin (BE uses their own unit).
   */
  fetchRepo: async (unitId) => {
    set({ loading: true, error: null });
    try {
      const data = await getUnitRepositoryDocuments(unitId);
      set({
        groups: data?.groups || [],
        documents: data?.documents || [],
        loading: false,
      });
      return data;
    } catch (e) {
      console.error("fetchRepo failed:", e);
      set({
        loading: false,
        error: e?.message || "Không tải được kho tài liệu.",
        groups: [],
        documents: [],
      });
      return null;
    }
  },

  openFolder: (groupId) => set({ openFolderId: groupId }),

  toggleDocSelection: (docId) =>
    set((s) => ({ selectedIds: toggleDoc(s.selectedIds, docId) })),

  toggleFolderSelection: (groupId) =>
    set((s) => ({
      selectedIds: toggleGroup(s.selectedIds, s.documents, groupId),
    })),

  toggleSelectAll: () =>
    set((s) => ({ selectedIds: toggleAll(s.selectedIds, s.documents) })),

  /**
   * Link the selected repository docs into a conversation (reference, not
   * copy), then let the caller refetch the conversation document list.
   *
   * @returns {Promise<boolean>} true on success
   */
  importSelected: async (userId, convId, unitId) => {
    const { selectedIds } = get();
    if (!selectedIds.length || !userId || !convId) return false;
    set({ importing: true, error: null });
    try {
      await linkRepositoryDocs(userId, convId, selectedIds, unitId);
      set({ importing: false, selectedIds: [] });
      return true;
    } catch (e) {
      console.error("importSelected failed:", e);
      set({
        importing: false,
        error: e?.message || "Không thêm được tài liệu kho vào hội thoại.",
      });
      return false;
    }
  },

  /**
   * Search the unit repository by NAME + CONTENT (story 107).
   *
   * Delegates to the BE, which merges a filename match with the AI semantic
   * content search and returns a ranked, deduped, unit-scoped list. An empty /
   * whitespace query short-circuits to a cleared result (the component shows the
   * tree instead). On error the component falls back to a client-side filename
   * filter, so search never fully breaks.
   *
   * @param {string} query
   * @param {number} [unitId] focused unit for a super-admin
   */
  searchRepo: async (query, unitId) => {
    const q = (query || "").trim();
    if (!q) {
      set({ searchResults: [], searching: false, searchError: null });
      return;
    }
    set({ searching: true, searchError: null });
    try {
      const data = await searchUnitRepositoryDocuments(q, unitId);
      set({ searchResults: data?.documents || [], searching: false });
    } catch (e) {
      console.error("searchRepo failed:", e);
      set({
        searching: false,
        searchError: e?.message || "Không tìm được tài liệu.",
      });
    }
  },

  /** Clear the search results/state (on empty query or close). */
  clearSearch: () =>
    set({ searchResults: [], searching: false, searchError: null }),

  /** Reset transient picker state (on close). */
  resetPicker: () =>
    set({
      openFolderId: null,
      selectedIds: [],
      error: null,
      importing: false,
      searchResults: [],
      searching: false,
      searchError: null,
    }),
}));

export default useChatRepoStore;
