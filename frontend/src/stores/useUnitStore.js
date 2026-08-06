// src/stores/useUnitStore.js
import { create } from "zustand";

import {
  getUnits,
  createUnit as apiCreateUnit,
  updateUnit as apiUpdateUnit,
  deleteUnit as apiDeleteUnit,
  getAdminCandidates,
} from "features/admin/api";

const PAGE_SIZE = 12;

/**
 * Zustand store for the "Quản lý đơn vị" (unit management) screen.
 *
 * Holds the paginated/searchable unit list plus admin-candidate data for the
 * create/edit modal. All network access lives in the actions here — components
 * never fetch directly.
 */
export const useUnitStore = create((set, get) => ({
  items: [],
  total: 0,
  page: 1,
  pageSize: PAGE_SIZE,
  search: "",
  loading: false,
  error: null,
  adminCandidates: [],

  /**
   * Load a page of units. Passing ``search`` updates the keyword and resets to
   * page 1; passing ``page`` loads that page with the current keyword.
   */
  fetchUnits: async ({ search, page } = {}) => {
    const state = get();
    const nextSearch = search !== undefined ? search : state.search;
    const nextPage = search !== undefined ? 1 : page || state.page;

    set({ loading: true, error: null, search: nextSearch, page: nextPage });
    try {
      const data = await getUnits({
        search: nextSearch,
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
      set({ error: e.message || "Tải danh sách đơn vị thất bại", loading: false });
    }
  },

  setPage: (page) => get().fetchUnits({ page }),

  createUnit: async (payload) => {
    await apiCreateUnit(payload);
    await get().fetchUnits({ page: get().page });
  },

  updateUnit: async (id, payload) => {
    await apiUpdateUnit(id, payload);
    await get().fetchUnits({ page: get().page });
  },

  deleteUnit: async (id, transferToUnitId) => {
    await apiDeleteUnit(id, transferToUnitId);
    await get().fetchUnits({ page: get().page });
  },

  fetchAdminCandidates: async (unitId) => {
    const candidates = await getAdminCandidates(unitId);
    set({ adminCandidates: candidates || [] });
    return candidates || [];
  },
}));

export default useUnitStore;
