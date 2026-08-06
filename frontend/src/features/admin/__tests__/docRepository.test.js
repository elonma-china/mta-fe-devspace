// src/features/admin/__tests__/docRepository.test.js
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { useDocRepoStore } from "stores/useDocRepoStore";
import {
  getRepositoryDocuments,
  updateRepositoryDocument,
  deleteRepositoryDocument,
  replaceRepositoryDocumentFile,
  processRepositoryDocument,
} from "features/admin/api";
import DocumentEditModal from "features/admin/components/DocumentEditModal";
import { FOCUS_STORAGE_KEY } from "features/admin/utils/docRepoFocus";

jest.mock("features/admin/api");

// CRA 5's @svgr/webpack jest mapping emits a React element from an older
// runtime React 19 refuses to render. Stub the SVGs used by the modal.
jest.mock("assets/images/close.svg", () => ({ ReactComponent: () => null }));
jest.mock("assets/images/upload-file.svg", () => ({
  ReactComponent: () => null,
}));
jest.mock("assets/images/delete.svg", () => ({ ReactComponent: () => null }));
// Stub the file picker so the edit modal renders without the documents-feature
// upload pipeline; expose a hook to simulate choosing a file.
jest.mock("features/documents/components/UploadFileSection", () => ({
  __esModule: true,
  // Story 112: also render the `dropTitle` prop so a test can assert the modal
  // wires the Figma dropzone title through to the shared upload section.
  default: ({ buttonLabel, dropTitle }) => (
    <div>
      {buttonLabel}
      {dropTitle ? <div>{dropTitle}</div> : null}
    </div>
  ),
}));

const resetStore = () =>
  useDocRepoStore.setState({
    items: [],
    total: 0,
    page: 1,
    pageSize: 15,
    search: "",
    groupIds: [],
    focusUnitId: null,
    focusUnitName: "",
    loading: false,
    error: null,
  });

beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.clear();
  resetStore();
});

// ── store ─────────────────────────────────────────────────────────────

test("fetchDocuments_success_populatesItemsFromObjectShape", async () => {
  getRepositoryDocuments.mockResolvedValue({
    items: [
      {
        id: "a",
        name: "Bảng chấm công.pdf",
        doc_number: "ĐM-11/CN",
        summary: "Bảng chấm công",
        group_id: 1,
        group_name: "Bảng lương tháng",
        created_at: "2026-05-24T00:00:00Z",
      },
    ],
    total: 1,
    page: 1,
    page_size: 15,
  });

  await useDocRepoStore.getState().fetchDocuments({ page: 1 });

  const s = useDocRepoStore.getState();
  expect(s.items).toHaveLength(1);
  expect(s.items[0].doc_number).toBe("ĐM-11/CN");
  expect(s.total).toBe(1);
});

test("fetchDocuments_withSearchAndGroupIds_forwardsParams", async () => {
  getRepositoryDocuments.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 15,
  });

  await useDocRepoStore
    .getState()
    .fetchDocuments({ search: "công", groupIds: [1, 2] });

  expect(getRepositoryDocuments).toHaveBeenCalledWith(
    expect.objectContaining({ search: "công", group_ids: [1, 2], page: 1 }),
  );
  expect(useDocRepoStore.getState().search).toBe("công");
  expect(useDocRepoStore.getState().groupIds).toEqual([1, 2]);
});

test("fetchDocuments_clearGroupIds_returnsAllAndResetsPage", async () => {
  getRepositoryDocuments.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 15,
  });

  // Start filtered + on a later page.
  useDocRepoStore.setState({ groupIds: [1, 2], page: 3 });

  await useDocRepoStore.getState().fetchDocuments({ groupIds: [] });

  // API is asked for the unfiltered list, reset to page 1.
  expect(getRepositoryDocuments).toHaveBeenCalledWith(
    expect.objectContaining({ group_ids: [], page: 1 }),
  );
  expect(useDocRepoStore.getState().groupIds).toEqual([]);
  expect(useDocRepoStore.getState().page).toBe(1);
});

test("fetchDocuments_afterClear_searchDoesNotResurrectGroups", async () => {
  getRepositoryDocuments.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 15,
  });

  // Filter, then clear, then search — the cleared groups must NOT come back.
  await useDocRepoStore.getState().fetchDocuments({ groupIds: [1, 2] });
  await useDocRepoStore.getState().fetchDocuments({ groupIds: [] });
  await useDocRepoStore.getState().fetchDocuments({ search: "abc" });

  const lastCall = getRepositoryDocuments.mock.calls.at(-1)[0];
  expect(lastCall.group_ids).toEqual([]);
  expect(lastCall.search).toBe("abc");
});

