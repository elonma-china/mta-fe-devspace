// src/features/auth/components/UserProfileModal.js
import React, { useEffect, useMemo, useRef, useState } from "react";
import "./UserProfileModal.css";
import { ReactComponent as CloseIcon } from "assets/images/close.svg";
import { ReactComponent as ChevronDownIcon } from "assets/images/chevron-down.svg";
import { getUnits, getRoles } from "features/admin/api";
import { AlertModal } from "components/common";
import useAuthStore from "stores/useAuthStore";
import { isSuperAdmin, ROOT_UNIT_ID } from "lib/roles";

// The global commander role (story 66 / ADR-037): anchored to the root unit,
// is_admin false, granting read of every unit's documents. Identified by name —
// it is the single role with this name on the root unit, on both existing and
// freshly-seeded databases (seed creates + reconciles it every deploy).
const COMMANDER_ROLE_NAME = "Chỉ huy";

/**
 * Create/edit user modal. The form adapts to WHO is acting (story 72):
 * - super admin: role-type dropdown (deduped by name) ABOVE the unit dropdown;
 *   picking "Chỉ huy" locks the unit to root and the user can read every unit.
 * - unit admin creating a user: unit + role fields are hidden — the new user
 *   defaults to the admin's own unit and the member ("Người dùng") role.
 */
