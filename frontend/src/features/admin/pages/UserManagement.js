// src/features/admin/pages/UserManagement.js
import React, { useEffect, useState } from "react";
import "./UserManagement.css";
import { listUsers, createUser, updateUser, deleteUser, getUserDeleteImpact } from "../api";
import {
  buildUserDeleteMessage,
  GENERIC_DELETE_MESSAGE,
} from "features/admin/utils/userDeleteMessage";
import { forceLogoutUser, setUserLock } from "features/auth/api/auth";
import { ReactComponent as AddIcon } from "assets/images/add.svg";
import { ReactComponent as DeleteIcon } from "assets/images/delete.svg";
import { ReactComponent as EditIcon } from "assets/images/edit.svg";
import { ReactComponent as LogoutIcon } from "assets/images/logout.svg";
import { ReactComponent as UnitIcon } from "assets/images/unit.svg";
import { ReactComponent as UserGroupIcon } from "assets/images/user-group.svg";
import { ReactComponent as LockIcon } from "assets/images/lock.svg";
import { ReactComponent as UnlockIcon } from "assets/images/unlock.svg";
import { SearchBar } from "components";
import { AlertModal, DeleteModal, DataTable, Pagination } from "components/common";
import { UserProfileModal } from "features/auth/components";
import UnitFormModal from "features/admin/components/UnitFormModal";
import UnitDeleteModal from "features/admin/components/UnitDeleteModal";
import useModalStore from "stores/useModalStore";
import useAuthStore from "stores/useAuthStore";
import usePageTitleStore from "stores/usePageTitleStore";
import { useUnitStore } from "stores/useUnitStore";
import { canManageUnits } from "lib/roles";
import { userScreenTitle } from "features/admin/utils/screenTitle";
import UserCard from "./UserCard";

const NAV_ITEMS = [
  { key: "units", label: "Quản lý đơn vị", Icon: UnitIcon },
  { key: "users", label: "Quản lý người dùng", Icon: UserGroupIcon },
];

