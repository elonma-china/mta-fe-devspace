// src/features/admin/__tests__/documentManagementCommanderView.test.js
//
// Story 101: the command-level repository. Write UI (Upload văn bản / Thêm nhóm
// tài liệu / row actions) is gated on `is_admin` — the SUPER admin and unit
// admins have it; the COMMANDER ("Chỉ huy", is_admin=false) is VIEW-ONLY, so the
// write controls are hidden for it (it can still see + view). This reverses the
// story-81 view-only hiding FOR THE SUPER ADMIN only; the commander stays
// view-only. VIEW/focus still keys off isRepoSuperAdmin (super + commander).
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

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
  default: () => <div data-testid="doc-viewer" />,
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

// Role set per-test.
let mockUser = { id: 1, is_admin: true, unit_id: 1 };
jest.mock("stores/useAuthStore", () => ({
  __esModule: true,
  default: () => ({ user: mockUser }),
}));

const SUPER = { id: 1, is_admin: true, unit_id: 1 };
const COMMANDER = { id: 9, is_admin: false, unit_id: 1, permissions: ["documents:read", "units:read"] };
const UNIT_ADMIN = { id: 5, is_admin: true, unit_id: 5 };

beforeEach(() => {
  mockDocRepo.focusUnitId = null;
  getUnits.mockResolvedValue({ items: [] });
});

function openGroupsTab() {
  fireEvent.click(screen.getByText("Quản lý nhóm tài liệu"));
}

// ── Documents tab: "Upload văn bản" ──
test("superAdmin_seesUpload", () => {
  mockUser = SUPER;
  render(<DocumentManagement />);
  expect(screen.getByText("Upload văn bản")).toBeInTheDocument();
});

test("commander_viewOnly_hidesUpload", () => {
  mockUser = COMMANDER;
  render(<DocumentManagement />);
  expect(screen.queryByText("Upload văn bản")).not.toBeInTheDocument();
});

test("unitAdmin_seesUpload", () => {
  mockUser = UNIT_ADMIN;
  render(<DocumentManagement />);
  expect(screen.getByText("Upload văn bản")).toBeInTheDocument();
});

// ── Groups tab: "Thêm nhóm tài liệu" ──
test("superAdmin_seesAddGroup", () => {
  mockUser = SUPER;
  render(<DocumentManagement />);
  openGroupsTab();
  expect(screen.getByText("Thêm nhóm tài liệu")).toBeInTheDocument();
});

test("commander_viewOnly_hidesAddGroup", () => {
  mockUser = COMMANDER;
  render(<DocumentManagement />);
  openGroupsTab();
  expect(screen.queryByText("Thêm nhóm tài liệu")).not.toBeInTheDocument();
});

test("unitAdmin_seesAddGroup", () => {
  mockUser = UNIT_ADMIN;
  render(<DocumentManagement />);
  openGroupsTab();
  expect(screen.getByText("Thêm nhóm tài liệu")).toBeInTheDocument();
});
