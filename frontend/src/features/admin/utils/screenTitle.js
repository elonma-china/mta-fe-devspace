// src/features/admin/utils/screenTitle.js
//
// Story 117: pure helpers computing the admin header title for the ACTIVE TAB.
// Each admin page pushes the result into usePageTitleStore; the Header displays
// it. Keeping this pure (no React) makes the per-tab mapping unit-testable and
// keeps the title logic in ONE place (single source of truth).
import { docRepoTitle } from "components/layout/docRepoTitle";

/**
 * Title for the "Quản lý người dùng" page by active tab.
 * @param {"users"|"units"} effectiveTab
 * @returns {string}
 */
export function userScreenTitle(effectiveTab) {
  return effectiveTab === "units" ? "Quản lý đơn vị" : "Quản lý người dùng";
}

/**
 * Title for the "Quản lý kho tài liệu" page by active tab. The documents tab
 * carries the unit suffix (via docRepoTitle); the groups tab is standalone.
 * @param {"documents"|"groups"} activeTab
 * @param {{ focusUnitName?: string, unitName?: string }} [unit]
 * @returns {string}
 */
export function docScreenTitle(activeTab, unit = {}) {
  if (activeTab === "groups") return "Quản lý nhóm tài liệu";
  return docRepoTitle(unit);
}
