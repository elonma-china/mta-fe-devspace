// src/features/admin/__tests__/documentManagementRepoIcon.test.js
//
// Story 61: the left-nav "Quản lý kho tài liệu" item must use the folder-star
// icon (Figma 841-48816), not the generic file sheet — one consistent "kho tài
// liệu" glyph. Renders the page with the same heavy-mock harness as story 45 and
// asserts the documents nav button shows folder-star (and not the file icon).
import React from "react";
import { render, screen } from "@testing-library/react";

import DocumentManagement from "features/admin/pages/DocumentManagement";

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

jest.mock("assets/images/add.svg", () => ({ ReactComponent: (p) => <span {...p} /> }));
jest.mock("assets/images/delete.svg", () => ({ ReactComponent: (p) => <span {...p} /> }));
jest.mock("assets/images/edit.svg", () => ({ ReactComponent: (p) => <span {...p} /> }));
jest.mock("assets/images/report.svg", () => ({
  ReactComponent: (p) => <span data-testid="report-icon" {...p} />,
}));
jest.mock("assets/images/eye.svg", () => ({ ReactComponent: (p) => <span {...p} /> }));
jest.mock("assets/images/logo-text-fullcolor.svg", () => ({ ReactComponent: () => <span /> }));
// Story 61: the old (wrong) generic file icon vs the new folder-star icon.
jest.mock("assets/images/file.svg", () => ({
  ReactComponent: (p) => <span data-testid="file-icon" {...p} />,
}));
jest.mock("assets/images/folder-star.svg", () => ({
  ReactComponent: (p) => <span data-testid="folder-star-icon" {...p} />,
}));

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
  getAdminDocumentPages: jest.fn(),
  fetchAdminDocumentFile: jest.fn(),
  fetchAdminPageImage: jest.fn(),
}));

const mockDocRepo = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 15,
  groupIds: [],
  loading: false,
  error: null,
  focusUnitId: 2,
  focusUnitName: "Donvi 1",
  fetchDocuments: jest.fn(),
  unreadCount: 0,
  fetchUnreadCount: jest.fn(),
  markDocumentRead: jest.fn(),
  setPage: jest.fn(),
  setGroupFilter: jest.fn(),
  resetFilters: jest.fn(),
  setFocusUnit: jest.fn(),
  resetFocus: jest.fn(),
  uploadDocument: jest.fn(),
  updateDocument: jest.fn(),
  deleteDocument: jest.fn(),
  replaceDocumentFile: jest.fn(),
  processing: {},
  processDocument: jest.fn(),
  syncDocumentStatus: jest.fn(),
  approveDocument: jest.fn(),
};
jest.mock("stores/useDocRepoStore", () => ({
  __esModule: true,
  useDocRepoStore: () => mockDocRepo,
}));
jest.mock("stores/useDocGroupStore", () => ({
  __esModule: true,
  useDocGroupStore: () => ({
    items: [],
    total: 0,
    page: 1,
    pageSize: 15,
    loading: false,
    error: null,
    fetchGroups: jest.fn(),
    setPage: jest.fn(),
    createGroup: jest.fn(),
    updateGroup: jest.fn(),
    deleteGroup: jest.fn(),
  }),
}));
jest.mock("stores/useModalStore", () => ({
  __esModule: true,
  default: () => ({ showModal: jest.fn(), hideModal: jest.fn() }),
}));
jest.mock("stores/useAuthStore", () => ({
  __esModule: true,
  default: () => ({ user: { id: 1, is_admin: true, unit_id: 2 } }),
}));

test("documentManagement_repoNav_usesFolderStarIcon", () => {
  render(<DocumentManagement />);
  const btn = screen.getByRole("button", { name: /Quản lý kho tài liệu/i });
  expect(btn.querySelector('[data-testid="folder-star-icon"]')).toBeTruthy();
});

test("documentManagement_repoNav_dropsFileIcon", () => {
  render(<DocumentManagement />);
  const btn = screen.getByRole("button", { name: /Quản lý kho tài liệu/i });
  expect(btn.querySelector('[data-testid="file-icon"]')).toBeNull();
});
