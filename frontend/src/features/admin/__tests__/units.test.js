// src/features/admin/__tests__/units.test.js
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { useUnitStore } from "stores/useUnitStore";
import { generatePassword } from "features/admin/utils/password";
import {
  getUnits,
  createUnit,
  updateUnit,
  deleteUnit,
  getAdminCandidates,
} from "features/admin/api";
import UnitFormModal from "features/admin/components/UnitFormModal";

jest.mock("features/admin/api");

// CRA 5's @svgr/webpack jest mapping emits a React element from an older
// runtime, which React 19 refuses to render. Stub the SVGs used by the modal
// so the component's own logic is what's under test.
jest.mock("assets/images/close.svg", () => ({
  ReactComponent: () => null,
}));
jest.mock("assets/images/chevron-down.svg", () => ({
  ReactComponent: () => null,
}));
jest.mock("assets/images/search.svg", () => ({
  ReactComponent: () => null,
}));
jest.mock("assets/images/add.svg", () => ({
  ReactComponent: () => null,
}));

const resetStore = () =>
  useUnitStore.setState({
    items: [],
    total: 0,
    page: 1,
    pageSize: 12,
    search: "",
    loading: false,
    error: null,
  });

beforeEach(() => {
  jest.clearAllMocks();
  resetStore();
});

// ── generatePassword util ─────────────────────────────────────────────

test("generatePassword_default_returnsAlphanumericOfLength12", () => {
  const pw = generatePassword();
  expect(pw).toHaveLength(12);
  expect(pw).toMatch(/^[A-Za-z0-9]+$/);
});

test("generatePassword_calledTwice_returnsDifferentValues", () => {
  expect(generatePassword()).not.toBe(generatePassword());
});

// ── store: fetch / pagination / search ────────────────────────────────

test("fetchUnits_success_populatesItemsAndTotal", async () => {
  getUnits.mockResolvedValue({
    items: [
      {
        id: 1,
        name: "Phòng A",
        parent_id: null,
        admin_username: "admin_a",
        admin_full_name: "Quản Trị A",
      },
    ],
    total: 1,
    page: 1,
    page_size: 12,
  });

  await useUnitStore.getState().fetchUnits();

  const s = useUnitStore.getState();
  expect(s.items).toHaveLength(1);
  expect(s.total).toBe(1);
  expect(s.loading).toBe(false);
});

test("fetchUnits_withSearch_passesSearchAndResetsPageToOne", async () => {
  getUnits.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 12 });

  useUnitStore.setState({ page: 3 });
  await useUnitStore.getState().fetchUnits({ search: "phòng" });

  expect(getUnits).toHaveBeenCalledWith(
    expect.objectContaining({ search: "phòng", page: 1 })
  );
  expect(useUnitStore.getState().page).toBe(1);
});

test("fetchUnits_error_setsErrorMessage", async () => {
  getUnits.mockRejectedValue(new Error("network down"));

  await useUnitStore.getState().fetchUnits();

  expect(useUnitStore.getState().error).toBe("network down");
  expect(useUnitStore.getState().loading).toBe(false);
});

// ── store: create / update / delete ───────────────────────────────────

test("createUnit_success_callsApiAndReloads", async () => {
  createUnit.mockResolvedValue({ id: 5, name: "Phòng Mới" });
  getUnits.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 12 });

  await useUnitStore.getState().createUnit({ name: "Phòng Mới" });

  expect(createUnit).toHaveBeenCalledWith({ name: "Phòng Mới" });
  expect(getUnits).toHaveBeenCalled(); // reload after mutation
});

test("updateUnit_success_callsApiWithIdAndReloads", async () => {
  updateUnit.mockResolvedValue({ id: 2, name: "Phòng B" });
  getUnits.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 12 });

  await useUnitStore.getState().updateUnit(2, { name: "Phòng B" });

  expect(updateUnit).toHaveBeenCalledWith(2, { name: "Phòng B" });
  expect(getUnits).toHaveBeenCalled();
});

test("deleteUnit_success_callsApiAndReloads", async () => {
  deleteUnit.mockResolvedValue(undefined);
  getUnits.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 12 });

  await useUnitStore.getState().deleteUnit(3);

  expect(deleteUnit).toHaveBeenCalledWith(3, undefined);
  expect(getUnits).toHaveBeenCalled();
});

test("deleteUnit_withTransfer_passesTargetToApi", async () => {
  deleteUnit.mockResolvedValue(undefined);
  getUnits.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 12 });

  await useUnitStore.getState().deleteUnit(3, 5);

  expect(deleteUnit).toHaveBeenCalledWith(3, 5);
  expect(getUnits).toHaveBeenCalled();
});

