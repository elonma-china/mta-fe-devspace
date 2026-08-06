// src/features/admin/__tests__/screenTitle.test.js
//
// Story 117: the admin header title is dynamic per ACTIVE TAB (single source of
// truth). These pure helpers compute the title each admin page pushes to the
// page-title store; the header just displays it. Fixes the old bug where the
// header hardcoded a per-route title (wrong on the "units"/"groups" tabs).
import { userScreenTitle, docScreenTitle } from "features/admin/utils/screenTitle";

describe("userScreenTitle (story 117)", () => {
  test("usersTab_returnsUserManagement", () => {
    expect(userScreenTitle("users")).toBe("Quản lý người dùng");
  });
  test("unitsTab_returnsUnitManagement", () => {
    expect(userScreenTitle("units")).toBe("Quản lý đơn vị");
  });
});

describe("docScreenTitle (story 117)", () => {
  test("documentsTab_returnsRepoTitle_noUnit", () => {
    expect(docScreenTitle("documents", {})).toBe("Quản lý kho tài liệu");
  });
  test("documentsTab_withFocusUnit_appendsUnit", () => {
    expect(docScreenTitle("documents", { focusUnitName: "Đơn vị 5" })).toBe(
      "Quản lý kho tài liệu - Đơn vị 5"
    );
  });
  test("groupsTab_returnsGroupManagement", () => {
    // The groups tab title is standalone (no unit suffix).
    expect(docScreenTitle("groups", { focusUnitName: "Đơn vị 5" })).toBe(
      "Quản lý nhóm tài liệu"
    );
  });
});
