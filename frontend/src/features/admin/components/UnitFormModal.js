// src/features/admin/components/UnitFormModal.js
import React, { useEffect, useMemo, useRef, useState } from "react";
import "./UnitFormModal.css";
import { ReactComponent as CloseIcon } from "assets/images/close.svg";
import { ReactComponent as ChevronDownIcon } from "assets/images/chevron-down.svg";
import { ReactComponent as SearchIcon } from "assets/images/search.svg";
import { ReactComponent as AddIcon } from "assets/images/add.svg";
import { getAdminCandidates } from "features/admin/api";
import { generatePassword } from "features/admin/utils/password";
import { normalizeText } from "features/admin/utils/text";
import { AlertModal } from "components/common";

const EMPTY_ADMIN = { full_name: "", username: "", password: "" };

/**
 * Create/edit a unit (đơn vị) together with its administrator.
 *
 * Matches the Figma cluster "Thêm và Sửa đơn vị – tạo mới quản trị viên nếu
 * chưa có" (nodes 841-48714, 867-22363, 1018-31221, 1018-31203):
 * - a unit-name field,
 * - a "Chọn quản trị viên" dropdown with an in-list search box that filters
 *   candidates accent- and case-insensitively (by full name + username),
 * - a read-only "Họ và tên quản trị viên" field reflecting the chosen admin,
 * - a collapsible "Thêm quản trị viên mới" panel to create a fresh admin user,
 *   available in both add and edit mode (Figma 1018-31182).
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {"add"|"edit"} [props.mode]
 * @param {object} [props.initialValues] - { id, name, admin_username, admin_full_name }
 * @param {(payload: object, ctx: {mode: string}) => (void|Promise<void>)} props.onSubmit
 * @param {() => void} props.onClose
 */
