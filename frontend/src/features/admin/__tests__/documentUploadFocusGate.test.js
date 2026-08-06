// src/features/admin/__tests__/documentUploadFocusGate.test.js
//
// Story 90: a super-admin/commander defaults to the ALL-UNITS view (focusUnitId
// null, story 78). Uploading needs a target unit, so clicking Upload in that
// state previously sent unit_id=null → BE 400 UNIT_FOCUS_REQUIRED → the upload
// modal showed a cryptic "Lỗi". Fix: a pre-check shows a CLEAR prompt to pick a
// unit first and does NOT open the upload modal. With a unit focused, upload
// works as before.
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

jest.mock("assets/images/add.svg", () => ({
  ReactComponent: (p) => <button type="button" {...p} />,
}));
jest.mock("assets/images/delete.svg", () => ({
  ReactComponent: (p) => <button type="button" {...p} />,
}));
jest.mock("assets/images/edit.svg", () => ({
  ReactComponent: (p) => <button type="button" {...p} />,
}));
jest.mock("assets/images/report.svg", () => ({
  ReactComponent: (p) => <button type="button" {...p} />,
}));
jest.mock("assets/images/eye.svg", () => ({
  ReactComponent: (p) => <button type="button" {...p} />,
}));
jest.mock("assets/images/folder-star.svg", () => ({
  ReactComponent: (p) => <button type="button" {...p} />,
}));
jest.mock("assets/images/logo-text-fullcolor.svg", () => ({
  ReactComponent: () => <span />,
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
  getUnits: jest.fn(() => Promise.resolve({ items: [] })),
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
  focusUnitId: null,
  focusUnitName: "",
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
const mockShowModal = jest.fn();
jest.mock("stores/useModalStore", () => ({
  __esModule: true,
  default: () => ({ showModal: mockShowModal, hideModal: jest.fn() }),
}));
// Super-admin: admin on the ROOT unit (id 1) → isRepoSuperAdmin true.
jest.mock("stores/useAuthStore", () => ({
  __esModule: true,
  default: () => ({ user: { id: 1, is_admin: true, unit_id: 1 } }),
}));

beforeEach(() => {
  Object.values(mockDocRepo).forEach((v) => v?.mockClear?.());
  mockShowModal.mockClear();
  mockDocRepo.focusUnitId = null;
  mockDocRepo.focusUnitName = "";
  getUnits.mockResolvedValue({ items: [] });
});

/** The showModal call that opened the upload modal (has an onUpload prop). */
function uploadModalCall() {
  return mockShowModal.mock.calls.find(
    (c) => c[1] && typeof c[1].onUpload === "function"
  );
}
/** The showModal call carrying a user-facing message (AlertModal). */
function messageCall() {
  return mockShowModal.mock.calls.find(
    (c) => c[1] && typeof c[1].message === "string"
  );
}

test("superAdmin_noFocus_upload_promptsForUnit_doesNotOpenUploadModal", () => {
  render(<DocumentManagement />);
  fireEvent.click(screen.getByText("Upload văn bản"));

  // No upload modal opened...
  expect(uploadModalCall()).toBeUndefined();
  // ...a clear prompt to pick a unit is shown instead.
  const msg = messageCall();
  expect(msg).toBeDefined();
  expect(msg[1].message).toMatch(/chọn đơn vị.*tải tài liệu/i);
});

test("superAdmin_withFocus_upload_opensUploadModal", () => {
  mockDocRepo.focusUnitId = 4;
  mockDocRepo.focusUnitName = "Donvi 1";
  render(<DocumentManagement />);
  fireEvent.click(screen.getByText("Upload văn bản"));

  expect(uploadModalCall()).toBeDefined();
});
