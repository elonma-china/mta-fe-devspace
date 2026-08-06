// src/features/documents/__tests__/repoPickerModal.test.js
import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

import RepoPickerModal from "features/documents/components/repoPicker/RepoPickerModal";
import useChatRepoStore from "stores/useChatRepoStore";

jest.mock("assets/images/x.svg", () => ({
  ReactComponent: () => <span data-testid="x" />,
}));
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

const TREE = {
  groups: [{ id: 1, name: "Kế hoạch" }],
  documents: [
    { id: "f1", name: "doc2.pdf", group_id: null },
    { id: "g1a", name: "doc4.pdf", group_id: 1 },
    { id: "g1b", name: "Doc5.doc", group_id: 1 },
  ],
};

const baseProps = {
  open: true,
  unitName: "Phòng A",
  userId: "u1",
  conversationId: "c1",
};

beforeEach(() => {
  getUnitRepositoryDocuments.mockReset().mockResolvedValue(TREE);
  linkRepositoryDocs.mockReset().mockResolvedValue({ documents: [] });
  searchUnitRepositoryDocuments
    .mockReset()
    .mockResolvedValue({ documents: [] });
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
});

test("repoPicker_opensWithUnitName_andLists", async () => {
  render(<RepoPickerModal {...baseProps} onClose={() => {}} />);
  expect(screen.getByText(/Kho tài liệu - Phòng A/)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText("doc2.pdf")).toBeInTheDocument());
  expect(screen.getByText(/Kế hoạch/)).toBeInTheDocument();
  expect(screen.getByText("Chọn tất cả")).toBeInTheDocument();
});

test("repoPicker_clickFolder_loadsRightColumn", async () => {
  render(<RepoPickerModal {...baseProps} onClose={() => {}} />);
  await waitFor(() => screen.getByText(/Kế hoạch/));
  fireEvent.click(screen.getByText(/Kế hoạch/));
  await waitFor(() => expect(screen.getByText("doc4.pdf")).toBeInTheDocument());
  expect(screen.getByText("Doc5.doc")).toBeInTheDocument();
});

test("repoPicker_importDisabled_whenNoneSelected", async () => {
  render(<RepoPickerModal {...baseProps} onClose={() => {}} />);
  await waitFor(() => screen.getByText("doc2.pdf"));
  expect(screen.getByRole("button", { name: "Tải lên" })).toBeDisabled();
});

test("repoPicker_selectAndImport_callsApiAndCloses", async () => {
  const onClose = jest.fn();
  const onImported = jest.fn();
  render(
    <RepoPickerModal {...baseProps} onImported={onImported} onClose={onClose} />
  );
  await waitFor(() => screen.getByText("doc2.pdf"));

  // tick the flat doc
  fireEvent.click(screen.getByText("doc2.pdf").closest("label").querySelector("input"));
  const importBtn = screen.getByRole("button", { name: "Tải lên" });
  expect(importBtn).not.toBeDisabled();

  fireEvent.click(importBtn);
  await waitFor(() => expect(linkRepositoryDocs).toHaveBeenCalled());
  // Story 35: 4th arg = focused unit_id (undefined for a non-super caller).
  expect(linkRepositoryDocs).toHaveBeenCalledWith("u1", "c1", ["f1"], undefined);
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(onImported).toHaveBeenCalled();
});

// ── Story 35: super-admin picks a unit (passed in as unitId/unitName) ──

test("repoPicker_superAdmin_fetchesAndLinksWithUnitId", async () => {
  const onClose = jest.fn();
  render(
    <RepoPickerModal
      open
      unitId={5}
      unitName="Phòng B"
      userId="u1"
      conversationId="c1"
      onClose={onClose}
    />
  );
  // Title shows the chosen unit; the list is scoped to that unit.
  expect(screen.getByText(/Kho tài liệu - Phòng B/)).toBeInTheDocument();
  await waitFor(() =>
    expect(getUnitRepositoryDocuments).toHaveBeenCalledWith(5)
  );
  await waitFor(() => screen.getByText("doc2.pdf"));
  fireEvent.click(
    screen.getByText("doc2.pdf").closest("label").querySelector("input")
  );
  fireEvent.click(screen.getByRole("button", { name: "Tải lên" }));
  await waitFor(() =>
    expect(linkRepositoryDocs).toHaveBeenCalledWith("u1", "c1", ["f1"], 5)
  );
});

