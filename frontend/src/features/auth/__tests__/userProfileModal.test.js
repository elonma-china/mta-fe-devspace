// src/features/auth/__tests__/userProfileModal.test.js
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { getUnits, getRoles } from "features/admin/api";
import UserProfileModal from "features/auth/components/UserProfileModal";
import useAuthStore from "stores/useAuthStore";

jest.mock("features/admin/api");

// CRA 5's @svgr/webpack jest mapping emits a React element from an older
// runtime; stub the SVGs the modal imports so React 19 can render it.
jest.mock("assets/images/close.svg", () => ({ ReactComponent: () => null }));
jest.mock("assets/images/chevron-down.svg", () => ({
  ReactComponent: () => null,
}));

// Roles as the backend returns them for a super-admin: per-unit admin/member
// pairs (duplicated names across units) plus the global commander ("Chỉ huy")
// anchored to the root unit (id 1), is_admin false (story 66 / ADR-037).
const SUPER_ADMIN_ROLES = [
  { id: 1, name: "Chỉ huy", unit_id: 1, is_admin: false },
  { id: 10, name: "Quản trị viên", unit_id: 1, is_admin: true },
  { id: 11, name: "Người dùng", unit_id: 1, is_admin: false },
  { id: 20, name: "Quản trị viên", unit_id: 2, is_admin: true },
  { id: 21, name: "Người dùng", unit_id: 2, is_admin: false },
];

const UNITS = {
  items: [
    { id: 1, name: "Tổng cục", parent_id: null },
    { id: 2, name: "Phòng B", parent_id: 1 },
  ],
  total: 2,
  page: 1,
  page_size: 12,
};

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ user: null });
});

afterEach(() => {
  useAuthStore.setState({ user: null });
});

function asSuperAdmin() {
  // structural super-admin: admin with no own unit (ADR-003).
  useAuthStore.setState({ user: { is_admin: true, unit_id: null } });
}

function asUnitAdmin(unitId = 2) {
  useAuthStore.setState({ user: { is_admin: true, unit_id: unitId } });
}

// Regression guard (story 01/04): getUnits() returns a paginated object, not a
// bare array. The create-user modal must consume the new shape without crashing.
test("userProfileModal_open_doesNotCrash_withPaginatedUnits", async () => {
  asSuperAdmin();
  getUnits.mockResolvedValue(UNITS);
  getRoles.mockResolvedValue(SUPER_ADMIN_ROLES);

  render(<UserProfileModal open mode="add" onClose={() => {}} onSubmit={() => {}} />);

  expect(
    await screen.findByText(/thêm người dùng|chỉnh sửa/i)
  ).toBeInTheDocument();

  // Super-admin sees the unit dropdown → options come from getUnits().items.
  fireEvent.click(screen.getByRole("button", { name: /chọn đơn vị/i }));
  expect(await screen.findByText("Tổng cục")).toBeInTheDocument();
  expect(screen.getByText("Phòng B")).toBeInTheDocument();
});

