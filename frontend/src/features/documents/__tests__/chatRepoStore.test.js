// src/features/documents/__tests__/chatRepoStore.test.js
import useChatRepoStore from "stores/useChatRepoStore";

jest.mock("features/documents/api", () => ({
  getUnitRepositoryDocuments: jest.fn(),
  linkRepositoryDocs: jest.fn(),
  searchUnitRepositoryDocuments: jest.fn(),
}));

import {
  getUnitRepositoryDocuments,
  linkRepositoryDocs,
  searchUnitRepositoryDocuments,
} from "features/documents/api";

const reset = () =>
  useChatRepoStore.setState({
    groups: [],
    documents: [],
    openFolderId: null,
    selectedIds: [],
    loading: false,
    error: null,
    importing: false,
    searchResults: [],
    searching: false,
    searchError: null,
  });

beforeEach(() => {
  getUnitRepositoryDocuments.mockReset();
  linkRepositoryDocs.mockReset();
  searchUnitRepositoryDocuments.mockReset();
  reset();
});

test("chatRepoStore_fetchRepo_mapsGroupsAndDocs", async () => {
  getUnitRepositoryDocuments.mockResolvedValue({
    groups: [{ id: 1, name: "Kế hoạch" }],
    documents: [{ id: "d1", name: "a.pdf", group_id: 1 }],
  });
  await useChatRepoStore.getState().fetchRepo();
  const s = useChatRepoStore.getState();
  expect(s.groups).toHaveLength(1);
  expect(s.documents[0].id).toBe("d1");
  expect(s.loading).toBe(false);
});

test("chatRepoStore_fetchRepo_handlesError", async () => {
  getUnitRepositoryDocuments.mockRejectedValue(new Error("boom"));
  await useChatRepoStore.getState().fetchRepo();
  const s = useChatRepoStore.getState();
  expect(s.error).toBe("boom");
  expect(s.documents).toEqual([]);
});

test("chatRepoStore_twoLevelSelection_folderTogglesChildren", () => {
  useChatRepoStore.setState({
    documents: [
      { id: "g1a", name: "x", group_id: 1 },
      { id: "g1b", name: "y", group_id: 1 },
    ],
  });
  useChatRepoStore.getState().toggleFolderSelection(1);
  expect(new Set(useChatRepoStore.getState().selectedIds)).toEqual(
    new Set(["g1a", "g1b"])
  );
});

test("chatRepoStore_importSelected_callsApiAndClears", async () => {
  linkRepositoryDocs.mockResolvedValue({ documents: [] });
  useChatRepoStore.setState({ selectedIds: ["d1", "d2"] });
  const ok = await useChatRepoStore.getState().importSelected("u1", "c1");
  expect(ok).toBe(true);
  // Story 35: 4th arg = focused unit_id (undefined for a non-super caller).
  expect(linkRepositoryDocs).toHaveBeenCalledWith(
    "u1",
    "c1",
    ["d1", "d2"],
    undefined
  );
  expect(useChatRepoStore.getState().selectedIds).toEqual([]);
});

test("chatRepoStore_fetchRepo_passesUnitId", async () => {
  // Story 35: a super-admin's focused unit is forwarded to the list API.
  getUnitRepositoryDocuments.mockResolvedValue({ groups: [], documents: [] });
  await useChatRepoStore.getState().fetchRepo(5);
  expect(getUnitRepositoryDocuments).toHaveBeenCalledWith(5);
});

test("chatRepoStore_importSelected_passesUnitId", async () => {
  // Story 35: import forwards the focused unit_id for scope validation.
  linkRepositoryDocs.mockResolvedValue({ documents: [] });
  useChatRepoStore.setState({ selectedIds: ["d1"] });
  await useChatRepoStore.getState().importSelected("u1", "c1", 5);
  expect(linkRepositoryDocs).toHaveBeenCalledWith("u1", "c1", ["d1"], 5);
});

test("chatRepoStore_importSelected_noneSelected_returnsFalse", async () => {
  const ok = await useChatRepoStore.getState().importSelected("u1", "c1");
  expect(ok).toBe(false);
  expect(linkRepositoryDocs).not.toHaveBeenCalled();
});

test("chatRepoStore_importSelected_handlesError", async () => {
  linkRepositoryDocs.mockRejectedValue(new Error("link fail"));
  useChatRepoStore.setState({ selectedIds: ["d1"] });
  const ok = await useChatRepoStore.getState().importSelected("u1", "c1");
  expect(ok).toBe(false);
  expect(useChatRepoStore.getState().error).toBe("link fail");
});

// ── Story 107: semantic search (name + content) ──────────────────────────

test("chatRepoStore_searchRepo_setsRankedResults", async () => {
  searchUnitRepositoryDocuments.mockResolvedValue({
    documents: [{ id: "d2", name: "b.pdf", group_id: null }],
  });
  await useChatRepoStore.getState().searchRepo("bao cao", 5);
  const s = useChatRepoStore.getState();
  // query + focused unit forwarded to the search API.
  expect(searchUnitRepositoryDocuments).toHaveBeenCalledWith("bao cao", 5);
  expect(s.searchResults).toEqual([{ id: "d2", name: "b.pdf", group_id: null }]);
  expect(s.searching).toBe(false);
  expect(s.searchError).toBeNull();
});

test("chatRepoStore_searchRepo_emptyQuery_clearsWithoutCall", async () => {
  useChatRepoStore.setState({ searchResults: [{ id: "x", name: "x" }] });
  await useChatRepoStore.getState().searchRepo("   ");
  expect(searchUnitRepositoryDocuments).not.toHaveBeenCalled();
  expect(useChatRepoStore.getState().searchResults).toEqual([]);
});

test("chatRepoStore_searchRepo_handlesError", async () => {
  searchUnitRepositoryDocuments.mockRejectedValue(new Error("ai down"));
  await useChatRepoStore.getState().searchRepo("bao cao");
  const s = useChatRepoStore.getState();
  expect(s.searchError).toBe("ai down");
  expect(s.searching).toBe(false);
});

test("chatRepoStore_clearSearch_resetsSearchState", () => {
  useChatRepoStore.setState({
    searchResults: [{ id: "x", name: "x" }],
    searching: true,
    searchError: "e",
  });
  useChatRepoStore.getState().clearSearch();
  const s = useChatRepoStore.getState();
  expect(s.searchResults).toEqual([]);
  expect(s.searching).toBe(false);
  expect(s.searchError).toBeNull();
});