export default function UserProfileModal({
  open,
  onClose,
  onSubmit,
  initialValues,              // { fullName, unit_id, role_id, username, password }
  mode = "add",               // "add" | "edit"
}) {
  const [values, setValues] = useState({
    fullName: "",
    unit_id: null,
    role_id: null,
    username: "",
    password: "",
  });
  // The chosen role TYPE name (e.g. "Quản trị viên"). Roles are unit-scoped, so a
  // type is resolved to a concrete role_id once a unit is known. Kept separate so
  // a type picked before a unit (or carried across a unit change) is remembered.
  const [roleName, setRoleName] = useState("");

  const [units, setUnits] = useState([]);
  const [roles, setRoles] = useState([]);
  const [unitDropdownOpen, setUnitDropdownOpen] = useState(false);
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);

  const dialogRef = useRef(null);
  const firstInputRef = useRef(null);
  const closeBtnRef = useRef(null);
  const unitRef = useRef(null);
  const roleRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [alertState, setAlertState] = useState({ open: false, title: "Thông báo", message: "" });

  const currentUser = useAuthStore((s) => s.user);
  const superAdmin = isSuperAdmin(currentUser);
  // Story 94: a unit admin never manages role/unit — the slimmed form (no
  // Vai trò / Đơn vị pickers) applies to BOTH create AND edit, so the two views
  // are consistent (story 72 only slimmed create → edit leaked the fields). On
  // create the unit/member role is auto-assigned; on edit the user's existing
  // unit + role are kept (the unit admin only edits name / username / password).
  const isUnitAdmin = !superAdmin;
  const isUnitAdminAdd = isUnitAdmin && mode === "add";
  const showRoleUnitFields = !isUnitAdmin;

  const showAlert = (message, title = "Thông báo") => {
    setAlertState({ open: true, title, message });
  };

  const closeAlert = () => {
    setAlertState({ open: false, title: "Thông báo", message: "" });
  };

  // Fetch units and roles
  useEffect(() => {
    if (open) {
      // getUnits() returns a paginated object { items, ... } (see admin api);
      // normalize to an array, tolerating a legacy array response too.
      getUnits()
        .then((data) => setUnits(Array.isArray(data) ? data : data?.items || []))
        .catch(console.error);
      getRoles().then(setRoles).catch(console.error);
    }
  }, [open]);

  // Click outside listener for dropdowns
  useEffect(() => {
    function handleClickOutside(event) {
      if (unitRef.current && !unitRef.current.contains(event.target)) {
        setUnitDropdownOpen(false);
      }
      if (roleRef.current && !roleRef.current.contains(event.target)) {
        setRoleDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // init values when opened
  useEffect(() => {
    if (open) {
      setValues({
        fullName: initialValues?.fullName ?? "",
        unit_id: initialValues?.unit_id ?? null,
        role_id: initialValues?.role_id ?? null,
        username: initialValues?.username ?? "",
        // NEW: in edit mode, default to empty so user can leave it unchanged
        password: mode === "edit" ? "" : (initialValues?.password ?? ""),
      });
      // The display name is derived from the initial role_id once roles load.
      setRoleName("");
    }
  }, [open, initialValues, mode]);

  // lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, [open]);

  // focus management + ESC to close
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => firstInputRef.current?.focus(), 0);
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
      if (e.key === "Tab" && dialogRef.current) {
        trapFocus(e, dialogRef.current);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const selectedUnit = useMemo(() => {
    return units.find(u => u.id === values.unit_id);
  }, [units, values.unit_id]);

  // The global commander role row, if the caller can see it (only super admins'
  // role list contains the root-unit roles).
  const commanderRole = useMemo(
    () => roles.find(r => r.name === COMMANDER_ROLE_NAME && r.unit_id === ROOT_UNIT_ID),
    [roles],
  );

  // Distinct role TYPES (deduped by name). Avoids dumping the per-unit role rows
  // (one "Quản trị viên"/"Người dùng" per unit) as hundreds of duplicates.
  const roleTypes = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const r of roles) {
      if (!seen.has(r.name)) {
        seen.add(r.name);
        out.push(r.name);
      }
    }
    return out;
  }, [roles]);

  // The currently selected role type: an explicitly-picked type wins, otherwise
  // it is derived from the concrete role_id (edit mode before any interaction).
  const selectedRoleName = useMemo(() => {
    return roleName || roles.find(r => r.id === values.role_id)?.name || "";
  }, [roleName, roles, values.role_id]);

  const isCommanderSelected = selectedRoleName === COMMANDER_ROLE_NAME;

  // Resolve a (type name, unit) pair to a concrete role_id.
  const resolveRoleId = (name, unitId) => {
    if (!name || unitId == null) return null;
    const found = roles.find(r => r.name === name && r.unit_id === unitId);
    return found ? found.id : null;
  };

  // The member ("Người dùng") role of a unit = its non-admin role.
  const resolveMemberRoleId = (unitId) => {
    const m = roles.find(r => r.unit_id === unitId && !r.is_admin);
    return m ? m.id : null;
  };

  const disabled = useMemo(() => {
    if (loading) return true;
    if (!values.fullName || !values.username) return true;
    if (mode !== "edit" && !values.password) return true;
    // Unit admin add fills unit + role automatically on submit.
    if (isUnitAdminAdd) return false;
    return !values.role_id || !values.unit_id;
  }, [loading, values, mode, isUnitAdminAdd]);

  if (!open) return null;

  function update(field) {
    return (e) => setValues(prev => ({ ...prev, [field]: e.target.value }));
  }

  function onPickRoleType(name) {
    if (name === COMMANDER_ROLE_NAME) {
      // Commander is global → pin the user to the root unit and lock the picker.
      const cid = commanderRole?.id ?? null;
      setRoleName(name);
      setValues(prev => ({ ...prev, unit_id: ROOT_UNIT_ID, role_id: cid }));
    } else {
      setRoleName(name);
      setValues(prev => ({ ...prev, role_id: resolveRoleId(name, prev.unit_id) }));
    }
    setRoleDropdownOpen(false);
  }

  function onPickUnit(u) {
    // Keep the chosen role type and re-resolve role_id for the new unit.
    const name = selectedRoleName;
    if (name) setRoleName(name);
    setValues(prev => ({ ...prev, unit_id: u.id, role_id: resolveRoleId(name, u.id) }));
    setUnitDropdownOpen(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (loading) return;

    let unitId = values.unit_id;
    let roleId = values.role_id;
    if (isUnitAdminAdd) {
      // Default new user to the admin's own unit + that unit's member role.
      unitId = currentUser?.unit_id ?? null;
      roleId = resolveMemberRoleId(unitId);
      if (roleId == null) {
        showAlert(
          "Không tìm thấy vai trò Người dùng cho đơn vị của bạn.",
          "Lỗi",
        );
        return;
      }
    }

    const payload = {
      name: values.fullName.trim(),
      unit_id: unitId,
      role_id: roleId,
      username: values.username.trim(),
    };
    if (mode !== "edit" || values.password) {
      payload.password = values.password;
    }
    try {
      const res = onSubmit?.(payload, { mode });
      if (res instanceof Promise) {
        setLoading(true);
        await res;
      }
    } catch (err) {
      showAlert(err?.message || "Đã xảy ra lỗi khi lưu thông tin.", "Lỗi");
    } finally {
      setLoading(false);
    }
  }

  function onBackdropClick(e) {
    if (e.target === e.currentTarget) onClose?.();
  }

  const roleField = (
    <div className="aum-field" ref={roleRef}>
      <span className="aum-label">Vai trò</span>
      <div className="aum-dropdown-container">
        <button
          type="button"
          className="aum-dropdown-trigger"
          onClick={() => setRoleDropdownOpen(!roleDropdownOpen)}
        >
          <span className={selectedRoleName ? "aum-dropdown-value" : "aum-dropdown-placeholder"}>
            {selectedRoleName || "Chọn vai trò"}
          </span>
          <ChevronDownIcon className={`aum-dropdown-arrow ${roleDropdownOpen ? "open" : ""}`} />
        </button>
        {roleDropdownOpen && (
          <div className="aum-dropdown-list">
            {roleTypes.length > 0 ? (
              roleTypes.map(name => (
                <button
                  key={name}
                  type="button"
                  className={`aum-dropdown-item ${selectedRoleName === name ? "selected" : ""}`}
                  onClick={() => onPickRoleType(name)}
                >
                  {name}
                </button>
              ))
            ) : (
              <div className="aum-dropdown-empty">Không có vai trò nào</div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const unitField = (
    <div className="aum-field" ref={unitRef}>
      <span className="aum-label">Đơn vị</span>
      <div className="aum-dropdown-container">
        <button
          type="button"
          className="aum-dropdown-trigger"
          disabled={isCommanderSelected}
          onClick={() => !isCommanderSelected && setUnitDropdownOpen(!unitDropdownOpen)}
        >
          <span className={selectedUnit || isCommanderSelected ? "aum-dropdown-value" : "aum-dropdown-placeholder"}>
            {isCommanderSelected
              ? "Toàn bộ đơn vị"
              : (selectedUnit ? selectedUnit.name : "Chọn đơn vị")}
          </span>
          <ChevronDownIcon className={`aum-dropdown-arrow ${unitDropdownOpen ? "open" : ""}`} />
        </button>
        {unitDropdownOpen && !isCommanderSelected && (
          <div className="aum-dropdown-list">
            {units.length > 0 ? (
              units.map(u => (
                <button
                  key={u.id}
                  type="button"
                  className={`aum-dropdown-item ${values.unit_id === u.id ? "selected" : ""}`}
                  onClick={() => onPickUnit(u)}
                >
                  {u.name}
                </button>
              ))
            ) : (
              <div className="aum-dropdown-empty">Không có đơn vị nào</div>
            )}
          </div>
        )}
      </div>
      {isCommanderSelected && (
        <span className="aum-note" role="note">
          Vai trò "Chỉ huy" có quyền xem toàn bộ tài liệu của mọi đơn vị.
        </span>
      )}
    </div>
  );

  return (
    <div className="aum-backdrop" onMouseDown={onBackdropClick}>
      <div
        className="aum-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aum-title"
        ref={dialogRef}
      >
        <button
          className="aum-close"
          type="button"
          onClick={onClose}
          aria-label="Đóng"
          ref={closeBtnRef}
        >
          <CloseIcon />
        </button>

        <form className="aum-content" onSubmit={handleSubmit}>
          <div className="aum-header">
            <h2 id="aum-title" className="aum-title">
              {mode === "edit" ? "Chỉnh sửa" : "Thêm người dùng"}
            </h2>
          </div>

          <div className="aum-fields">
            <label className="aum-field">
              <span className="aum-label">Họ và Tên</span>
              <div className="aum-input">
                <input
                  ref={firstInputRef}
                  type="text"
                  placeholder="Nhập họ và tên"
                  value={values.fullName}
                  onChange={update("fullName")}
                />
              </div>
            </label>

            {/* Story 72: Vai trò ABOVE Đơn vị; both hidden for a unit admin
                creating a user (defaults applied on submit). */}
            {showRoleUnitFields && roleField}
            {showRoleUnitFields && unitField}

            <label className="aum-field">
              <span className="aum-label">
                {mode === "edit" ? "Tên người dùng" : "Tên đăng nhập"}
              </span>
              <div className="aum-input">
                <input
                  type="text"
                  placeholder="Viết liền, không dấu cách, không kí tự đặc biệt"
                  value={values.username}
                  onChange={update("username")}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
            </label>

            <label className="aum-field">
              <span className="aum-label">Mật khẩu</span>
              <div className="aum-input">
                <input
                  type="text"
                  placeholder={mode === "edit" ? "Để trống nếu không đổi" : "Mật khẩu"}
                  value={values.password}
                  onChange={update("password")}
                />
              </div>
            </label>
          </div>

          <div className="aum-footer">
            <button
              className="aum-primary"
              type="submit"
              disabled={disabled}
            >
              {mode === "edit" ? "Lưu" : "Thêm"}
            </button>
          </div>
        </form>
      </div>
      <AlertModal
        open={alertState.open}
        onClose={closeAlert}
        title={alertState.title}
        message={alertState.message}
      />
    </div>
  );
}

function trapFocus(e, container) {
  const focusables = container.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    last.focus(); e.preventDefault();
  } else if (!e.shiftKey && document.activeElement === last) {
    first.focus(); e.preventDefault();
  }
}