// Story 72: for super-admins the field order is Vai trò ABOVE Đơn vị, and the
// role dropdown offers the global commander role "Chỉ huy".
test("superAdmin_roleFieldAboveUnit_andHasCommanderOption", async () => {
  asSuperAdmin();
  getUnits.mockResolvedValue(UNITS);
  getRoles.mockResolvedValue(SUPER_ADMIN_ROLES);

  render(<UserProfileModal open mode="add" onClose={() => {}} onSubmit={() => {}} />);

  const roleLabel = await screen.findByText("Vai trò");
  const unitLabel = screen.getByText("Đơn vị");
  // Vai trò appears before Đơn vị in document order.
  expect(
    roleLabel.compareDocumentPosition(unitLabel) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();

  // Open role dropdown → commander option present (deduped role types).
  fireEvent.click(screen.getByRole("button", { name: /chọn vai trò/i }));
  expect(await screen.findByText("Chỉ huy")).toBeInTheDocument();
});

// Story 72: choosing "Chỉ huy" disables the unit picker (commander is global),
// labels it "Toàn bộ đơn vị", and submits unit_id = root (1) + commander role.
test("superAdmin_pickCommander_disablesUnit_submitsRootAndCommanderRole", async () => {
  asSuperAdmin();
  getUnits.mockResolvedValue(UNITS);
  getRoles.mockResolvedValue(SUPER_ADMIN_ROLES);
  const onSubmit = jest.fn();

  render(<UserProfileModal open mode="add" onClose={() => {}} onSubmit={onSubmit} />);

  fireEvent.click(await screen.findByRole("button", { name: /chọn vai trò/i }));
  fireEvent.click(await screen.findByText("Chỉ huy"));

  // Unit picker becomes a disabled "Toàn bộ đơn vị" control.
  const unitBtn = await screen.findByRole("button", { name: /toàn bộ đơn vị/i });
  expect(unitBtn).toBeDisabled();

  // Story 73: the permission note reads with proper casing/grammar.
  expect(
    screen.getByText(
      'Vai trò "Chỉ huy" có quyền xem toàn bộ tài liệu của mọi đơn vị.'
    )
  ).toBeInTheDocument();

  fireEvent.change(screen.getByPlaceholderText("Nhập họ và tên"), {
    target: { value: "Chỉ Huy A" },
  });
  fireEvent.change(screen.getByPlaceholderText(/viết liền/i), {
    target: { value: "chihuya" },
  });
  fireEvent.change(screen.getByPlaceholderText("Mật khẩu"), {
    target: { value: "secret" },
  });

  const addBtn = screen.getByRole("button", { name: "Thêm" });
  await waitFor(() => expect(addBtn).not.toBeDisabled());
  fireEvent.click(addBtn);

  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(onSubmit.mock.calls[0][0]).toMatchObject({
    name: "Chỉ Huy A",
    username: "chihuya",
    unit_id: 1,
    role_id: 1,
  });
});

// Story 72 (inverts ADR-007): changing the unit KEEPS the chosen role type and
// re-resolves role_id for the new unit (no reset to empty / disabled Save).
test("superAdmin_changeUnit_keepsRoleType_resolvesRoleIdForNewUnit", async () => {
  asSuperAdmin();
  getUnits.mockResolvedValue(UNITS);
  getRoles.mockResolvedValue(SUPER_ADMIN_ROLES);
  const onSubmit = jest.fn();

  render(<UserProfileModal open mode="add" onClose={() => {}} onSubmit={onSubmit} />);

  // Pick the "Quản trị viên" role type.
  fireEvent.click(await screen.findByRole("button", { name: /chọn vai trò/i }));
  fireEvent.click(await screen.findByText("Quản trị viên"));

  // Pick unit "Phòng B" (id 2) → role resolves to admin role of unit 2.
  fireEvent.click(screen.getByRole("button", { name: /chọn đơn vị/i }));
  fireEvent.click(await screen.findByText("Phòng B"));

  // Change unit to "Tổng cục" (id 1) → role re-resolves (not reset).
  fireEvent.click(screen.getByRole("button", { name: /phòng b/i }));
  fireEvent.click(await screen.findByText("Tổng cục"));

  fireEvent.change(screen.getByPlaceholderText("Nhập họ và tên"), {
    target: { value: "QTV A" },
  });
  fireEvent.change(screen.getByPlaceholderText(/viết liền/i), {
    target: { value: "qtva" },
  });
  fireEvent.change(screen.getByPlaceholderText("Mật khẩu"), {
    target: { value: "secret" },
  });

  const addBtn = screen.getByRole("button", { name: "Thêm" });
  // Save stays enabled (role_id was re-resolved, not cleared).
  await waitFor(() => expect(addBtn).not.toBeDisabled());
  fireEvent.click(addBtn);

  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(onSubmit.mock.calls[0][0]).toMatchObject({
    unit_id: 1,
    role_id: 10, // admin role of unit 1
  });
});

// Story 72: a UNIT admin creating a new user gets a slimmed form — no Đơn vị,
// no Vai trò — and the new user defaults to the admin's unit + member role.
test("unitAdmin_addMode_hidesUnitAndRole_submitsDefaults", async () => {
  asUnitAdmin(2);
  getUnits.mockResolvedValue(UNITS);
  getRoles.mockResolvedValue(SUPER_ADMIN_ROLES);
  const onSubmit = jest.fn();

  render(<UserProfileModal open mode="add" onClose={() => {}} onSubmit={onSubmit} />);

  await screen.findByText(/thêm người dùng/i);
  // Unit + role fields are hidden for a unit admin creating a user.
  expect(screen.queryByText("Đơn vị")).not.toBeInTheDocument();
  expect(screen.queryByText("Vai trò")).not.toBeInTheDocument();

  fireEvent.change(screen.getByPlaceholderText("Nhập họ và tên"), {
    target: { value: "Nhan Vien" },
  });
  fireEvent.change(screen.getByPlaceholderText(/viết liền/i), {
    target: { value: "nhanvien" },
  });
  fireEvent.change(screen.getByPlaceholderText("Mật khẩu"), {
    target: { value: "secret" },
  });

  const addBtn = screen.getByRole("button", { name: "Thêm" });
  await waitFor(() => expect(addBtn).not.toBeDisabled());
  fireEvent.click(addBtn);

  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(onSubmit.mock.calls[0][0]).toMatchObject({
    name: "Nhan Vien",
    username: "nhanvien",
    unit_id: 2, // admin's own unit
    role_id: 21, // member ("Người dùng") role of unit 2
  });
});

// Story 92: clicking the X while a lookup is OPEN must close the modal (not be
// swallowed by the dropdown's click-outside handler). With the overlay dropdown
// the dialog no longer resizes, so the X stays put and the close click lands.
test("closeButton_whileDropdownOpen_closesModal", async () => {
  asSuperAdmin();
  getUnits.mockResolvedValue(UNITS);
  getRoles.mockResolvedValue(SUPER_ADMIN_ROLES);
  const onClose = jest.fn();

  render(
    <UserProfileModal open mode="add" onClose={onClose} onSubmit={() => {}} />
  );

  // Open the unit lookup.
  fireEvent.click(await screen.findByRole("button", { name: /chọn đơn vị/i }));
  expect(await screen.findByText("Tổng cục")).toBeInTheDocument();

  // Click X → modal closes (one click), not just the dropdown.
  fireEvent.click(screen.getByRole("button", { name: /đóng/i }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

// Story 94 (supersedes story 72's edit behavior): a unit admin EDITING a user
// ALSO hides Vai trò + Đơn vị — consistent with the create form. The unit admin
// only edits Họ tên / Tên đăng nhập / Mật khẩu; the user's role + unit are kept.
test("unitAdmin_editMode_alsoHidesFields_keepsRoleAndUnit", async () => {
  asUnitAdmin(2);
  getUnits.mockResolvedValue(UNITS);
  getRoles.mockResolvedValue(SUPER_ADMIN_ROLES);
  const onSubmit = jest.fn();

  render(
    <UserProfileModal
      open
      mode="edit"
      initialValues={{
        fullName: "Nguyen A",
        unit_id: 2,
        role_id: 20,
        username: "nguyena",
      }}
      onClose={() => {}}
      onSubmit={onSubmit}
    />
  );

  await screen.findByText(/chỉnh sửa/i);
  // Hidden for a unit admin in EDIT mode too (was shown — story 72 bug).
  expect(screen.queryByText("Vai trò")).not.toBeInTheDocument();
  expect(screen.queryByText("Đơn vị")).not.toBeInTheDocument();

  // Editing the name and saving keeps the user's existing unit + role.
  fireEvent.change(screen.getByDisplayValue("Nguyen A"), {
    target: { value: "Nguyen B" },
  });
  const saveBtn = screen.getByRole("button", { name: "Lưu" });
  await waitFor(() => expect(saveBtn).not.toBeDisabled());
  fireEvent.click(saveBtn);
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(onSubmit.mock.calls[0][0]).toMatchObject({
    name: "Nguyen B",
    username: "nguyena",
    unit_id: 2,
    role_id: 20,
  });
});
