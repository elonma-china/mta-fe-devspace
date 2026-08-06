// src/features/admin/__tests__/documentManagementGroupLink.test.js
//
// Story 45: clicking a group name in the "Quản lý nhóm tài liệu" tab opens the
// repository tab pre-filtered by that group, and uploads from that entry default
// the new document into that group. Entering the repository via the left nav
// keeps the current behaviour (no preset filter, no default group).
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

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
jest.mock("assets/images/file.svg", () => ({
  ReactComponent: (p) => <button type="button" {...p} />,
}));
// Story 61: the documents nav icon is now folder-star (was file.svg). Mock it so
// the real svgr transform doesn't run (incompatible with React 19 in jsdom).
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
};
jest.mock("stores/useDocRepoStore", () => ({
  __esModule: true,
  useDocRepoStore: () => mockDocRepo,
}));
jest.mock("stores/useDocGroupStore", () => ({
  __esModule: true,
  useDocGroupStore: () => ({
    items: [{ id: 7, name: "Nhóm tài liệu 1" }],
    total: 1,
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

function gotoGroupsTab() {
  fireEvent.click(screen.getByText("Quản lý nhóm tài liệu"));
}

function findUploadOnUpload() {
  const call = mockShowModal.mock.calls.find(
    (c) => c[1] && typeof c[1].onUpload === "function"
  );
  return call?.[1]?.onUpload;
}

test("docMgmt_clickGroupName_opensRepoFilteredByGroup", () => {
  render(<DocumentManagement />);
  gotoGroupsTab();
  fireEvent.click(screen.getByText("Nhóm tài liệu 1"));
  // Switched to the repository tab (Upload button present).
  expect(screen.getByText("Upload văn bản")).toBeInTheDocument();
  // The group filter is preset to that group (survives the tab-enter reset).
  expect(mockDocRepo.fetchDocuments).toHaveBeenCalledWith(
    expect.objectContaining({ groupIds: [7] })
  );
});

test("docMgmt_clickGroupActionIcon_doesNotNavigate", () => {
  render(<DocumentManagement />);
  gotoGroupsTab();
  fireEvent.click(screen.getByTitle("Sửa"));
  // Edit modal opened, NOT navigation: still on the groups tab.
  expect(mockShowModal).toHaveBeenCalled();
  expect(screen.queryByText("Upload văn bản")).toBeNull();
});

test("docMgmt_uploadAfterGroupLink_defaultsGroupId", async () => {
  render(<DocumentManagement />);
  gotoGroupsTab();
  fireEvent.click(screen.getByText("Nhóm tài liệu 1"));
  fireEvent.click(screen.getByText("Upload văn bản"));
  const onUpload = findUploadOnUpload();
  expect(onUpload).toBeDefined();
  await onUpload(new File(["x"], "a.pdf"));
  expect(mockDocRepo.uploadDocument).toHaveBeenCalledWith(expect.any(FormData), 7);
});

test("docMgmt_uploadViaNav_noDefaultGroup", async () => {
  render(<DocumentManagement />);
  // Already on the documents tab via initial mount (nav entry, no group context).
  fireEvent.click(screen.getByText("Upload văn bản"));
  const onUpload = findUploadOnUpload();
  expect(onUpload).toBeDefined();
  await onUpload(new File(["x"], "a.pdf"));
  const [, groupArg] = mockDocRepo.uploadDocument.mock.calls[0];
  expect(groupArg == null).toBe(true);
});
