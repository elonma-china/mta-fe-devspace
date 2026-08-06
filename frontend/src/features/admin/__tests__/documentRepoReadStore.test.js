// src/features/admin/__tests__/documentRepoReadStore.test.js
//
// Story 54: the repository store tracks an unread COUNT (header badge) and marks
// a document read (optimistically: clear its is_unread flag + decrement the
// count) when the admin opens it. State is per-user on the BE; the FE just
// reflects it.
import { useDocRepoStore } from "stores/useDocRepoStore";
import {
  getRepositoryUnreadCount,
  markRepositoryDocumentRead,
} from "features/admin/api";

jest.mock("features/admin/api", () => ({
  __esModule: true,
  getRepositoryDocuments: jest.fn(),
  getRepositoryUnreadCount: jest.fn(),
  markRepositoryDocumentRead: jest.fn(),
  uploadRepositoryDocument: jest.fn(),
  updateRepositoryDocument: jest.fn(),
  deleteRepositoryDocument: jest.fn(),
  replaceRepositoryDocumentFile: jest.fn(),
  processRepositoryDocument: jest.fn(),
  getRepositoryDocumentStatus: jest.fn(),
  approveRepositoryDocument: jest.fn(),
}));
jest.mock("features/admin/utils/docRepoFocus", () => ({
  __esModule: true,
  readFocus: () => null,
  writeFocus: jest.fn(),
  clearFocus: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useDocRepoStore.setState({ items: [], unreadCount: 0 });
});

test("read_fetchUnreadCount_setsCount", async () => {
  getRepositoryUnreadCount.mockResolvedValue({ count: 5 });
  await useDocRepoStore.getState().fetchUnreadCount();
  expect(useDocRepoStore.getState().unreadCount).toBe(5);
});

test("read_fetchUnreadCount_error_hidesBadge", async () => {
  getRepositoryUnreadCount.mockRejectedValue(new Error("boom"));
  useDocRepoStore.setState({ unreadCount: 3 });
  await useDocRepoStore.getState().fetchUnreadCount();
  expect(useDocRepoStore.getState().unreadCount).toBe(0);
});

test("read_markDocumentRead_decrementsAndClearsFlag", async () => {
  markRepositoryDocumentRead.mockResolvedValue();
  useDocRepoStore.setState({
    items: [
      { id: "d1", is_unread: true },
      { id: "d2", is_unread: true },
    ],
    unreadCount: 2,
  });
  await useDocRepoStore.getState().markDocumentRead("d1");
  const s = useDocRepoStore.getState();
  expect(markRepositoryDocumentRead).toHaveBeenCalledWith("d1");
  expect(s.items.find((x) => x.id === "d1").is_unread).toBe(false);
  expect(s.items.find((x) => x.id === "d2").is_unread).toBe(true);
  expect(s.unreadCount).toBe(1);
});

test("read_markDocumentRead_alreadyRead_noNegativeCount", async () => {
  markRepositoryDocumentRead.mockResolvedValue();
  useDocRepoStore.setState({
    items: [{ id: "d1", is_unread: false }],
    unreadCount: 0,
  });
  await useDocRepoStore.getState().markDocumentRead("d1");
  expect(useDocRepoStore.getState().unreadCount).toBe(0);
});
