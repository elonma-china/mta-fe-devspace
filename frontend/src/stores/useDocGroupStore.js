// src/stores/useDocGroupStore.js
import { create } from "zustand";

import {
  getGroups,
  createGroup as apiCreateGroup,
  updateGroup as apiUpdateGroup,
  deleteGroup as apiDeleteGroup,
} from "features/admin/api";

const PAGE_SIZE = 10;

/**
 * Zustand store for the "Quản lý nhóm tài liệu" (document group) screen.
 *
 * Holds the paginated/searchable document-group list. All network access lives
 * in the actions here — components never fetch directly. The list endpoint
 * returns the ``{ items, total, page, page_size }`` envelope (never a bare
 * array), so consumers read ``items`` directly.
 */
export const useDocGroupStore = create((set, get) => ({
  items: [],
  total: 0,
  page: 1,
  pageSize: PAGE_SIZE,
  search: "",
  // Story 77: the focused unit whose groups are listed (null = the caller's own
  // unit, for unit admins). Remembered so setPage/search reuse it.
  unitId: null,
  loading: false,
  error: null,

  /**
   * Load a page of groups. Passing ``search`` updates the keyword and resets
   * to page 1; passing ``page`` loads that page with the current keyword;
   * passing ``unitId`` switches the focused unit (story 77).
   */
  fetchGroups: async ({ search, page, unitId } = {}) => {
    const state = get();
    const nextSearch = search !== undefined ? search : state.search;
    const nextPage = search !== undefined ? 1 : page || state.page;
    const nextUnitId = unitId !== undefined ? unitId : state.unitId;

    set({
      loading: true,
      error: null,
      search: nextSearch,
      page: nextPage,
      unitId: nextUnitId,
    });
    try {
      const data = await getGroups({
        search: nextSearch,
        page: nextPage,
        page_size: state.pageSize,
        unit_id: nextUnitId,
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
        error: e.message || "Tải danh sách nhóm tài liệu thất bại",
        loading: false,
      });
    }
  },

  setPage: (page) => get().fetchGroups({ page }),

  createGroup: async (payload) => {
    await apiCreateGroup(payload);
    await get().fetchGroups({ page: get().page });
  },

  updateGroup: async (id, payload) => {
    await apiUpdateGroup(id, payload);
    await get().fetchGroups({ page: get().page });
  },

  deleteGroup: async (id) => {
    await apiDeleteGroup(id);
    await get().fetchGroups({ page: get().page });
  },
}));

export default useDocGroupStore;
