// src/lib/roles.js
//
// Shared role helpers. A "super admin" is an admin with no own unit (or the
// root unit) — structurally they can see every unit's data, so unit-scoped
// screens must let them focus a unit first.

/** The reserved root unit id (matches the backend ROOT_UNIT_ID). */
export const ROOT_UNIT_ID = 1;

/**
 * Whether a user is a structural super-admin (no own unit / root unit).
 *
 * @param {{is_admin?: boolean, unit_id?: number|null}} [user]
 * @returns {boolean}
 */
export function isSuperAdmin(user) {
  return Boolean(user?.is_admin) && (user?.unit_id == null || user.unit_id === ROOT_UNIT_ID);
}

/**
 * Whether the user may manage units ("Quản lý đơn vị"). Only the super admin
 * creates/manages units, so unit admins (is_admin on a non-root unit) and every
 * other role are excluded — the units nav item is hidden for them (story 87).
 *
 * @param {{is_admin?: boolean, unit_id?: number|null}} [user]
 * @returns {boolean}
 */
export function canManageUnits(user) {
  return isSuperAdmin(user);
}

/**
 * Whether the user holds a capability action (story 66 — RBAC granular).
 *
 * @param {{permissions?: string[]}} [user]
 * @param {string} action e.g. "documents:manage"
 * @returns {boolean}
 */
export function can(user, action) {
  return Array.isArray(user?.permissions) && user.permissions.includes(action);
}

/**
 * Whether the user may use the repository ("Kho tài liệu") domain. True for any
 * admin (they manage documents today) AND for the commander ("Chỉ huy") role,
 * which holds the explicit document capabilities while is_admin is false. Admin
 * domains (users/units/audit) keep gating on {@link isSuperAdmin}/is_admin.
 *
 * @param {{is_admin?: boolean, permissions?: string[]}} [user]
 * @returns {boolean}
 */
export function canManageDocuments(user) {
  return (
    Boolean(user?.is_admin) ||
    can(user, "documents:read") ||
    can(user, "documents:manage")
  );
}

/**
 * Whether the user acts as a SUPER-admin within the repository ("Kho tài liệu")
 * domain — i.e. must focus a unit and may pick ANY unit (story 68). True for the
 * structural super-admin AND for the commander ("Chỉ huy") role: is_admin is
 * false but it holds the document capability and sits on the root unit, so the
 * backend's {@code _resolve_repo_unit} already treats it as super (must focus).
 *
 * This mirrors the structural rule "super = root/no unit" (ADR-003) used by both
 * the backend and {@link isSuperAdmin}; it returns the SAME result as
 * {@link isSuperAdmin} for every existing role and only adds the commander. A
 * document-capable user on a NON-root unit stays scoped to their own unit.
 *
 * @param {{is_admin?: boolean, unit_id?: number|null, permissions?: string[]}} [user]
 * @returns {boolean}
 */
export function isRepoSuperAdmin(user) {
  return (
    isSuperAdmin(user) ||
    (canManageDocuments(user) &&
      (user?.unit_id == null || user.unit_id === ROOT_UNIT_ID))
  );
}
