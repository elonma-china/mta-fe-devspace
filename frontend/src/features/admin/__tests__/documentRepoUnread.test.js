// src/features/admin/__tests__/documentRepoUnread.test.js
//
// Story 54: the repository management screen highlights documents this admin has
// NOT read yet (unread rows get a class), and opening a document ("Xem") marks it
// read (so its highlight clears + the header badge decrements).
import React from "react";
import fs from "fs";
import path from "path";
import { render, screen, fireEvent } from "@testing-library/react";

import DocumentManagement from "features/admin/pages/DocumentManagement";

jest.mock("components", () => ({
  __esModule: true,
  SearchBar: (p) => <input aria-label="search" {...p} />,
}));
jest.mock("components/common", () => ({
  __esModule: true,
  // Apply rowClassName so the unread highlight is observable; render columns so
  // the row actions (Eye/"Xem") are present and clickable.
  DataTable: ({ columns, data, rowClassName }) => (
    <table>
      <tbody>
        {data.map((row, i) => (
          <tr
            key={row.id || i}
            className={rowClassName ? rowClassName(row) : undefined}
            data-testid={`row-${row.id}`}
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
jest.mock("assets/images/add.svg", () => ({ ReactComponent: (p) => <button {...p} /> }));
jest.mock("assets/images/delete.svg", () => ({ ReactComponent: (p) => <button {...p} /> }));
jest.mock("assets/images/edit.svg", () => ({ ReactComponent: (p) => <button {...p} /> }));
jest.mock("assets/images/report.svg", () => ({ ReactComponent: (p) => <button {...p} /> }));
jest.mock("assets/images/eye.svg", () => ({ ReactComponent: (p) => <button {...p} /> }));
jest.mock("assets/images/file.svg", () => ({ ReactComponent: (p) => <button {...p} /> }));
// Story 61: documents nav icon is now folder-star — mock it (real svgr transform
// is incompatible with React 19 in jsdom).
jest.mock("assets/images/folder-star.svg", () => ({ ReactComponent: (p) => <button {...p} /> }));
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
  getAdminDocumentPages: jest.fn(),
  fetchAdminDocumentFile: jest.fn(),
  fetchAdminPageImage: jest.fn(),
}));

const mockRepo = {
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
  unreadCount: 0,
  fetchUnreadCount: jest.fn(),
  markDocumentRead: jest.fn(),
};
jest.mock("stores/useDocRepoStore", () => ({
  __esModule: true,
  useDocRepoStore: () => mockRepo,
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
jest.mock("stores/useAuthStore", () => ({
  __esModule: true,
  default: () => ({ user: { id: 1, is_admin: true, unit_id: 2 } }),
}));

afterEach(() => {
  mockRepo.markDocumentRead.mockClear();
  mockRepo.fetchUnreadCount.mockClear();
  mockRepo.items = [];
});

test("unread_row_getsHighlightClass", () => {
  mockRepo.items = [
    { id: "d1", name: "unread.pdf", status: "COMPLETED", is_unread: true },
    { id: "d2", name: "read.pdf", status: "COMPLETED", is_unread: false },
  ];
  render(<DocumentManagement />);
  expect(
    screen.getByTestId("row-d1").classList.contains("dm-row--unread")
  ).toBe(true);
  expect(
    screen.getByTestId("row-d2").classList.contains("dm-row--unread")
  ).toBe(false);
});

test("openingViewer_marksDocumentRead", () => {
  mockRepo.items = [
    { id: "d1", name: "unread.pdf", status: "COMPLETED", is_unread: true },
  ];
  render(<DocumentManagement />);
  // The "Xem" action (Eye icon) opens the viewer + marks the doc read.
  fireEvent.click(screen.getByTitle("Xem"));
  expect(mockRepo.markDocumentRead).toHaveBeenCalledWith("d1");
});

test("entering_documentsTab_refreshesUnreadCount", () => {
  render(<DocumentManagement />);
  expect(mockRepo.fetchUnreadCount).toHaveBeenCalled();
});

test("css_unreadRow_tealAndBold", () => {
  // jsdom can't compute styles from a class, so lock the CSS at the source.
  // Story 56: unread rows = brand-teal text + semibold (Figma 1088-24989), NOT a
  // red dot / background tint.
  const css = fs.readFileSync(
    path.join(__dirname, "../pages/DocumentManagement.css"),
    "utf8"
  );
  const rule = css.match(/\.dm-row--unread td\s*\{([^}]*)\}/);
  expect(rule).toBeTruthy();
  const body = rule[1].replace(/\s/g, "");
  expect(body).toContain("font-weight:600");
  // brand-teal text colour (var or literal #226355).
  expect(body).toMatch(/color:.*(--brand-primary|226355)/);
  // Story 56: the story-54 red dot is removed — no ::before unread marker.
  expect(css).not.toMatch(/\.dm-row--unread td:first-child::before/);
});
