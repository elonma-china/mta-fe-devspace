// src/stores/useDocRepoStore.js
import { create } from "zustand";

import {
  getRepositoryDocuments,
  uploadRepositoryDocument,
  updateRepositoryDocument as apiUpdateDocument,
  deleteRepositoryDocument as apiDeleteDocument,
  replaceRepositoryDocumentFile as apiReplaceDocumentFile,
  processRepositoryDocument as apiProcessDocument,
  getRepositoryDocumentStatus as apiGetDocumentStatus,
  approveRepositoryDocument as apiApproveDocument,
  getRepositoryUnreadCount as apiGetUnreadCount,
  markRepositoryDocumentRead as apiMarkDocumentRead,
} from "features/admin/api";
import {
  readFocus,
  writeFocus,
  clearFocus,
} from "features/admin/utils/docRepoFocus";

const PAGE_SIZE = 15;

// Hydrate the focus unit from sessionStorage so a super-admin's chosen unit
// survives a page refresh within the session.
const initialFocus = readFocus();

/**
 * Zustand store for the admin "Quản lý kho tài liệu" (document repository)
 * screen. Distinct from the chat-side ``useDocumentStore`` (conversation-bound).
 *
 * Holds the paginated/searchable, group-filtered repository list. All network
 * access lives in the actions here — components never fetch directly. The list
 * endpoint returns the ``{ items, total, page, page_size }`` envelope (never a
 * bare array).
 */
