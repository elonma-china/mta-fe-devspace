import React, { useState, useRef, useEffect } from "react";
import "./UserCard.css";
import "components/menus/ActionMenu.css";
import { ReactComponent as MoreVertIcon } from "assets/images/more-vert.svg";
import { ReactComponent as DeleteIcon } from "assets/images/delete.svg";
import { ReactComponent as EditIcon } from "assets/images/edit.svg";
import { ReactComponent as LogoutIcon } from "assets/images/logout.svg";

const LockIcon = ({ className }) => (
  <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
  </svg>
);

export default function UserCard({ user, index, onEdit, onDelete, onLogout, onToggleLock, lockBusy }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef();

  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="user-card">
      <div className="user-card-header">
        <span className="user-card-index">Người dùng số {index + 1}</span>
        <div className="user-card-actions" ref={menuRef}>
          <button type="button" className="icon-btn" onClick={() => setMenuOpen(!menuOpen)}>
            <MoreVertIcon />
          </button>
          {menuOpen && (
            <div className="user-card-menu as-menu">
              <button className="as-menu-item" onClick={() => { onEdit(user); setMenuOpen(false); }}>
                <EditIcon className="as-mi-icon" /> <span className="as-mi-label">Sửa</span>
              </button>
              <button
                className={`as-menu-item ${user.is_admin || lockBusy ? 'disabled' : ''}`}
                onClick={(e) => {
                  if (user.is_admin || lockBusy) return e.preventDefault();
                  onToggleLock(user, !!user.lock_status);
                  setMenuOpen(false);
                }}
              >
                <LockIcon className="as-mi-icon" /> <span className="as-mi-label">{user.lock_status ? "Mở khoá" : "Khoá"}</span>
              </button>
              {!user.is_admin && (
                <button className="as-menu-item" onClick={() => { onDelete(user); setMenuOpen(false); }}>
                  <DeleteIcon className="as-mi-icon" /> <span className="as-mi-label">Xoá</span>
                </button>
              )}
              {!user.is_admin && (
                <button className="as-menu-item" onClick={() => { onLogout(user); setMenuOpen(false); }}>
                  <LogoutIcon className="as-mi-icon" /> <span className="as-mi-label">Đăng xuất</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="user-card-row">
        <span className="user-card-label">Họ và tên</span>
        <span className="user-card-value primary-value">{user.name || "-"}</span>
      </div>
      <div className="user-card-row">
        <span className="user-card-label">Đơn vị</span>
        <span className="user-card-value">{user.unit_name || "-"}</span>
      </div>
      <div className="user-card-row">
        <span className="user-card-label">Tên người dùng</span>
        <span className="user-card-value">{user.username || "-"}</span>
      </div>
      <div className="user-card-row">
        <span className="user-card-label">Mật khẩu</span>
        <span className="user-card-value">{user.password || "-"}</span>
      </div>
    </div>
  );
}