export default function UnitFormModal({
  open,
  mode = "add",
  initialValues,
  onSubmit,
  onClose,
}) {
  const isEdit = mode === "edit";

  const [name, setName] = useState("");
  const [adminUserId, setAdminUserId] = useState(null);
  const [newAdmin, setNewAdmin] = useState(EMPTY_ADMIN);
  const [newAdminPanelOpen, setNewAdminPanelOpen] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [adminSearch, setAdminSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [alertState, setAlertState] = useState({
    open: false,
    title: "Thông báo",
    message: "",
  });

  const dropdownRef = useRef(null);
  const searchRef = useRef(null);

  const showAlert = (message, title = "Lỗi") =>
    setAlertState({ open: true, title, message });
  const closeAlert = () =>
    setAlertState({ open: false, title: "Thông báo", message: "" });

  // Reset form whenever the modal (re)opens; load candidates and preselect the
  // unit's current admin (matched by username) in edit mode.
  useEffect(() => {
    if (!open) return;
    setName(initialValues?.name ?? "");
    setAdminUserId(null);
    setNewAdmin(EMPTY_ADMIN);
    setNewAdminPanelOpen(false);
    setAdminSearch("");

    const unitId = initialValues?.id;
    if (!unitId) {
      setCandidates([]);
      return;
    }
    getAdminCandidates(unitId)
      .then((rows) => {
        const list = rows || [];
        setCandidates(list);
        const current = initialValues?.admin_username
          ? list.find((c) => c.username === initialValues.admin_username)
          : null;
        if (current) setAdminUserId(current.id);
      })
      .catch(() => setCandidates([]));
  }, [open, initialValues]);

  // Close the dropdown when clicking outside it.
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus the search box when the dropdown opens.
  useEffect(() => {
    if (dropdownOpen) {
      const t = setTimeout(() => searchRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [dropdownOpen]);

  const selectedCandidate = useMemo(
    () => candidates.find((c) => c.id === adminUserId) || null,
    [candidates, adminUserId]
  );

  const filteredCandidates = useMemo(() => {
    const q = normalizeText(adminSearch);
    if (!q) return candidates;
    return candidates.filter((c) =>
      normalizeText(`${c.full_name || ""} ${c.username || ""}`).includes(q)
    );
  }, [candidates, adminSearch]);

  // "Họ và tên quản trị viên": from the new-admin name when creating one,
  // otherwise from the selected candidate.
  const adminFullName = newAdminPanelOpen
    ? newAdmin.full_name
    : selectedCandidate?.full_name || "";

  if (!open) return null;

  function updateNewAdmin(field) {
    return (e) =>
      setNewAdmin((prev) => ({ ...prev, [field]: e.target.value }));
  }

  function openNewAdminPanel() {
    setNewAdminPanelOpen(true);
    setAdminUserId(null);
  }

  function closeNewAdminPanel() {
    setNewAdminPanelOpen(false);
    setNewAdmin(EMPTY_ADMIN);
  }

  function buildPayload() {
    const payload = { name: name.trim() };
    // An open new-admin panel takes precedence over a selected candidate.
    if (newAdminPanelOpen && newAdmin.username.trim()) {
      payload.admin = {
        full_name: newAdmin.full_name.trim(),
        username: newAdmin.username.trim(),
        password: newAdmin.password,
      };
    } else if (adminUserId != null) {
      payload.admin = { user_id: adminUserId };
    }
    return payload;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (loading) return;
    if (!name.trim()) {
      showAlert("Tên đơn vị không được để trống.");
      return;
    }
    try {
      const res = onSubmit?.(buildPayload(), { mode });
      if (res instanceof Promise) {
        setLoading(true);
        await res;
      }
    } catch (err) {
      showAlert(err?.message || "Đã xảy ra lỗi khi lưu đơn vị.");
    } finally {
      setLoading(false);
    }
  }

  function onBackdropClick(e) {
    if (e.target === e.currentTarget) onClose?.();
  }

  const dropdownPlaceholder = isEdit
    ? "Chọn quản trị viên"
    : "Tìm hoặc chọn quản trị viên";

  return (
    <div className="ufm-backdrop" onMouseDown={onBackdropClick}>
      <div
        className="ufm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ufm-title"
      >
        <button
          className="ufm-close"
          type="button"
          onClick={onClose}
          aria-label="Đóng"
        >
          <CloseIcon />
        </button>

        <form className="ufm-content" onSubmit={handleSubmit}>
          <div className="ufm-header">
            <h2 id="ufm-title" className="ufm-title">
              {isEdit ? "Sửa đơn vị" : "Thêm đơn vị"}
            </h2>
          </div>

          <div className="ufm-fields">
            <label className="ufm-field">
              <span className="ufm-label">Tên đơn vị</span>
              <div className="ufm-input">
                <input
                  type="text"
                  placeholder="Nhập tên đơn vị"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </label>

            <div className="ufm-field" ref={dropdownRef}>
              <span className="ufm-label">Quản trị viên</span>
              <div className="ufm-dropdown-container">
                <button
                  type="button"
                  className="ufm-dropdown-trigger"
                  onClick={() => setDropdownOpen((v) => !v)}
                >
                  <span
                    className={
                      selectedCandidate
                        ? "ufm-dropdown-value"
                        : "ufm-dropdown-placeholder"
                    }
                  >
                    {selectedCandidate
                      ? `${selectedCandidate.full_name || ""} (${selectedCandidate.username})`
                      : dropdownPlaceholder}
                  </span>
                  <ChevronDownIcon
                    className={`ufm-dropdown-arrow ${dropdownOpen ? "open" : ""}`}
                  />
                </button>
                {dropdownOpen && (
                  <div className="ufm-dropdown-list">
                    <div className="ufm-dropdown-search">
                      <input
                        ref={searchRef}
                        type="text"
                        placeholder="Tìm kiếm"
                        value={adminSearch}
                        onChange={(e) => setAdminSearch(e.target.value)}
                      />
                      <SearchIcon className="ufm-dropdown-search__icon" />
                    </div>
                    <div className="ufm-dropdown-options">
                      {filteredCandidates.length > 0 ? (
                        filteredCandidates.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className={`ufm-dropdown-item ${adminUserId === c.id ? "selected" : ""}`}
                            onClick={() => {
                              setAdminUserId(c.id);
                              closeNewAdminPanel();
                              setDropdownOpen(false);
                            }}
                          >
                            {`${c.full_name || ""} (${c.username})`}
                          </button>
                        ))
                      ) : (
                        <div className="ufm-dropdown-empty">
                          Không tìm thấy quản trị viên
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {!newAdminPanelOpen && (
              <button
                type="button"
                className="ufm-new-admin-toggle"
                onClick={openNewAdminPanel}
              >
                <AddIcon className="ufm-new-admin-toggle__icon" />
                <span>Thêm quản trị viên mới</span>
              </button>
            )}

            {newAdminPanelOpen && (
              <fieldset className="ufm-new-admin">
                <div className="ufm-new-admin__header">
                  <legend className="ufm-legend">Thêm quản trị viên mới</legend>
                  <button
                    type="button"
                    className="ufm-new-admin__close"
                    aria-label="Đóng thêm quản trị viên mới"
                    onClick={closeNewAdminPanel}
                  >
                    <CloseIcon />
                  </button>
                </div>

                <label className="ufm-field">
                  <span className="ufm-label">Họ và Tên</span>
                  <div className="ufm-input">
                    <input
                      type="text"
                      placeholder="Nhập họ và tên"
                      value={newAdmin.full_name}
                      onChange={updateNewAdmin("full_name")}
                    />
                  </div>
                </label>

                <label className="ufm-field">
                  <span className="ufm-label">Tên đăng nhập</span>
                  <div className="ufm-input">
                    <input
                      type="text"
                      placeholder="Viết liền, không dấu cách, không ký tự đặc biệt"
                      value={newAdmin.username}
                      onChange={updateNewAdmin("username")}
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                  </div>
                </label>

                <label className="ufm-field">
                  <span className="ufm-label">Mật khẩu</span>
                  <div className="ufm-input ufm-input--password">
                    <input
                      type="text"
                      placeholder="Mật khẩu"
                      value={newAdmin.password}
                      onChange={updateNewAdmin("password")}
                    />
                    <button
                      type="button"
                      className="ufm-refresh"
                      aria-label="Tạo lại"
                      title="Tạo mật khẩu ngẫu nhiên"
                      onClick={() =>
                        setNewAdmin((prev) => ({
                          ...prev,
                          password: generatePassword(),
                        }))
                      }
                    >
                      ↻
                    </button>
                  </div>
                </label>
              </fieldset>
            )}

            <label className="ufm-field">
              <span className="ufm-label">Họ và tên quản trị viên</span>
              <div className="ufm-input ufm-input--readonly">
                <input
                  type="text"
                  placeholder="Họ và tên"
                  value={adminFullName}
                  readOnly
                  tabIndex={-1}
                />
              </div>
            </label>
          </div>

          <div className="ufm-footer">
            <button className="ufm-primary" type="submit" disabled={loading}>
              {loading ? "Đang lưu..." : "Lưu"}
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