export const useDocRepoStore = create((set, get) => ({
  items: [],
  total: 0,
  page: 1,
  pageSize: PAGE_SIZE,
  search: "",
  groupIds: [],
  // Super-admin "focus unit": which unit's repository is being viewed. Unit
  // admins leave this null and the BE uses their own unit. Hydrated from
  // sessionStorage so it survives F5 within the session.
  focusUnitId: initialFocus?.id ?? null,
  focusUnitName: initialFocus?.name ?? "",
  loading: false,
  error: null,
  // Story 34: per-document "đang số hoá" flag (keyed by id) so the row can show
  // a spinner / disable the button while the reprocess request is in flight.
  processing: {},
  // Story 54: number of repository documents this admin has NOT read yet (the
  // "Kho tài liệu" header badge). 0 hides the badge.
  unreadCount: 0,

  /**
   * Load a page. Passing ``search`` or ``groupIds`` updates that filter and
   * resets to page 1; passing ``page`` loads that page with current filters.
   */
  fetchDocuments: async ({ search, groupIds, page } = {}) => {
    const state = get();
    const filterChanged = search !== undefined || groupIds !== undefined;
    const nextSearch = search !== undefined ? search : state.search;
    const nextGroupIds = groupIds !== undefined ? groupIds : state.groupIds;
    const nextPage = filterChanged ? 1 : page || state.page;

    set({
      loading: true,
      error: null,
      search: nextSearch,
      groupIds: nextGroupIds,
      page: nextPage,
    });
    try {
      const data = await getRepositoryDocuments({
        search: nextSearch,
        group_ids: nextGroupIds,
        unit_id: state.focusUnitId,
        page: nextPage,
        page_size: state.pageSize,
      });
      set({
        items: data.items || [],
        total: data.total || 0,
        page: data.page || nextPage,
        pageSize: data.page_size || state.pageSize,
        loading: false,
      });
    } catch (e) {
      set({
        error: e.message || "Tải danh sách tài liệu thất bại",
        loading: false,
      });
    }
  },

  setPage: (page) => get().fetchDocuments({ page }),

  /**
   * Set the group filter and reload from page 1. The store is the single
   * source of truth for the filter — the page must NOT keep a parallel copy,
   * which previously desynced so clearing the filter (``[]``) failed to load
   * all documents.
   */
  setGroupFilter: (groupIds) => get().fetchDocuments({ groupIds }),

  /** Reset search + group filter to empty and reload (used on tab enter). */
  resetFilters: () => get().fetchDocuments({ search: "", groupIds: [] }),

  /**
   * Set the super-admin focus unit and reload from page 1. Unit admins never
   * call this (their unit is implicit). Passing ``id=null`` clears the focus.
   */
  setFocusUnit: async (id, name = "") => {
    set({ focusUnitId: id, focusUnitName: name });
    writeFocus(id, name);
    await get().fetchDocuments({ search: "", groupIds: [] });
  },

  /** Clear the focus unit (on logout) so it never leaks across users/sessions.
   *  Does not fetch. */
  resetFocus: () => {
    clearFocus();
    set({ focusUnitId: null, focusUnitName: "" });
  },

  // Story 45: optional `groupId` defaults the uploaded document into a group
  // (when uploading from a group-scoped repository view). Omitted = no group.
  uploadDocument: async (formData, groupId) => {
    await uploadRepositoryDocument(formData, get().focusUnitId, groupId);
    await get().fetchDocuments({ page: get().page });
  },

  replaceDocumentFile: async (id, file) => {
    await apiReplaceDocumentFile(id, file);
    await get().fetchDocuments({ page: get().page });
  },

  updateDocument: async (id, payload) => {
    await apiUpdateDocument(id, payload);
    await get().fetchDocuments({ page: get().page });
  },

  deleteDocument: async (id) => {
    await apiDeleteDocument(id);
    await get().fetchDocuments({ page: get().page });
  },

  /**
   * Story 34: (re)process a repository document that is stored but not yet
   * digitized (status UPLOADED/PENDING/ERROR). Marks it "processing" while the
   * request runs, then refetches the page so the new status shows. The flag is
   * always cleared, even on failure.
   */
  processDocument: async (id) => {
    set((s) => ({ processing: { ...s.processing, [id]: true } }));
    try {
      await apiProcessDocument(id);
      await get().fetchDocuments({ page: get().page });
    } finally {
      set((s) => {
        const next = { ...s.processing };
        delete next[id];
        return { processing: next };
      });
    }
  },

  /**
   * Story 46: sync ONE repository document's status from AI ingest and update it
   * in place (no full-page refetch → no flicker/scroll jump). Called on a poll
   * while the doc is PROCESSING; on transient failure it logs and returns so the
   * poll loop keeps running and retries on the next tick.
   */
  syncDocumentStatus: async (id) => {
    try {
      const data = await apiGetDocumentStatus(id);
      const nextStatus = data?.status;
      if (!nextStatus) return;
      set((s) => ({
        items: s.items.map((it) =>
          it.id === id ? { ...it, status: nextStatus } : it
        ),
      }));
    } catch (e) {
      // Best-effort poll: don't break the loop on a transient error; the next
      // tick retries. (Not rethrown — there is no caller to handle it.)
      console.warn("[docRepo] syncDocumentStatus failed", id, e);
    }
  },

  /**
   * Story 48: mark a COMPLETED document as APPROVED ("Đã duyệt"). Errors
   * (e.g. BE 409 for a non-COMPLETED doc) are rethrown so the edit modal can
   * surface them. Refetches the page so the new status shows.
   */
  approveDocument: async (id) => {
    await apiApproveDocument(id);
    await get().fetchDocuments({ page: get().page });
  },

  /**
   * Story 54: refresh the unread count for the "Kho tài liệu" header badge.
   * Best-effort: on error the badge is hidden (count 0) rather than blocking the
   * UI. Called on mount + a periodic poll, and after marking a doc read.
   */
  fetchUnreadCount: async () => {
    try {
      const data = await apiGetUnreadCount();
      set({ unreadCount: data?.count || 0 });
    } catch (e) {
      console.warn("[docRepo] fetchUnreadCount failed", e);
      set({ unreadCount: 0 });
    }
  },

  /**
   * Story 54: mark a repository document as read by the current admin. Optimistic
   * — clear the row's ``is_unread`` flag and decrement the badge immediately (so
   * opening the viewer updates the UI without a refetch), then POST. The decrement
   * only happens when the row was actually unread (never goes negative).
   */
  markDocumentRead: async (id) => {
    const item = get().items.find((it) => it.id === id);
    const wasUnread = item?.is_unread === true;
    set((s) => ({
      items: s.items.map((it) =>
        it.id === id ? { ...it, is_unread: false } : it
      ),
      unreadCount: wasUnread ? Math.max(0, s.unreadCount - 1) : s.unreadCount,
    }));
    try {
      await apiMarkDocumentRead(id);
    } catch (e) {
      // Best-effort: reading is secondary to viewing; don't block or rethrow.
      console.warn("[docRepo] markDocumentRead failed", id, e);
    }
  },
}));

export default useDocRepoStore;
