// src/features/admin/__tests__/documentRepoStatusPoll.test.js
//
// Story 46: the repository screen must poll a document's processing status while
// any doc is PROCESSING, so "Đang xử lý" auto-advances to "Đã số hoá" without a
// manual refresh. Polling stops when no doc is PROCESSING.
import React from "react";
import { render, act } from "@testing-library/react";

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
  jest.useRealTimers();
  mockRepo.syncDocumentStatus.mockClear();
  mockRepo.items = [];
});

test("repoStatus_processingDoc_pollsStatus", () => {
  jest.useFakeTimers();
  mockRepo.items = [{ id: "d1", name: "a.pdf", status: "PROCESSING" }];
  render(<DocumentManagement />);
  act(() => {
    jest.advanceTimersByTime(3100);
  });
  expect(mockRepo.syncDocumentStatus).toHaveBeenCalledWith("d1");
});

test("repoStatus_noProcessing_doesNotPoll", () => {
  jest.useFakeTimers();
  mockRepo.items = [{ id: "d1", name: "a.pdf", status: "COMPLETED" }];
  render(<DocumentManagement />);
  act(() => {
    jest.advanceTimersByTime(6100);
  });
  expect(mockRepo.syncDocumentStatus).not.toHaveBeenCalled();
});

// ── Bug 1 (2026-07-30): "upload xong nhưng phải F5 mới hết Đang xử lý" ────────
// `/admin/documents/{id}/status` is the ONLY thing that ever writes a terminal
// status back (document.py::repository_document_status). Measured on the real
// stack: a .txt that ingests in seconds still read PROCESSING 200s later, and
// flipped the instant one /status call was made. So every non-terminal document
// must be polled, and the poll must not give up while any remain — a doc left
// on PROCESSING is not merely mislabelled, it is excluded from RAG answers.

test("repoStatus_pendingDoc_isAlsoPolled", () => {
  // PENDING is what _process_repo_document stores when the ingest task has not
  // started yet. The old filter matched the exact string "PROCESSING", so such a
  // document was never pulled at all and stayed queued-looking forever.
  jest.useFakeTimers();
  mockRepo.items = [{ id: "d1", name: "a.pdf", status: "PENDING" }];
  render(<DocumentManagement />);
  act(() => {
    jest.advanceTimersByTime(3100);
  });
  expect(mockRepo.syncDocumentStatus).toHaveBeenCalledWith("d1");
});

test("repoStatus_longRunningDoc_keepsPollingPastFiveMinutes", () => {
  // The old poll stopped after 100 ticks (~5 min) — silently, with the badge
  // frozen on "Đang xử lý". A scanned PDF through OCR outlives that easily.
  jest.useFakeTimers();
  mockRepo.items = [{ id: "d1", name: "scan.pdf", status: "PROCESSING" }];
  render(<DocumentManagement />);
  act(() => {
    jest.advanceTimersByTime(6 * 60 * 1000);
  });
  const callsAtSixMinutes = mockRepo.syncDocumentStatus.mock.calls.length;
  expect(callsAtSixMinutes).toBeGreaterThan(0);

  act(() => {
    jest.advanceTimersByTime(5 * 60 * 1000);
  });
  expect(mockRepo.syncDocumentStatus.mock.calls.length).toBeGreaterThan(
    callsAtSixMinutes
  );
});

test("repoStatus_approvedDoc_isTerminal_notPolled", () => {
  // APPROVED is admin-set and terminal; syncing it would be a wasted round-trip
  // (the endpoint short-circuits on it anyway).
  jest.useFakeTimers();
  mockRepo.items = [{ id: "d1", name: "a.pdf", status: "APPROVED" }];
  render(<DocumentManagement />);
  act(() => {
    jest.advanceTimersByTime(30000);
  });
  expect(mockRepo.syncDocumentStatus).not.toHaveBeenCalled();
});
