// src/features/admin/__tests__/documentManagementSuperFocus.test.js
//
// Story 102: on entering the repository screen the super admin AND the commander
// ("Chỉ huy") default-focus the ROOT unit "Tổng" (the command level) instead of
// the all-units view (story 78). That way creating a group / uploading targets
// Tổng immediately, without the "Vui lòng chọn đơn vị…" error. A unit admin is
// unaffected. The default fires once per mount, from the loaded units list (name
// not hard-coded); the super admin may still pick another unit afterwards.
import React from "react";
import { render, waitFor } from "@testing-library/react";

import DocumentManagement from "features/admin/pages/DocumentManagement";
import { getUnits } from "features/admin/api";

jest.mock("components", () => ({
  __esModule: true,
  SearchBar: (p) => <input aria-label="search" {...p} />,
}));
jest.mock("components/common", () => ({
  __esModule: true,
  DataTable: () => <table />,
  MultiSelectDropdown: () => <div />,
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
  default: () => <div />,
}));
jest.mock("features/admin/api", () => ({
  __esModule: true,
  getUnits: jest.fn(() => Promise.resolve({ items: [] })),
  getAdminDocumentPages: jest.fn(),
  fetchAdminDocumentFile: jest.fn(),
  fetchAdminPageImage: jest.fn(),
}));

const mockDocRepo = {
  items: [], total: 0, page: 1, pageSize: 15, groupIds: [], loading: false,
  error: null, focusUnitId: null, focusUnitName: "",
  fetchDocuments: jest.fn(), unreadCount: 0, fetchUnreadCount: jest.fn(),
  markDocumentRead: jest.fn(), setPage: jest.fn(), setGroupFilter: jest.fn(),
  resetFilters: jest.fn(), setFocusUnit: jest.fn(), resetFocus: jest.fn(),
  uploadDocument: jest.fn(), updateDocument: jest.fn(), deleteDocument: jest.fn(),
  replaceDocumentFile: jest.fn(), processing: {}, processDocument: jest.fn(),
  syncDocumentStatus: jest.fn(),
};
jest.mock("stores/useDocRepoStore", () => ({
  __esModule: true,
  useDocRepoStore: () => mockDocRepo,
}));
jest.mock("stores/useDocGroupStore", () => ({
  __esModule: true,
  useDocGroupStore: () => ({
    items: [], total: 0, page: 1, pageSize: 15, loading: false, error: null,
    fetchGroups: jest.fn(), setPage: jest.fn(), createGroup: jest.fn(),
    updateGroup: jest.fn(), deleteGroup: jest.fn(),
  }),
}));
jest.mock("stores/useModalStore", () => ({
  __esModule: true,
  default: () => ({ showModal: jest.fn(), hideModal: jest.fn() }),
}));

let mockUser = { id: 1, is_admin: true, unit_id: 1 };
jest.mock("stores/useAuthStore", () => ({
  __esModule: true,
  default: () => ({ user: mockUser }),
}));

const SUPER = { id: 1, is_admin: true, unit_id: 1 };
const COMMANDER = { id: 9, is_admin: false, unit_id: 1, permissions: ["documents:read", "units:read"] };
const UNIT_ADMIN = { id: 5, is_admin: true, unit_id: 5 };
// The units list carries the ROOT unit "Tổng" (id = ROOT_UNIT_ID = 1).
const UNITS = [{ id: 1, name: "Tổng" }, { id: 5, name: "Donvi 1" }];

beforeEach(() => {
  mockDocRepo.setFocusUnit.mockClear();
  mockDocRepo.focusUnitId = null;
  getUnits.mockClear();
  getUnits.mockResolvedValue({ items: UNITS });
});

test("superAdmin_entersRepo_defaultFocusesRootTong", async () => {
  mockUser = SUPER;
  render(<DocumentManagement />);
  await waitFor(() =>
    expect(mockDocRepo.setFocusUnit).toHaveBeenCalledWith(1, "Tổng")
  );
});

test("commander_entersRepo_defaultFocusesRootTong", async () => {
  mockUser = COMMANDER;
  render(<DocumentManagement />);
  await waitFor(() =>
    expect(mockDocRepo.setFocusUnit).toHaveBeenCalledWith(1, "Tổng")
  );
});

test("unitAdmin_entersRepo_doesNotDefaultFocusRoot", async () => {
  mockUser = UNIT_ADMIN;
  render(<DocumentManagement />);
  // Let any effects flush; the unit admin must NOT be moved to ROOT.
  await new Promise((r) => setTimeout(r, 0));
  expect(mockDocRepo.setFocusUnit).not.toHaveBeenCalledWith(1, "Tổng");
});