test("createUnit_apiRejects_propagatesError", async () => {
  createUnit.mockRejectedValue(new Error("Tên đơn vị đã tồn tại"));

  await expect(
    useUnitStore.getState().createUnit({ name: "Phòng A" })
  ).rejects.toThrow("Tên đơn vị đã tồn tại");
});

// ── UnitFormModal component ───────────────────────────────────────────

test("unitFormModal_addMode_rendersNameAndAdminControls", async () => {
  getAdminCandidates.mockResolvedValue([
    { id: 7, username: "carol", full_name: "Carol" },
  ]);

  render(<UnitFormModal open mode="add" onClose={() => {}} onSubmit={() => {}} />);

  expect(screen.getByLabelText(/tên đơn vị/i)).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /tìm hoặc chọn quản trị viên/i })
  ).toBeInTheDocument();
  // New-admin panel is collapsed by default; opens via the toggle button.
  expect(screen.queryByLabelText(/tên đăng nhập/i)).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: /thêm quản trị viên mới/i })
  );
  expect(screen.getByLabelText(/tên đăng nhập/i)).toBeInTheDocument();
  expect(screen.getByLabelText("Mật khẩu")).toBeInTheDocument();
});

test("unitFormModal_dropdownShowsSearchAndFilters", async () => {
  getAdminCandidates.mockResolvedValue([
    { id: 7, username: "carol", full_name: "Carol" },
    { id: 8, username: "dave", full_name: "Dave" },
  ]);

  render(
    <UnitFormModal
      open
      mode="edit"
      initialValues={{ id: 1, name: "Phòng A" }}
      onClose={() => {}}
      onSubmit={() => {}}
    />
  );
  // Wait for candidates to load.
  await screen.findByRole("button", { name: /chọn quản trị viên/i });

  // Open the dropdown.
  fireEvent.click(screen.getByRole("button", { name: /chọn quản trị viên/i }));
  const searchInput = screen.getByPlaceholderText(/tìm kiếm/i);
  expect(searchInput).toBeInTheDocument();

  expect(screen.getByText(/Carol/)).toBeInTheDocument();
  expect(screen.getByText(/Dave/)).toBeInTheDocument();

  fireEvent.change(searchInput, { target: { value: "carol" } });
  expect(screen.getByText(/Carol/)).toBeInTheDocument();
  expect(screen.queryByText(/Dave/)).not.toBeInTheDocument();
});

test("unitFormModal_searchIgnoresDiacriticsAndCase", async () => {
  getAdminCandidates.mockResolvedValue([
    { id: 7, username: "tuan", full_name: "Tuấn Anh" },
    { id: 8, username: "dave", full_name: "Dave" },
  ]);

  render(
    <UnitFormModal
      open
      mode="edit"
      initialValues={{ id: 1, name: "Phòng A" }}
      onClose={() => {}}
      onSubmit={() => {}}
    />
  );
  await screen.findByRole("button", { name: /chọn quản trị viên/i });
  fireEvent.click(screen.getByRole("button", { name: /chọn quản trị viên/i }));

  fireEvent.change(screen.getByPlaceholderText(/tìm kiếm/i), {
    target: { value: "TUAN" },
  });
  expect(screen.getByText(/Tuấn Anh/)).toBeInTheDocument();
  expect(screen.queryByText(/Dave/)).not.toBeInTheDocument();
});

test("unitFormModal_editMode_showsNewAdminButton", async () => {
  getAdminCandidates.mockResolvedValue([
    { id: 7, username: "carol", full_name: "Carol" },
  ]);

  render(
    <UnitFormModal
      open
      mode="edit"
      initialValues={{ id: 1, name: "Phòng A" }}
      onClose={() => {}}
      onSubmit={() => {}}
    />
  );
  await screen.findByRole("button", { name: /chọn quản trị viên/i });

  // Edit mode must also offer creating a brand-new admin (Figma 1018-31182).
  expect(
    screen.getByRole("button", { name: /thêm quản trị viên mới/i })
  ).toBeInTheDocument();
});

