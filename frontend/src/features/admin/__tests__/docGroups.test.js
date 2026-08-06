// src/features/admin/__tests__/docGroups.test.js
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { useDocGroupStore } from "stores/useDocGroupStore";
import {
  getGroups,
  createGroup,
  updateGroup,
  deleteGroup,
} from "features/admin/api";
import DocGroupFormModal from "features/admin/components/DocGroupFormModal";

jest.mock("features/admin/api");

// CRA 5's @svgr/webpack jest mapping emits a React element from an older
// runtime React 19 refuses to render. Stub the SVGs used by the modal.
jest.mock("assets/images/close.svg", () => ({
  ReactComponent: () => null,
}));

const resetStore = () =>
  useDocGroupStore.setState({
    items: [],
    total: 0,
    page: 1,
    pageSize: 10,
    search: "",
    unitId: null,
    loading: false,
    error: null,
  });

beforeEach(() => {
  jest.clearAllMocks();
  resetStore();
});

// ── store: fetch / pagination / search ────────────────────────────────

test("fetchGroups_success_populatesItemsFromObjectShape", async () => {
  getGroups.mockResolvedValue({
    items: [{ id: 1, name: "Bảng lương tháng" }],
    total: 1,
    page: 1,
    page_size: 10,
  });

  await useDocGroupStore.getState().fetchGroups({ page: 1 });

  const s = useDocGroupStore.getState();
  expect(s.items).toHaveLength(1);
  expect(s.items[0].name).toBe("Bảng lương tháng");
  expect(s.total).toBe(1);
});

test("fetchGroups_search_resetsToPageOneAndForwardsKeyword", async () => {
  getGroups.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 10,
  });

  await useDocGroupStore.getState().fetchGroups({ search: "công" });

  expect(getGroups).toHaveBeenCalledWith(
    expect.objectContaining({ search: "công", page: 1 }),
  );
  expect(useDocGroupStore.getState().search).toBe("công");
});

// Story 77: groups are unit-scoped — the store forwards unit_id and remembers
// it so later page/search loads stay on the same unit.
test("fetchGroups_forwardsUnitId_andRemembersItAcrossPaging", async () => {
  getGroups.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 10,
  });

  await useDocGroupStore.getState().fetchGroups({ page: 1, unitId: 5 });
  expect(getGroups).toHaveBeenCalledWith(
    expect.objectContaining({ unit_id: 5 }),
  );
  expect(useDocGroupStore.getState().unitId).toBe(5);

  // A subsequent paging load reuses the remembered unit (no unitId passed).
  getGroups.mockClear();
  await useDocGroupStore.getState().fetchGroups({ page: 2 });
  expect(getGroups).toHaveBeenCalledWith(
    expect.objectContaining({ unit_id: 5, page: 2 }),
  );
});

test("createGroup_forwardsUnitIdInPayload", async () => {
  createGroup.mockResolvedValue({ id: 9, name: "Hành chính", unit_id: 5 });
  getGroups.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 10,
  });

  await useDocGroupStore
    .getState()
    .createGroup({ name: "Hành chính", unit_id: 5 });

  expect(createGroup).toHaveBeenCalledWith({ name: "Hành chính", unit_id: 5 });
});

test("fetchGroups_failure_setsError", async () => {
  getGroups.mockRejectedValue(new Error("boom"));

  await useDocGroupStore.getState().fetchGroups({ page: 1 });

  expect(useDocGroupStore.getState().error).toBeTruthy();
  expect(useDocGroupStore.getState().loading).toBe(false);
});

test("createGroup_callsApiThenRefetches", async () => {
  createGroup.mockResolvedValue({ id: 2, name: "Công văn" });
  getGroups.mockResolvedValue({
    items: [{ id: 2, name: "Công văn" }],
    total: 1,
    page: 1,
    page_size: 10,
  });

  await useDocGroupStore.getState().createGroup({ name: "Công văn" });

  expect(createGroup).toHaveBeenCalledWith({ name: "Công văn" });
  expect(getGroups).toHaveBeenCalled();
});

test("updateGroup_callsApiThenRefetches", async () => {
  updateGroup.mockResolvedValue({ id: 2, name: "Tên mới" });
  getGroups.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 10,
  });

  await useDocGroupStore.getState().updateGroup(2, { name: "Tên mới" });

  expect(updateGroup).toHaveBeenCalledWith(2, { name: "Tên mới" });
  expect(getGroups).toHaveBeenCalled();
});

test("deleteGroup_callsApiThenRefetches", async () => {
  deleteGroup.mockResolvedValue(undefined);
  getGroups.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 10,
  });

  await useDocGroupStore.getState().deleteGroup(3);

  expect(deleteGroup).toHaveBeenCalledWith(3);
  expect(getGroups).toHaveBeenCalled();
});

// ── DocGroupFormModal ─────────────────────────────────────────────────

test("modal_add_submit_callsOnSubmitWithTrimmedName", async () => {
  const onSubmit = jest.fn().mockResolvedValue(undefined);
  render(
    <DocGroupFormModal open mode="add" onSubmit={onSubmit} onClose={() => {}} />,
  );

  fireEvent.change(screen.getByPlaceholderText("Nhập tên nhóm tài liệu"), {
    target: { value: "  Công văn  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Thêm" }));

  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith({ name: "Công văn" }),
  );
});

test("modal_edit_prefillsNameAndShowsSaveLabel", () => {
  render(
    <DocGroupFormModal
      open
      mode="edit"
      initialValues={{ id: 1, name: "Báo cáo dự án" }}
      onSubmit={() => {}}
      onClose={() => {}}
    />,
  );

  expect(screen.getByDisplayValue("Báo cáo dự án")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Lưu" })).toBeInTheDocument();
});

test("modal_emptyName_blocksSubmit", () => {
  const onSubmit = jest.fn();
  render(
    <DocGroupFormModal open mode="add" onSubmit={onSubmit} onClose={() => {}} />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Thêm" }));

  expect(onSubmit).not.toHaveBeenCalled();
});
