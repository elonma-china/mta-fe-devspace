// src/lib/__tests__/roles.test.js
//
// Story 66 — RBAC granular helpers: capability checks gate the kho/document
// domain by permission so the commander role (is_admin false) is allowed, while
// the super-admin helper keeps its existing behaviour.

import {
  can,
  canManageDocuments,
  canManageUnits,
  isRepoSuperAdmin,
  isSuperAdmin,
  ROOT_UNIT_ID,
} from "lib/roles";

const COMMANDER = {
  is_admin: false,
  unit_id: ROOT_UNIT_ID,
  permissions: ["documents:read", "documents:manage", "docgroups:manage", "units:read"],
};
const REGULAR = { is_admin: false, unit_id: 3, permissions: [] };
const UNIT_ADMIN = { is_admin: true, unit_id: 4 };
const SUPER_ADMIN = { is_admin: true, unit_id: ROOT_UNIT_ID };

describe("can", () => {
  test("true only when the action is present in permissions", () => {
    expect(can(COMMANDER, "documents:manage")).toBe(true);
    expect(can(COMMANDER, "users:manage")).toBe(false);
    expect(can(REGULAR, "documents:read")).toBe(false);
    expect(can(undefined, "documents:read")).toBe(false);
  });
});

describe("canManageDocuments", () => {
  test("commander (is_admin false) may use the kho domain via capability", () => {
    expect(canManageDocuments(COMMANDER)).toBe(true);
  });

  test("admins may use the kho domain via is_admin fallback", () => {
    expect(canManageDocuments(UNIT_ADMIN)).toBe(true);
    expect(canManageDocuments(SUPER_ADMIN)).toBe(true);
  });

  test("regular user and anonymous may NOT", () => {
    expect(canManageDocuments(REGULAR)).toBe(false);
    expect(canManageDocuments(undefined)).toBe(false);
  });
});

describe("isSuperAdmin (unchanged)", () => {
  test("admin on root/no unit is super; commander is NOT (is_admin false)", () => {
    expect(isSuperAdmin(SUPER_ADMIN)).toBe(true);
    expect(isSuperAdmin({ is_admin: true, unit_id: null })).toBe(true);
    expect(isSuperAdmin(UNIT_ADMIN)).toBe(false);
    expect(isSuperAdmin(COMMANDER)).toBe(false);
  });
});

describe("canManageUnits (story 87 — only super admin manages units)", () => {
  test("super admin (root/no unit) may manage units", () => {
    expect(canManageUnits(SUPER_ADMIN)).toBe(true);
    expect(canManageUnits({ is_admin: true, unit_id: null })).toBe(true);
  });

  test("unit admin, commander, regular, anonymous may NOT", () => {
    expect(canManageUnits(UNIT_ADMIN)).toBe(false);
    expect(canManageUnits(COMMANDER)).toBe(false);
    expect(canManageUnits(REGULAR)).toBe(false);
    expect(canManageUnits(undefined)).toBe(false);
  });
});

describe("isRepoSuperAdmin (story 68 — commander acts as repo super-admin)", () => {
  test("commander (is_admin false, root unit, documents capability) IS repo super", () => {
    expect(isRepoSuperAdmin(COMMANDER)).toBe(true);
  });

  test("equals isSuperAdmin for every NON-commander role (no regression)", () => {
    for (const u of [SUPER_ADMIN, UNIT_ADMIN, REGULAR, { is_admin: true, unit_id: null }]) {
      expect(isRepoSuperAdmin(u)).toBe(isSuperAdmin(u));
    }
    expect(isRepoSuperAdmin(undefined)).toBe(false);
  });

  test("a document-capable user NOT on the root unit is NOT repo super", () => {
    // Guards the discriminator: capability alone (off root) does not grant focus.
    const offRoot = { is_admin: false, unit_id: 7, permissions: ["documents:read"] };
    expect(isRepoSuperAdmin(offRoot)).toBe(false);
  });
});