test("repoPicker_folderRow_isTextOnlyNoIcon", async () => {
  // Story 95: Figma (node 841:48818/48830) folder rows are checkbox + name +
  // chevron, with NO folder glyph. This reverses story 44's `svg.rp-folder-icon`
  // (a faint white folder that did not match the design). Folder name stays in
  // `.rp-label`; no folder svg, no 📁 emoji.
  const { container } = render(<RepoPickerModal {...baseProps} onClose={() => {}} />);
  await waitFor(() => screen.getByText(/Kế hoạch/));
  expect(container.querySelector(".rp-folder svg.rp-folder-icon")).toBeFalsy();
  const label = screen.getByText(/Kế hoạch/).closest(".rp-label");
  expect(label).toBeTruthy();
  expect(label.textContent).not.toContain("📁");
});

test("repoPicker_empty_showsEmptyState", async () => {
  getUnitRepositoryDocuments.mockResolvedValue({ groups: [], documents: [] });
  render(<RepoPickerModal {...baseProps} onClose={() => {}} />);
  await waitFor(() =>
    expect(screen.getByText(/chưa có tài liệu/i)).toBeInTheDocument()
  );
});

// ── Story 107: semantic search (name + content) via the search box ───────

test("repoPicker_typing_debouncedSearch_rendersRankedResults", async () => {
  jest.useFakeTimers();
  searchUnitRepositoryDocuments.mockResolvedValue({
    documents: [{ id: "r1", name: "semantic-hit.pdf", group_id: null }],
  });
  render(<RepoPickerModal {...baseProps} onClose={() => {}} />);
  await act(async () => {}); // flush initial tree fetch

  fireEvent.change(screen.getByPlaceholderText("Tìm kiếm"), {
    target: { value: "hop dong" },
  });
  await act(async () => {
    jest.advanceTimersByTime(300); // debounce → searchRepo → results
  });

  // query + focused unit (undefined for a non-super caller) forwarded.
  expect(searchUnitRepositoryDocuments).toHaveBeenCalledWith("hop dong", undefined);
  expect(screen.getByText("semantic-hit.pdf")).toBeInTheDocument();
  // during an active search the tree (master row + tree docs) is hidden.
  expect(screen.queryByText("Chọn tất cả")).not.toBeInTheDocument();
  expect(screen.queryByText("doc2.pdf")).not.toBeInTheDocument();
  jest.useRealTimers();
});

test("repoPicker_clearingQuery_restoresTree", async () => {
  jest.useFakeTimers();
  searchUnitRepositoryDocuments.mockResolvedValue({
    documents: [{ id: "r1", name: "semantic-hit.pdf", group_id: null }],
  });
  render(<RepoPickerModal {...baseProps} onClose={() => {}} />);
  await act(async () => {});

  const input = screen.getByPlaceholderText("Tìm kiếm");
  fireEvent.change(input, { target: { value: "hop dong" } });
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  expect(screen.getByText("semantic-hit.pdf")).toBeInTheDocument();

  fireEvent.change(input, { target: { value: "" } });
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  // tree is back; results gone.
  expect(screen.getByText("Chọn tất cả")).toBeInTheDocument();
  expect(screen.getByText("doc2.pdf")).toBeInTheDocument();
  expect(screen.queryByText("semantic-hit.pdf")).not.toBeInTheDocument();
  jest.useRealTimers();
});

test("repoPicker_searchError_fallsBackToNameFilter", async () => {
  jest.useFakeTimers();
  searchUnitRepositoryDocuments.mockRejectedValue(new Error("ai down"));
  render(<RepoPickerModal {...baseProps} onClose={() => {}} />);
  await act(async () => {});

  fireEvent.change(screen.getByPlaceholderText("Tìm kiếm"), {
    target: { value: "doc2" },
  });
  await act(async () => {
    jest.advanceTimersByTime(300);
  });

  // AI failed → fall back to a client-side filename filter over the tree docs.
  expect(screen.getByText("doc2.pdf")).toBeInTheDocument();
  expect(screen.queryByText("Doc5.doc")).not.toBeInTheDocument();
  jest.useRealTimers();
});