test("setGroupFilter_clearsToEmpty_andRefetchesUnfiltered", async () => {
  getRepositoryDocuments.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 15,
  });

  // The dropdown drives the store directly (single source of truth) — no
  // page-local mirror that can desync. Selecting groups then clearing must
  // collapse the filter back to "all".
  await useDocRepoStore.getState().setGroupFilter([1, 2]);
  expect(useDocRepoStore.getState().groupIds).toEqual([1, 2]);

  await useDocRepoStore.getState().setGroupFilter([]);

  expect(useDocRepoStore.getState().groupIds).toEqual([]);
  const lastCall = getRepositoryDocuments.mock.calls.at(-1)[0];
  expect(lastCall.group_ids).toEqual([]);
  expect(lastCall.page).toBe(1);
});

test("updateDocument_callsApiThenRefetches", async () => {
  updateRepositoryDocument.mockResolvedValue({ id: "a" });
  getRepositoryDocuments.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 15,
  });

  await useDocRepoStore
    .getState()
    .updateDocument("a", { name: "X", doc_number: "Y" });

  expect(updateRepositoryDocument).toHaveBeenCalledWith("a", {
    name: "X",
    doc_number: "Y",
  });
  expect(getRepositoryDocuments).toHaveBeenCalled();
});

test("deleteDocument_callsApiThenRefetches", async () => {
  deleteRepositoryDocument.mockResolvedValue(undefined);
  getRepositoryDocuments.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 15,
  });

  await useDocRepoStore.getState().deleteDocument("a");

  expect(deleteRepositoryDocument).toHaveBeenCalledWith("a");
  expect(getRepositoryDocuments).toHaveBeenCalled();
});

test("setFocusUnit_storesUnitAndForwardsToList", async () => {
  getRepositoryDocuments.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 15,
  });

  // Super-admin focuses a unit → store holds it and every list request carries
  // the unit_id so the BE scopes to that unit's repository.
  await useDocRepoStore.getState().setFocusUnit(5, "Phòng A");

  expect(useDocRepoStore.getState().focusUnitId).toBe(5);
  expect(useDocRepoStore.getState().focusUnitName).toBe("Phòng A");
  const lastCall = getRepositoryDocuments.mock.calls.at(-1)[0];
  expect(lastCall.unit_id).toBe(5);
});

test("setFocusUnit_persistsToSessionStorage", async () => {
  getRepositoryDocuments.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 15,
  });

  await useDocRepoStore.getState().setFocusUnit(7, "Phòng B");

  // Survives F5: the choice is in sessionStorage under the shared key.
  expect(JSON.parse(sessionStorage.getItem(FOCUS_STORAGE_KEY))).toEqual({
    id: 7,
    name: "Phòng B",
  });
});

test("resetFocus_clearsSessionStorage", async () => {
  getRepositoryDocuments.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 15,
  });
  await useDocRepoStore.getState().setFocusUnit(7, "Phòng B");

  useDocRepoStore.getState().resetFocus();

  expect(useDocRepoStore.getState().focusUnitId).toBeNull();
  expect(sessionStorage.getItem(FOCUS_STORAGE_KEY)).toBeNull();
});

test("afterResetFocus_listOmitsStaleUnitId", async () => {
  getRepositoryDocuments.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 15,
  });
  // A super-admin focused a unit (persisted), then a unit admin enters and the
  // page clears the focus. The next list MUST NOT carry the stale unit_id, or
  // the BE would 403 the unit admin (story-12 bug).
  await useDocRepoStore.getState().setFocusUnit(99, "Đơn vị cũ");
  useDocRepoStore.getState().resetFocus();

  await useDocRepoStore.getState().fetchDocuments({ search: "", groupIds: [] });

  const lastCall = getRepositoryDocuments.mock.calls.at(-1)[0];
  expect(lastCall.unit_id).toBeNull();
});

test("replaceDocumentFile_callsApiThenRefetches", async () => {
  replaceRepositoryDocumentFile.mockResolvedValue({ id: "new" });
  getRepositoryDocuments.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 15,
  });
  const file = new File(["x"], "new.pdf", { type: "application/pdf" });

  await useDocRepoStore.getState().replaceDocumentFile("a", file);

  expect(replaceRepositoryDocumentFile).toHaveBeenCalledWith("a", file);
  expect(getRepositoryDocuments).toHaveBeenCalled();
});

// ── DocumentEditModal ─────────────────────────────────────────────────

