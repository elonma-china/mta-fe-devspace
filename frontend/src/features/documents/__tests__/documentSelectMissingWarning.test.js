// src/features/documents/__tests__/documentSelectMissingWarning.test.js
//
// When the server-side reconciliation finds a document the AI service no longer
// has, it marks the row ERROR — and `visibleItems` filters ERROR rows out of the
// list. So the document vanishes from the UI. The "Tài liệu bị thiếu" modal is
// the only thing that explains why.
//
// It never fired. The gateway answers `{"missing_count": N}` and the component
// read `syncResult.missingCount`, which is always undefined, and
// `undefined > 0` is false. Testers watched documents disappear in silence and
// reported it as data loss.
import React from "react";
import { render, waitFor } from "@testing-library/react";

import DocumentSelect from "features/documents/components/DocumentSelect";

const mockShowModal = jest.fn();
const mockFetchDocuments = jest.fn();

jest.mock("components", () => ({ ActionMenu: () => null }));
jest.mock("components/common", () => ({
  AlertModal: () => null,
  DeleteModal: () => null,
  EditModal: () => null,
  PreviewModal: () => null,
}));
jest.mock("assets/images/more-vert.svg", () => ({
  ReactComponent: () => <span data-testid="more-icon" />,
}));
jest.mock("hooks/useTaskPoller", () => ({ useTaskPoller: () => {} }));

jest.mock("stores/useDocumentStore", () => {
  const docState = {
    documents: [],
    selectedDocumentIds: [],
    setSelectedDocumentIds: jest.fn(),
    pollingTasks: {},
    pending: [],
    fetchDocuments: (...args) => global.__fetchDocuments(...args),
    updateDocumentStatus: jest.fn(),
    completePolling: jest.fn(),
    deleteDocument: jest.fn(),
    renameDocument: jest.fn(),
    connectSSE: jest.fn(),
    disconnectSSE: jest.fn(),
    sseFallback: false,
  };
  const fn = () => docState;
  fn.getState = () => docState;
  return { __esModule: true, default: fn };
});
jest.mock("stores/useAuthStore", () => ({
  __esModule: true,
  default: () => ({ user: { id: "u1" } }),
}));
jest.mock("stores/useChatStore", () => {
  const st = { selectedConvId: "c1" };
  const fn = () => st;
  fn.getState = () => st;
  return { __esModule: true, default: fn };
});
jest.mock("stores/useModalStore", () => ({
  __esModule: true,
  default: () => ({
    showModal: (...args) => global.__showModal(...args),
    hideModal: jest.fn(),
  }),
}));

beforeEach(() => {
  mockShowModal.mockClear();
  mockFetchDocuments.mockReset();
  global.__showModal = mockShowModal;
  global.__fetchDocuments = mockFetchDocuments;
});

test("warnsWithTheCountTheGatewayActuallySends", async () => {
  // The gateway's shape — snake_case, straight off `sync_documents_internal`.
  mockFetchDocuments.mockResolvedValue({
    documents: [],
    syncResult: { missing_count: 2 },
  });

  render(<DocumentSelect selectAllLabel="Chọn tất cả các tài liệu" />);

  await waitFor(() => expect(mockShowModal).toHaveBeenCalled());
  const { title, message } = mockShowModal.mock.calls[0][1];
  expect(title).toBe("Tài liệu bị thiếu");
  expect(message).toContain("2");
  expect(message).not.toContain("undefined");
});

test("staysQuietWhenNothingIsMissing", async () => {
  mockFetchDocuments.mockResolvedValue({
    documents: [],
    syncResult: { missing_count: 0 },
  });

  render(<DocumentSelect selectAllLabel="Chọn tất cả các tài liệu" />);

  await waitFor(() => expect(mockFetchDocuments).toHaveBeenCalled());
  expect(mockShowModal).not.toHaveBeenCalled();
});

test("staysQuietWhenTheSyncDidNotRun", async () => {
  // A conversation opened within the 60s lazy-sync window returns no syncResult.
  mockFetchDocuments.mockResolvedValue({ documents: [] });

  render(<DocumentSelect selectAllLabel="Chọn tất cả các tài liệu" />);

  await waitFor(() => expect(mockFetchDocuments).toHaveBeenCalled());
  expect(mockShowModal).not.toHaveBeenCalled();
});
