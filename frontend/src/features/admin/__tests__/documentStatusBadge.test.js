// src/features/admin/__tests__/documentStatusBadge.test.js
// Story 49: the "Trạng thái" column renders a COLOURED badge per status (not
// plain text), and the documents table column widths sum to 100% so opening the
// in-place viewer can't push the "Thao tác" column off-screen / under the preview.
import React from "react";
import { render } from "@testing-library/react";

import DocumentManagement from "features/admin/pages/DocumentManagement";

// Light DataTable stub: render each header's width AND each column's render() so
// we can assert on both the badge markup and the column-width invariant.
jest.mock("components", () => ({
  __esModule: true,
  SearchBar: (p) => <input aria-label="search" {...p} />,
}));
jest.mock("components/common", () => ({
  __esModule: true,
  DataTable: ({ columns, data }) => (
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

const mockDocRepoState = {
  items: [
    { id: "a", name: "approved.pdf", status: "APPROVED" },
    { id: "c", name: "completed.pdf", status: "COMPLETED" },
    { id: "p", name: "processing.pdf", status: "PROCESSING" },
    { id: "u", name: "uploaded.pdf", status: "UPLOADED" },
    { id: "n", name: "pending.pdf", status: "PENDING" },
    { id: "e", name: "error.pdf", status: "ERROR" },
    // doc currently being (re)processed in the UI → "Đang xử lý" badge.
    { id: "x", name: "busy.pdf", status: "UPLOADED" },
  ],
  total: 7,
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
  processing: { x: true },
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

test("documentStatusBadge_perStatus_hasColourVariantClass", () => {
  render(<DocumentManagement />);
  // Each status maps to a distinct coloured badge variant.
  expect(document.querySelector(".dm-status--approved")).toBeTruthy();
  expect(document.querySelector(".dm-status--completed")).toBeTruthy();
  expect(document.querySelector(".dm-status--processing")).toBeTruthy();
  // UPLOADED and PENDING both → the "pending" (chưa số hoá) variant.
  expect(document.querySelectorAll(".dm-status--pending").length).toBeGreaterThanOrEqual(2);
  expect(document.querySelector(".dm-status--error")).toBeTruthy();
});

test("documentStatusBadge_reprocessing_showsProcessingVariant", () => {
  render(<DocumentManagement />);
  // The doc flagged in store.processing renders the processing badge even though
  // its persisted status is UPLOADED.
  const processing = document.querySelectorAll(".dm-status--processing");
  // one real PROCESSING doc + one being reprocessed = 2.
  expect(processing.length).toBeGreaterThanOrEqual(2);
});

test("documentColumns_widthsSumTo100Percent", () => {
  render(<DocumentManagement />);
  const ths = Array.from(document.querySelectorAll("th[data-width]"));
  // Only the documents table is rendered here (groups tab inactive).
  const calcs = ths
    .map((th) => th.getAttribute("data-width"))
    .filter((w) => /calc\(100% \* \d+ \/ \d+\)/.test(w));
  expect(calcs.length).toBe(7);
  let numeratorSum = 0;
  let divisor = null;
  calcs.forEach((w) => {
    const m = w.match(/calc\(100% \* (\d+) \/ (\d+)\)/);
    numeratorSum += Number(m[1]);
    const d = Number(m[2]);
    if (divisor == null) divisor = d;
    // every column shares the same divisor.
    expect(d).toBe(divisor);
  });
  // Sum of numerators must equal the divisor → columns total exactly 100%, so the
  // table never overflows and the "Thao tác" column stays visible with the viewer.
  expect(numeratorSum).toBe(divisor);
});
