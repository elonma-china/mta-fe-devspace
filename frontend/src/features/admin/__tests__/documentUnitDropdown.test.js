// src/features/admin/__tests__/documentUnitDropdown.test.js
//
// Story 91: the repository toolbar's unit picker (a "Đơn vị: …" button + popup +
// "Tất cả đơn vị" button) is replaced by ONE dropdown lookup like "Nhóm tài liệu"
// (single-select, none = all units). Selecting a unit focuses it; clearing the
// selection returns to all units.
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

import DocumentManagement from "features/admin/pages/DocumentManagement";
import { getUnits } from "features/admin/api";

jest.mock("components", () => ({
  __esModule: true,
  SearchBar: (p) => <input aria-label="search" {...p} />,
}));

// Capture the props of every MultiSelectDropdown so we can drive the unit one.
const msdProps = [];
jest.mock("components/common", () => ({
  __esModule: true,
  DataTable: () => <table />,
  MultiSelectDropdown: (p) => {
    msdProps.push(p);
    return <div data-testid="msd" data-placeholder={p.placeholder} />;
  },
  AlertModal: () => null,
  DeleteModal: () => null,
}));

jest.mock("assets/images/add.svg", () => ({ ReactComponent: (p) => <button type="button" {...p} /> }));
jest.mock("assets/images/delete.svg", () => ({ ReactComponent: (p) => <button type="button" {...p} /> }));
jest.mock("assets/images/edit.svg", () => ({ ReactComponent: (p) => <button type="button" {...p} /> }));
jest.mock("assets/images/report.svg", () => ({ ReactComponent: (p) => <button type="button" {...p} /> }));
jest.mock("assets/images/eye.svg", () => ({ ReactComponent: (p) => <button type="button" {...p} /> }));
jest.mock("assets/images/folder-star.svg", () => ({ ReactComponent: (p) => <button type="button" {...p} /> }));
jest.mock("assets/images/logo-text-fullcolor.svg", () => ({ ReactComponent: () => <span /> }));

jest.mock("features/admin/components/DocGroupFormModal", () => () => null);
jest.mock("features/admin/components/DocumentEditModal", () => () => null);
jest.mock("features/admin/components/DocumentUploadModal", () => () => null);
jest.mock("features/admin/components/UnitFocusModal", () => () => null);
jest.mock("features/documents/components/viewer/DocumentViewer", () => ({
  __esModule: true,
  default: () => <div data-testid="doc-viewer" />,
}));
jest.mock("features/admin/api", () => ({
  __esModule: true,
  getUnits: jest.fn(),
  getAdminDocumentPages: jest.fn(),
  fetchAdminDocumentFile: jest.fn(),
  fetchAdminPageImage: jest.fn(),
}));

const mockDocRepo = {
  items: [], total: 0, page: 1, pageSize: 15, groupIds: [], loading: false, error: null,
  focusUnitId: null, focusUnitName: "",
  fetchDocuments: jest.fn(), unreadCount: 0, fetchUnreadCount: jest.fn(), markDocumentRead: jest.fn(),
  setPage: jest.fn(), setGroupFilter: jest.fn(), resetFilters: jest.fn(),
  setFocusUnit: jest.fn(), resetFocus: jest.fn(),
  uploadDocument: jest.fn(), updateDocument: jest.fn(), deleteDocument: jest.fn(),
  replaceDocumentFile: jest.fn(), processing: {}, processDocument: jest.fn(), syncDocumentStatus: jest.fn(),
};
jest.mock("stores/useDocRepoStore", () => ({
  __esModule: true,
  useDocRepoStore: () => mockDocRepo,
}));
jest.mock("stores/useDocGroupStore", () => ({
  __esModule: true,
  useDocGroupStore: () => ({
    items: [], total: 0, page: 1, pageSize: 15, loading: false, error: null,
    fetchGroups: jest.fn(), setPage: jest.fn(), createGroup: jest.fn(), updateGroup: jest.fn(), deleteGroup: jest.fn(),
  }),
}));
jest.mock("stores/useModalStore", () => ({
  __esModule: true,
  default: () => ({ showModal: jest.fn(), hideModal: jest.fn() }),
}));
// Super-admin (root unit) so the unit dropdown renders.
jest.mock("stores/useAuthStore", () => ({
  __esModule: true,
  default: () => ({ user: { id: 1, is_admin: true, unit_id: 1 } }),
}));

beforeEach(() => {
  msdProps.length = 0;
  Object.values(mockDocRepo).forEach((v) => v?.mockClear?.());
  mockDocRepo.focusUnitId = null;
  mockDocRepo.focusUnitName = "";
  getUnits.mockResolvedValue({
    items: [{ id: 2, name: "Đon vi 2" }, { id: 3, name: "Don vi 3" }],
  });
});

/** Props of the single-select unit dropdown (latest render). */
function unitDropdownProps() {
  const matches = msdProps.filter((p) => p.placeholder === "Tất cả đơn vị");
  return matches[matches.length - 1];
}

test("superAdmin_unitPicker_isSingleDropdown_notButtonsPopup", async () => {
  render(<DocumentManagement />);
  await waitFor(() => expect(unitDropdownProps()).toBeDefined());
  const unit = unitDropdownProps();
  expect(unit.single).toBe(true);
  // Old "Đơn vị: …" button is gone.
  expect(screen.queryByText(/^Đơn vị:/)).toBeNull();
});

test("superAdmin_selectUnit_focuses_clearUnit_returnsToAll", async () => {
  render(<DocumentManagement />);
  await waitFor(() => expect(unitDropdownProps()).toBeDefined());
  // Pick a unit → focus it (name resolved from loaded units).
  unitDropdownProps().onChange([2]);
  expect(mockDocRepo.setFocusUnit).toHaveBeenCalledWith(2, "Đon vi 2");
  // Clear selection → back to all units (setFocusUnit(null, "") which refetches).
  unitDropdownProps().onChange([]);
  expect(mockDocRepo.setFocusUnit).toHaveBeenCalledWith(null, "");
});
