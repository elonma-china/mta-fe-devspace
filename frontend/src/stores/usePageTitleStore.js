// src/stores/usePageTitleStore.js
import { create } from "zustand";

/**
 * usePageTitleStore — single source of truth for the current screen title shown
 * in the shared Header (story 117). The Header sits above the routed Outlet and
 * can't see a page's active tab, so each admin page pushes its per-tab title here
 * and the Header renders it. Non-admin routes (chat/unit-repository/audit-logs)
 * ignore it and keep showing the logo.
 *
 * Usage:
 *   const setTitle = usePageTitleStore((s) => s.setTitle);
 *   useEffect(() => { setTitle("Quản lý đơn vị"); return () => setTitle(""); }, [tab]);
 */
const usePageTitleStore = create((set) => ({
  title: "",
  setTitle: (title) => set({ title: title || "" }),
}));

export default usePageTitleStore;