test("editModal_prefillsFields_andSavesMetadata", async () => {
  const onSubmit = jest.fn().mockResolvedValue(undefined);
  render(
    <DocumentEditModal
      open
      initialValues={{
        id: "a",
        name: "Báo cáo.pdf",
        doc_number: "ĐM-11/CN",
        summary: "tóm tắt",
        group_id: 2,
      }}
      groups={[
        { id: 1, name: "Bảng lương tháng" },
        { id: 2, name: "Báo cáo dự án" },
      ]}
      onSubmit={onSubmit}
      onClose={() => {}}
    />,
  );

  expect(screen.getByDisplayValue("Báo cáo.pdf")).toBeInTheDocument();
  expect(screen.getByDisplayValue("ĐM-11/CN")).toBeInTheDocument();
  expect(screen.getByDisplayValue("tóm tắt")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Lưu" }));

  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Báo cáo.pdf",
        doc_number: "ĐM-11/CN",
        summary: "tóm tắt",
        group_id: 2,
      }),
      // No replacement file chosen → metadata-only (second arg null).
      null,
      // Story 48: 3rd arg = approve flag; false here (doc has no COMPLETED status).
      false,
    ),
  );
});

test("editModal_rendersFileRow_warning_dropzone", () => {
  render(
    <DocumentEditModal
      open
      initialValues={{
        id: "a",
        name: "Báo cáo kiểm toán.pdf",
        doc_number: "X-1",
        summary: "tóm tắt",
        group_id: 2,
      }}
      groups={[{ id: 2, name: "Báo cáo dự án" }]}
      onSubmit={jest.fn()}
      onClose={() => {}}
    />,
  );

  // Figma 841-48773: existing-file row + overwrite warning + replace dropzone.
  expect(screen.getByText("Báo cáo kiểm toán.pdf")).toBeInTheDocument();
  expect(
    screen.getByText(/ghi đè nội dung lên file hiện có/i),
  ).toBeInTheDocument();
  expect(screen.getByText("Tải tài liệu lên")).toBeInTheDocument();
});

test("editModal_emptyName_blocksSubmit", () => {
  const onSubmit = jest.fn();
  render(
    <DocumentEditModal
      open
      initialValues={{ id: "a", name: "  ", doc_number: "", summary: "" }}
      groups={[]}
      onSubmit={onSubmit}
      onClose={() => {}}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Lưu" }));

  expect(onSubmit).not.toHaveBeenCalled();
});

// ── Story 112: Figma 841-48773 mapping fixes ─────────────────────────────

test("editModal_fieldOrder_soVanBanBeforeTenVanBan", () => {
  render(
    <DocumentEditModal
      open
      initialValues={{ id: "a", name: "x", doc_number: "n", summary: "s" }}
      groups={[]}
      onSubmit={jest.fn()}
      onClose={() => {}}
    />,
  );
  // Figma 841-48773: "Số văn bản" is the first field, above "Tên văn bản".
  const so = screen.getByText("Số văn bản");
  const ten = screen.getByText("Tên văn bản");
  expect(
    so.compareDocumentPosition(ten) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

test("editModal_showsTaiLieuLabel_aboveFileRow", () => {
  render(
    <DocumentEditModal
      open
      initialValues={{ id: "a", name: "Báo cáo.pdf", doc_number: "", summary: "" }}
      groups={[]}
      onSubmit={jest.fn()}
      onClose={() => {}}
    />,
  );
  // Figma 841-48773: a "Tài liệu" field label sits above the existing-file row.
  expect(screen.getByText("Tài liệu")).toBeInTheDocument();
});

test("editModal_passesFigmaDropTitle_toUploadSection", () => {
  render(
    <DocumentEditModal
      open
      initialValues={{ id: "a", name: "x", doc_number: "", summary: "" }}
      groups={[]}
      onSubmit={jest.fn()}
      onClose={() => {}}
    />,
  );
  // Figma 841-48773 dropzone title, wired through to UploadFileSection (mocked
  // above to echo its dropTitle prop).
  expect(
    screen.getByText(/nhấn tải lên để Tải tài liệu lên để bắt đầu/i),
  ).toBeInTheDocument();
});

// ── Story 34: (re)process a repository document ──────────────────────────

test("processDocument_callsApi_andRefetches", async () => {
  processRepositoryDocument.mockResolvedValue({ id: "a", status: "PROCESSING" });
  getRepositoryDocuments.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 15,
  });

  await useDocRepoStore.getState().processDocument("a");

  expect(processRepositoryDocument).toHaveBeenCalledWith("a");
  // After processing the store refetches the current page so the new status shows.
  expect(getRepositoryDocuments).toHaveBeenCalled();
});

test("processDocument_clearsProcessingFlag_afterDone", async () => {
  processRepositoryDocument.mockResolvedValue({});
  getRepositoryDocuments.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 15,
  });

  await useDocRepoStore.getState().processDocument("a");

  // The per-doc "processing" flag is cleared once the call resolves.
  expect(useDocRepoStore.getState().processing.a).toBeFalsy();
});
