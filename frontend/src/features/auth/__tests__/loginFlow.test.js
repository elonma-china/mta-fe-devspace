// src/features/auth/__tests__/loginFlow.test.js
//
// Story 67 — after login, the session user must come from /me so the permission
// set is present immediately (the login response omits permissions). Otherwise
// the commander role loses its kho UI until a page reload.

import { loginAndLoadUser } from "features/auth/api/authFlow";
import { login, getMe } from "features/auth/api/auth";

jest.mock("features/auth/api/auth", () => ({
  login: jest.fn(),
  getMe: jest.fn(),
}));

describe("loginAndLoadUser", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  test("returns the /me user (with permissions) and stores the token", async () => {
    login.mockResolvedValue({ token: "T", user: { id: 9, is_admin: false } });
    getMe.mockResolvedValue({
      id: 9,
      username: "thutruong_cuc",
      is_admin: false,
      unit_id: 1,
      unit_name: "Tổng",
      permissions: ["documents:read", "documents:manage"],
    });

    const me = await loginAndLoadUser("thutruong_cuc", "admin");

    expect(localStorage.getItem("token")).toBe("T");
    expect(getMe).toHaveBeenCalledTimes(1);
    // /me is a superset of the login user — keeps the legacy fields AND permissions.
    expect(me).toMatchObject({ id: 9, is_admin: false, unit_id: 1 });
    expect(me.permissions).toContain("documents:manage");
  });

  test("clears the token and rethrows when /me fails (treated as login failure)", async () => {
    login.mockResolvedValue({ token: "T", user: {} });
    getMe.mockRejectedValue(new Error("network"));

    await expect(loginAndLoadUser("u", "p")).rejects.toThrow("network");
    expect(localStorage.getItem("token")).toBeNull();
  });
});