export default function UserManagement() {
  const currentUser = useAuthStore((s) => s.user);
  // Only the super admin manages units (story 87) — hide that nav item for unit
  // admins and force any stale "units" tab back to the users panel.
  const showUnits = canManageUnits(currentUser);
  const navItems = showUnits
    ? NAV_ITEMS
    : NAV_ITEMS.filter((item) => item.key !== "units");

  const [activeTab, setActiveTab] = useState("users");
  const effectiveTab = !showUnits && activeTab === "units" ? "users" : activeTab;

  // Story 117: push the header title for the active tab (single source of truth).
  const setPageTitle = usePageTitleStore((s) => s.setTitle);
  // Story 123: the title now renders inside the panel (top of the left menu);
  // read it back from the same store the effect below populates.
  const pageTitle = usePageTitleStore((s) => s.title);
  useEffect(() => {
    setPageTitle(userScreenTitle(effectiveTab));
    return () => setPageTitle("");
  }, [effectiveTab, setPageTitle]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { showModal, hideModal } = useModalStore();
  const [search, setSearch] = useState("");
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  const [lockBusyIds, setLockBusyIds] = useState(new Set());

  async function loadUsers() {
    setLoading(true);
    setError(null);
    try {
      const data = await listUsers();
      setUsers(data);
    } catch (e) {
      setError(e.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadUsers(); }, []);

  async function askDelete(user) {
    // Story 108: warn about the user's related data (documents / conversations /
    // owned unit repositories) that will be removed. If the impact lookup fails,
    // fall back to the generic confirm — the delete itself is safe regardless.
    let message = GENERIC_DELETE_MESSAGE;
    try {
      const impact = await getUserDeleteImpact(user.id);
      message = buildUserDeleteMessage(impact);
    } catch (e) {
      // keep the generic message
    }
    showModal(DeleteModal, {
      title: "Xoá tài khoản",
      message,
      onConfirm: async () => {
        try {
          await deleteUser(user.id);
          setUsers(prev => prev.filter(u => u.id !== user.id));
          hideModal();
        } catch (e) { setError(e.message || "Xoá người dùng thất bại"); }
      }
    });
  }

  function askLogout(user) {
    showModal(DeleteModal, {
      title: "Đăng xuất người dùng",
      message: "Bạn muốn đăng xuất người dùng này khỏi tất cả thiết bị?",
      // Story 103: not a delete → no danger badge (the ✕ badge is for deletes).
      showIcon: false,
      onConfirm: async () => {
        try { await forceLogoutUser(user.id); hideModal(); } catch (e) { console.error("Force logout failed:", e); }
      }
    });
  }

  async function handleAddUser(payload) {
    await createUser(payload);
    await loadUsers();
    // Story 88: the new user sorts to the top (updated_at DESC) — jump to page 1
    // so it's visible immediately instead of landing on a later page.
    setPage(1);
    hideModal();
  }

  function openEditModal(user) {
    showModal(UserProfileModal, {
      mode: "edit",
      initialValues: {
        fullName: user.name || "",
        unit_id: user.unit_id || null,
        role_id: user.role_id || null,
        username: user.username || "",
        password: "",
      },
      onSubmit: async (payload) => {
        await updateUser(user.id, payload);
        await loadUsers();
        // Story 88: the edited user bubbles to the top — show page 1 so it's
        // not "lost" on the page the admin was viewing.
        setPage(1);
        hideModal();
      }
    });
  }

  function askToggleLock(user) {
    if (lockBusyIds.has(user.id)) return;
    const isLocked = !!user.lock_status;
    const title = isLocked ? "Mở khoá tài khoản" : "Khoá tài khoản";
    const message = isLocked
      ? "Bạn chắc chắn muốn mở khoá tài khoản này?"
      : "Bạn chắc chắn muốn khoá tài khoản này?";
    const confirmLabel = isLocked ? "Mở khoá" : "Khoá";
    const loadingLabel = isLocked ? "Đang mở khoá..." : "Đang khoá...";

    showModal(DeleteModal, {
      title,
      message,
      confirmLabel,
      loadingLabel,
      // Story 103: lock/unlock is not a delete → no danger badge.
      showIcon: false,
      onConfirm: async () => {
        const id = user.id;
        const willLock = !isLocked;
        try {
          setLockBusyIds(prev => new Set(prev).add(id));
          await setUserLock(id, willLock);
          setUsers(prev => prev.map(u => u.id === id ? { ...u, lock_status: willLock ? 1 : 0 } : u));
          hideModal();
        } catch (e) {
          showModal(AlertModal, { title: "Lỗi", message: e?.message || "Không thể thay đổi trạng thái khoá" });
        } finally {
          setLockBusyIds(prev => { const n = new Set(prev); n.delete(id); return n; });
        }
      }
    });
  }

  const filteredUsers = users.filter(u => {
    const q = search.toLowerCase();
    return u.name?.toLowerCase().includes(q) || u.unit_name?.toLowerCase().includes(q) || u.username?.toLowerCase().includes(q);
  });
  const totalCount = filteredUsers.length;
  const pageUsers = filteredUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const columns = [
    {
      label: "Họ và tên",
      render: (u) => u.name || "-",
      width: "calc(100% * 328 / 1188)",
      style: { fontWeight: 600 }
    },
    {
      label: "Đơn vị",
      render: (u) => u.unit_name || "-",
      width: "calc(100% * 240 / 1188)",
      wordBreak: "break-all",
      style: { fontWeight: 450 }
    },
    {
      label: "Vai trò",
      render: (u) => u.role_name || "-",
      width: "calc(100% * 240 / 1188)",
      wordBreak: "break-all",
      style: { fontWeight: 450 }
    },
    {
      label: "Tên người dùng",
      key: "username",
      width: "calc(100% * 240 / 1188)",
      wordBreak: "break-all",
      style: { fontWeight: 450 }
    },
    {
      label: "Thao tác",
      width: "calc(100% * 148 / 1188)",
      style: { fontWeight: 450 },
      render: (u) => (
        <>
          <EditIcon onClick={() => openEditModal(u)} title="Sửa" />
          {!u.is_admin && (
            u.lock_status ? (
              <UnlockIcon
                onClick={() => askToggleLock(u)}
                title="Mở khoá"
                style={lockBusyIds.has(u.id) ? { opacity: 0.5, cursor: "not-allowed", pointerEvents: "none" } : {}}
              />
            ) : (
              <LockIcon
                onClick={() => askToggleLock(u)}
                title="Khoá"
                style={lockBusyIds.has(u.id) ? { opacity: 0.5, cursor: "not-allowed", pointerEvents: "none" } : {}}
              />
            )
          )}
          {!u.is_admin && <DeleteIcon onClick={() => askDelete(u)} title="Xoá" />}
        </>
      )
    }
  ];

  // ── Units (Quản lý đơn vị) ──────────────────────────────────────────
  const {
    items: units,
    total: unitTotal,
    page: unitPage,
    pageSize: unitPageSize,
    loading: unitLoading,
    error: unitError,
    fetchUnits,
    setPage: setUnitPage,
    createUnit,
    updateUnit,
    deleteUnit,
  } = useUnitStore();
  const [unitSearch, setUnitSearch] = useState("");

  // Load units when the tab becomes active.
  useEffect(() => {
    if (activeTab === "units") fetchUnits({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Debounced server-side search (~300ms).
  useEffect(() => {
    if (activeTab !== "units") return undefined;
    const t = setTimeout(() => fetchUnits({ search: unitSearch }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitSearch]);

  function openUnitModal(unit) {
    const isEdit = Boolean(unit);
    showModal(UnitFormModal, {
      mode: isEdit ? "edit" : "add",
      initialValues: isEdit
        ? {
            id: unit.id,
            name: unit.name,
            admin_username: unit.admin_username,
            admin_full_name: unit.admin_full_name,
          }
        : undefined,
      onSubmit: async (payload) => {
        if (isEdit) {
          await updateUnit(unit.id, payload);
        } else {
          await createUnit(payload);
        }
        hideModal();
      },
    });
  }

  function askDeleteUnit(unit) {
    showModal(UnitDeleteModal, {
      unit,
      units,
      onConfirm: async (transferToUnitId) => {
        try {
          await deleteUnit(unit.id, transferToUnitId);
          hideModal();
        } catch (e) {
          showModal(AlertModal, {
            title: "Lỗi",
            message: e?.message || "Xoá đơn vị thất bại",
          });
        }
      },
    });
  }

  const unitColumns = [
    {
      label: "Tên đơn vị",
      render: (u) => u.name || "—",
      width: "auto",
      style: { fontWeight: 600 },
    },
    {
      label: "Tên quản trị viên",
      render: (u) => u.admin_username || "—",
      width: "20vw",
      wordBreak: "break-all",
    },
    {
      label: "Họ và tên quản trị viên",
      render: (u) => u.admin_full_name || "—",
      width: "20vw",
      wordBreak: "break-all",
    },
    {
      label: "Thao tác",
      width: "8vw",
      render: (u) => (
        <>
          <EditIcon onClick={() => openUnitModal(u)} title="Sửa" />
          <DeleteIcon onClick={() => askDeleteUnit(u)} title="Xoá" />
        </>
      ),
    },
  ];

  function renderUsersPanel() {
    return (
      <>
        <div className="toolbar">
          <SearchBar placeholder="Tìm theo tên người dùng/email" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          <button type="button" className="add-user-btn" onClick={() => showModal(UserProfileModal, { mode: "add", onSubmit: handleAddUser })}>
            <AddIcon /><span className="add-user-btn__label">Thêm người dùng</span>
          </button>
        </div>

        <div className="user-card-list">
          <div className="user-card-scroll-area">
            {pageUsers.length > 0 ? (
              pageUsers.map((u, i) => (
                <UserCard
                  key={u.id}
                  user={u}
                  index={(page - 1) * PAGE_SIZE + i}
                  onEdit={openEditModal}
                  onDelete={askDelete}
                  onToggleLock={askToggleLock}
                  lockBusy={lockBusyIds.has(u.id)}
                />
              ))
            ) : !loading && !error && (
              <div className="empty-message">Không có người dùng nào.</div>
            )}
          </div>
          {totalCount > 0 && (
            <div className="data-table-footer mobile-pagination">
              <div className="footer-text">{`Tổng cộng ${totalCount.toLocaleString("vi-VN")} người dùng`}</div>
              <Pagination page={page} limit={PAGE_SIZE} totalCount={totalCount} onPageChange={setPage} />
            </div>
          )}
        </div>

        <DataTable
          columns={columns}
          data={pageUsers}
          loading={loading}
          error={error}
          emptyMessage="Không có người dùng nào."
          page={page}
          limit={PAGE_SIZE}
          totalCount={totalCount}
          onPageChange={setPage}
          totalTextFormat={(t) => `Tổng cộng ${t.toLocaleString("vi-VN")} người dùng`}
        />
      </>
    );
  }

  function renderUnitsPanel() {
    return (
      <>
        <div className="toolbar">
          <SearchBar
            placeholder="Tìm theo tên đơn vị"
            value={unitSearch}
            onChange={(e) => setUnitSearch(e.target.value)}
          />
          <button
            type="button"
            className="add-user-btn"
            onClick={() => openUnitModal(null)}
          >
            <AddIcon />
            <span className="add-user-btn__label">Thêm đơn vị</span>
          </button>
        </div>

        <DataTable
          columns={unitColumns}
          data={units}
          loading={unitLoading}
          error={unitError}
          emptyMessage="Chưa có đơn vị nào."
          page={unitPage}
          limit={unitPageSize}
          totalCount={unitTotal}
          onPageChange={(p) => setUnitPage(p)}
          totalTextFormat={(t) => `Tổng cộng ${t.toLocaleString("vi-VN")} đơn vị`}
        />
      </>
    );
  }

  return (
    <div className="user-mgmt-layout">
      <aside className="um-sidebar">
        <div className="um-sidebar__header">
          <h2 className="um-sidebar__title">
            {pageTitle || userScreenTitle(effectiveTab)}
          </h2>
        </div>
        <nav className="um-sidebar__nav">
          {navItems.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              className={`um-nav-item${effectiveTab === key ? " um-nav-item--active" : ""}`}
              onClick={() => setActiveTab(key)}
            >
              <Icon className="um-nav-item__icon" />
              <span className="um-nav-item__label">{label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <div className="user-mgmt">
        {effectiveTab === "units" ? renderUnitsPanel() : renderUsersPanel()}
      </div>
    </div>
  );
}
