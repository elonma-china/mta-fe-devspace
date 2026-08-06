// src/features/admin/__tests__/documentManagementViewer.test.js
// Story 40: opening the in-place viewer on the repository screen adds a draggable
// resize handle (col-resize) and keeps the "Thao tác" action icons on one line.
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import DocumentManagement from "features/admin/pages/DocumentManagement";

// --- mock the heavy barrels so the page renders in jsdom (ADR-008). A light
//     DataTable stub still invokes each column's render so the action cell (and
//     its onClick) is exercised. ResizeHandle is REAL (renders .dv-resize-handle).
jest.mock("components", () => ({
  __esModule: true,
  SearchBar: (p) => <input aria-label="search" {...p} />,
}));
jest.mock("components/common", () => ({
  __esModule: true,
  DataTable: ({ columns, data, onRowClick }) => (
    <table>
      <tbody>
        {data.map((row, i) => (
          <tr
            key={row.id || i}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
          >
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

// Forward onClick/title so the action icons are clickable in the test. (jest.mock
// requires an INLINE factory, so each is spelled out.)
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

// Stub the modals (not under test) + the viewer (rendered as a marker).
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

const mockDocRepoState = {
  items: [{ id: "d1", name: "Oxford 3000.pdf", status: "PROCESSING" }],
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
};
jest.mock("stores/useDocRepoStore", () => ({
  __esModule: true,
  useDocRepoStore: () => mockDocRepoState,
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

test("documentManagement_actionsWrappedOnOneLine", () => {
  // The action icons sit in a .dm-actions flex/nowrap wrapper (Story 40 fix for
  // the misaligned column when the preview is open).
  render(<DocumentManagement />);
  expect(document.querySelector(".dm-actions")).toBeTruthy();
});

test("documentManagement_openViewer_showsResizeHandle", () => {
  render(<DocumentManagement />);
  // No viewer / handle yet.
  expect(document.querySelector(".dv-resize-handle")).toBeNull();

  // Open the viewer via the "Xem" action.
  fireEvent.click(screen.getByTitle("Xem"));

  expect(screen.getByTestId("doc-viewer")).toBeInTheDocument();
  // Story 40: a draggable resize handle now sits between the list and viewer.
  expect(document.querySelector(".dv-resize-handle")).toBeTruthy();
});
