// src/features/admin/__tests__/documentViewerCompact.test.js
// Story 50: when the in-place viewer is open the list pane is only ~58% wide, so
// the documents table collapses to a compact column set (Tên văn bản · Trạng
// thái · Thao tác) — no ugly wrapping / horizontal scroll. Closed → full 7 cols.
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import DocumentManagement from "features/admin/pages/DocumentManagement";

// Light DataTable stub: expose each header label + width so we can assert on the
// active column set and the width invariant.
jest.mock("components", () => ({
  __esModule: true,
  SearchBar: (p) => <input aria-label="search" {...p} />,
}));
jest.mock("components/common", () => ({
  __esModule: true,
  DataTable: ({ columns, data, onRowClick }) => (
    <table>
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th key={i} data-width={c.width}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
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

const mockDocRepoState = {
  items: [{ id: "d1", name: "Oxford 3000.pdf", status: "COMPLETED" }],
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

function headerLabels() {
  return Array.from(document.querySelectorAll("th[data-width]")).map((th) =>
    th.textContent
  );
}

test("documentList_viewerClosed_showsAllSevenColumns", () => {
  render(<DocumentManagement />);
  const labels = headerLabels();
  expect(labels).toEqual([
    "Trích yếu",
    "Số văn bản",
    "Nhóm tài liệu",
    "Ngày tải tài liệu lên",
    "Tên văn bản",
    "Trạng thái",
    "Thao tác",
  ]);
});

test("documentList_viewerOpen_collapsesToCompactColumns", () => {
  render(<DocumentManagement />);
  // Open the viewer via the "Xem" action.
  fireEvent.click(screen.getAllByTitle("Xem")[0]);
  expect(screen.getByTestId("doc-viewer")).toBeInTheDocument();

  const labels = headerLabels();
  // Compact set: the doc is identified by name, plus its status + actions.
  expect(labels).toEqual(["Tên văn bản", "Trạng thái", "Thao tác"]);
  // The action column survives the collapse (so it can't be "covered").
  expect(document.querySelector(".dm-actions")).toBeTruthy();
});

test("compactColumns_widthsSumTo100Percent", () => {
  render(<DocumentManagement />);
  fireEvent.click(screen.getAllByTitle("Xem")[0]);

  const calcs = Array.from(document.querySelectorAll("th[data-width]"))
    .map((th) => th.getAttribute("data-width"))
    .filter((w) => /calc\(100% \* \d+ \/ \d+\)/.test(w));
  expect(calcs.length).toBe(3);
  let numeratorSum = 0;
  let divisor = null;
  calcs.forEach((w) => {
    const m = w.match(/calc\(100% \* (\d+) \/ (\d+)\)/);
    numeratorSum += Number(m[1]);
    const d = Number(m[2]);
    if (divisor == null) divisor = d;
    expect(d).toBe(divisor);
  });
  expect(numeratorSum).toBe(divisor);
});
