// src/stores/__tests__/unitRepoStore.test.js
//
// Story 82: a regular user's read-only unit-repository store. It lists the
// user's OWN unit documents (with an is_unread flag) and marks one read when
// opened — optimistically clearing the row flag AND decrementing the shared
// header badge (useDocRepoStore, the single source for the count).
import { useUnitRepoStore } from "stores/useUnitRepoStore";
import { useDocRepoStore } from "stores/useDocRepoStore";
import { getUnitRepositoryDocuments } from "features/documents/api";
import { markRepositoryDocumentRead } from "features/admin/api";

jest.mock("features/documents/api", () => ({
  __esModule: true,
  getUnitRepositoryDocuments: jest.fn(),
}));
jest.mock("features/admin/api", () => ({
  __esModule: true,
  markRepositoryDocumentRead: jest.fn(),
}));
jest.mock("features/admin/utils/docRepoFocus", () => ({
  __esModule: true,
  readFocus: () => null,
  writeFocus: jest.fn(),
  clearFocus: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useUnitRepoStore.setState({
    documents: [],
    groups: [],
    loading: false,
    error: null,
  });
  useDocRepoStore.setState({ items: [], unreadCount: 0 });
});

test("unitRepo_fetchDocuments_setsGroupsAndDocuments", async () => {
  getUnitRepositoryDocuments.mockResolvedValue({
    groups: [{ id: 1, name: "Nhóm A" }],
    documents: [{ id: "d1", name: "a.pdf", group_id: 1, is_unread: true }],
  });
  await useUnitRepoStore.getState().fetchDocuments();
  const s = useUnitRepoStore.getState();
  // own unit → no unit_id argument is sent.
  expect(getUnitRepositoryDocuments).toHaveBeenCalledWith();
  expect(s.documents).toHaveLength(1);
  expect(s.groups).toEqual([{ id: 1, name: "Nhóm A" }]);
  expect(s.loading).toBe(false);
});

test("unitRepo_fetchDocuments_error_setsErrorMessage", async () => {
  getUnitRepositoryDocuments.mockRejectedValue(new Error("boom"));
  await useUnitRepoStore.getState().fetchDocuments();
  const s = useUnitRepoStore.getState();
  expect(s.error).toBe("boom");
  expect(s.loading).toBe(false);
  expect(s.documents).toEqual([]);
});

test("unitRepo_markRead_clearsFlagAndDecrementsSharedBadge", async () => {
  markRepositoryDocumentRead.mockResolvedValue();
  useUnitRepoStore.setState({
    documents: [
      { id: "d1", is_unread: true },
      { id: "d2", is_unread: true },
    ],
  });
  useDocRepoStore.setState({ unreadCount: 2 });
  await useUnitRepoStore.getState().markRead("d1");
  const s = useUnitRepoStore.getState();
  expect(markRepositoryDocumentRead).toHaveBeenCalledWith("d1");
  expect(s.documents.find((x) => x.id === "d1").is_unread).toBe(false);
  expect(s.documents.find((x) => x.id === "d2").is_unread).toBe(true);
  // the shared header badge dropped by one.
  expect(useDocRepoStore.getState().unreadCount).toBe(1);
});

test("unitRepo_markRead_alreadyRead_noBadgeChange", async () => {
  markRepositoryDocumentRead.mockResolvedValue();
  useUnitRepoStore.setState({ documents: [{ id: "d1", is_unread: false }] });
  useDocRepoStore.setState({ unreadCount: 0 });
  await useUnitRepoStore.getState().markRead("d1");
  expect(useDocRepoStore.getState().unreadCount).toBe(0);
});

test("unitRepo_markRead_apiFailure_doesNotThrow", async () => {
  markRepositoryDocumentRead.mockRejectedValue(new Error("net"));
  useUnitRepoStore.setState({ documents: [{ id: "d1", is_unread: true }] });
  useDocRepoStore.setState({ unreadCount: 1 });
  // best-effort: a failed POST is swallowed; the optimistic update stays.
  await expect(
    useUnitRepoStore.getState().markRead("d1")
  ).resolves.toBeUndefined();
  expect(useUnitRepoStore.getState().documents[0].is_unread).toBe(false);
});