test("unitFormModal_editMode_createNewAdmin_payloadHasAdminCreds", async () => {
  getAdminCandidates.mockResolvedValue([
    { id: 7, username: "carol", full_name: "Carol" },
  ]);
  const onSubmit = jest.fn().mockResolvedValue(undefined);

  render(
    <UnitFormModal
      open
      mode="edit"
      initialValues={{
        id: 1,
        name: "Phòng A",
        admin_username: "carol",
        admin_full_name: "Carol",
      }}
      onClose={() => {}}
      onSubmit={onSubmit}
    />
  );
  await screen.findByRole("button", { name: /thêm quản trị viên mới/i });

  // Open the new-admin panel and fill in the new admin.
  fireEvent.click(
    screen.getByRole("button", { name: /thêm quản trị viên mới/i })
  );
  fireEvent.change(screen.getByLabelText(/tên đăng nhập/i), {
    target: { value: "newadmin" },
  });
  fireEvent.change(screen.getByLabelText(/họ và tên$/i), {
    target: { value: "Người Mới" },
  });
  fireEvent.change(screen.getByLabelText("Mật khẩu"), {
    target: { value: "Abc123xyz789" },
  });
  fireEvent.click(screen.getByRole("button", { name: /lưu/i }));

  // An open new-admin panel must win over the preselected candidate.
  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Phòng A",
        admin: {
          full_name: "Người Mới",
          username: "newadmin",
          password: "Abc123xyz789",
        },
      }),
      expect.objectContaining({ mode: "edit" })
    )
  );
});

test("unitFormModal_editMode_closePanel_clearsNewAdmin", async () => {
  getAdminCandidates.mockResolvedValue([
    { id: 7, username: "carol", full_name: "Carol" },
  ]);

  render(
    <UnitFormModal
      open
      mode="edit"
      initialValues={{ id: 1, name: "Phòng A" }}
      onClose={() => {}}
      onSubmit={() => {}}
    />
  );
  await screen.findByRole("button", { name: /thêm quản trị viên mới/i });

  fireEvent.click(
    screen.getByRole("button", { name: /thêm quản trị viên mới/i })
  );
  expect(screen.getByLabelText(/tên đăng nhập/i)).toBeInTheDocument();

  fireEvent.click(
    screen.getByRole("button", { name: /đóng thêm quản trị viên mới/i })
  );
  expect(screen.queryByLabelText(/tên đăng nhập/i)).not.toBeInTheDocument();
});

test("unitFormModal_selectCandidate_fillsFullNameReadonly", async () => {
  getAdminCandidates.mockResolvedValue([
    { id: 7, username: "carol", full_name: "Carol Danvers" },
  ]);

  render(
    <UnitFormModal
      open
      mode="edit"
      initialValues={{ id: 1, name: "Phòng A" }}
      onClose={() => {}}
      onSubmit={() => {}}
    />
  );
  await screen.findByRole("button", { name: /chọn quản trị viên/i });
  fireEvent.click(screen.getByRole("button", { name: /chọn quản trị viên/i }));
  fireEvent.click(screen.getByText(/Carol Danvers/));

  const fullNameField = screen.getByLabelText(/họ và tên quản trị viên/i);
  expect(fullNameField).toHaveValue("Carol Danvers");
  expect(fullNameField).toHaveAttribute("readonly");
});

test("unitFormModal_editMode_preselectsCurrentAdminByUsername", async () => {
  getAdminCandidates.mockResolvedValue([
    { id: 7, username: "carol", full_name: "Carol Danvers" },
    { id: 8, username: "dave", full_name: "Dave" },
  ]);

  render(
    <UnitFormModal
      open
      mode="edit"
      initialValues={{
        id: 1,
        name: "Phòng A",
        admin_username: "carol",
        admin_full_name: "Carol Danvers",
      }}
      onClose={() => {}}
      onSubmit={() => {}}
    />
  );

  // The trigger should show the current admin once candidates load.
  expect(
    await screen.findByRole("button", { name: /Carol Danvers/ })
  ).toBeInTheDocument();
});

test("unitFormModal_refreshButton_generatesPassword", async () => {
  getAdminCandidates.mockResolvedValue([]);

  render(<UnitFormModal open mode="add" onClose={() => {}} onSubmit={() => {}} />);

  // Open the (collapsed) new-admin panel first.
  fireEvent.click(
    screen.getByRole("button", { name: /thêm quản trị viên mới/i })
  );
  const pwInput = screen.getByLabelText("Mật khẩu");
  expect(pwInput.value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: /tạo lại/i }));
  expect(pwInput.value).toMatch(/^[A-Za-z0-9]{12}$/);
});

test("unitFormModal_submitName_callsOnSubmitWithPayload", async () => {
  getAdminCandidates.mockResolvedValue([]);
  const onSubmit = jest.fn().mockResolvedValue(undefined);

  render(
    <UnitFormModal open mode="add" onClose={() => {}} onSubmit={onSubmit} />
  );

  fireEvent.change(screen.getByLabelText(/tên đơn vị/i), {
    target: { value: "Phòng X" },
  });
  fireEvent.click(screen.getByRole("button", { name: /lưu/i }));

  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Phòng X" }),
      expect.objectContaining({ mode: "add" })
    )
  );
});
