// src/features/admin/__tests__/documentEditApproveOrder.test.js
//
// Story 62: the "Sửa tên tài liệu" submit order. Replacing the file re-creates the
// document under a NEW id (the old id is deleted) and re-digitizes it, so calling
// approve(oldId) afterwards 404s ("lỗi edit"). The page must SKIP approve when a
// replacement file is chosen, and still approve when none is.
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";

import DocumentManagement from "features/admin/pages/DocumentManagement";

jest.mock("components", () => ({
  __esModule: true,
  SearchBar: (p) => <input aria-label="search" {...p} />,
}));
jest.mock("components/common", () => ({
  __esModule: true,
  DataTable: ({ columns, data }) => (
    <table>
      <tbody>
        {data.map((row, i) => (
          <tr key={row.id || i}>
            {columns.map((c, ci) => (
              <td key={ci}>{c.render ? c.render(row, i) : row[c.key]}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
  MultiSelectDropdown: () => <div />,
  AlertModal: () => null,
  DeleteModal: () => null,
}));

// Icon svgs forward props so title + onClick survive (we click "Sửa").
const icon = (p) => <span {...p} />;
jest.mock("assets/images/add.svg", () => ({ ReactComponent: icon }));
jest.mock("assets/images/delete.svg", () => ({ ReactComponent: icon }));
jest.mock("assets/images/edit.svg", () => ({ ReactComponent: icon }));
jest.mock("assets/images/report.svg", () => ({ ReactComponent: icon }));
jest.mock("assets/images/eye.svg", () => ({ ReactComponent: icon }));
jest.mock("assets/images/file.svg", () => ({ ReactComponent: icon }));
jest.mock("assets/images/folder-star.svg", () => ({ ReactComponent: icon }));
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
  getAdminDocumentPages: jest.fn(),
  fetchAdminDocumentFile: jest.fn(),
  fetchAdminPageImage: jest.fn(),
}));

const mockDocRepo = {
  items: [{ id: "d1", name: "doc.pdf", status: "COMPLETED", group_id: null }],
  total: 1,
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
const mockShowModal = jest.fn();
jest.mock("stores/useModalStore", () => ({
  __esModule: true,
  default: () => ({ showModal: mockShowModal, hideModal: jest.fn() }),
}));
jest.mock("stores/useAuthStore", () => ({
  __esModule: true,
  default: () => ({ user: { id: 1, is_admin: true, unit_id: 2 } }),
}));

beforeEach(() => {
  Object.values(mockDocRepo).forEach((v) => v?.mockClear?.());
  mockShowModal.mockClear();
});

// Click "Sửa" → openDocumentModal → showModal(DocumentEditModal, {onSubmit,...});
// return the captured onSubmit closure.
function openEditOnSubmit() {
  fireEvent.click(screen.getByTitle("Sửa"));
  const call = [...mockShowModal.mock.calls]
    .reverse()
    .find((c) => c[1] && typeof c[1].onSubmit === "function" && c[1].initialValues);
  return call[1].onSubmit;
}

test("documentEdit_replaceFile_skipsApprove", async () => {
  render(<DocumentManagement />);
  const onSubmit = openEditOnSubmit();
  await act(async () => {
    await onSubmit({ name: "x", group_id: null }, new File(["a"], "a.pdf"), true);
  });
  // File replaced → approve(oldId) must NOT run (old id is deleted → would 404).
  expect(mockDocRepo.replaceDocumentFile).toHaveBeenCalledWith("d1", expect.any(File));
  expect(mockDocRepo.approveDocument).not.toHaveBeenCalled();
});

test("documentEdit_noFile_approveRuns", async () => {
  render(<DocumentManagement />);
  const onSubmit = openEditOnSubmit();
  await act(async () => {
    await onSubmit({ name: "x", group_id: null }, null, true);
  });
  // Metadata-only approve still works (no id churn).
  expect(mockDocRepo.approveDocument).toHaveBeenCalledWith("d1");
  expect(mockDocRepo.replaceDocumentFile).not.toHaveBeenCalled();
});
