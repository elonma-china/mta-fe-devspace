import { docRepoTitle } from "components/layout/docRepoTitle";

test("docRepoTitle_unitAdmin_usesOwnUnit", () => {
  expect(docRepoTitle({ unitName: "Donvi 1" })).toBe(
    "Quản lý kho tài liệu - Donvi 1",
  );
});

test("docRepoTitle_superAdminFocus_usesFocusUnit", () => {
  // Super-admin's own unit ("Tổng") must NOT win over the focused unit.
  expect(
    docRepoTitle({ focusUnitName: "Donvi 1", unitName: "Tổng" }),
  ).toBe("Quản lý kho tài liệu - Donvi 1");
});

test("docRepoTitle_noUnit_omitsSuffix", () => {
  expect(docRepoTitle({})).toBe("Quản lý kho tài liệu");
});
