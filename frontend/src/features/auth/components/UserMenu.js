// src/features/auth/components/UserMenu.js
import React, { useEffect, useRef } from "react";
import "./UserMenu.css";
import { useLocation, useNavigate } from "react-router-dom";
import { ReactComponent as Person } from "assets/images/person.svg";
import { ReactComponent as Logout } from "assets/images/logout.svg";
// Stays the raw asset, not BrandLogo: this glyph is `fill="currentColor"`, so
// it already takes the skin's brand colour from CSS. Swapping in the Dev Space
// asset (which carries a baked-in fill) would make it LESS themeable.
import { ReactComponent as IntraMind } from "assets/images/intramind.svg";
import { ReactComponent as Log } from "assets/images/log.svg";
import { ReactComponent as FolderStar } from "assets/images/folder-star.svg";
import { canManageDocuments } from "lib/roles";

/**
 * Props:
 * - open: boolean
 * - user: { name?, username?, is_admin? }
 * - onClose: () => void
 * - onLogout: () => void
 * - onManageUsers?: () => void   // optional; will fallback to navigate('/user-management')
 * - onGoChat?: () => void        // optional; will fallback to navigate('/chat')
 * - align?: "right" | "left"
 * - className?: string
 * - style?: React.CSSProperties
 */
export default function UserMenu({
  open,
  user,
  onClose,
  onLogout,
  onManageUsers,
  onManageDocuments,
  onViewAuditLogs,
  onGoChat,
  align = "right",
  className = "",
  style = {},
}) {
  const menuRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  const isOnChat = location.pathname.startsWith("/chat");
  const isOnUserMgmt = location.pathname.startsWith("/user-management");
  const isOnAuditLogs = location.pathname.startsWith("/audit-logs");
  const isOnDocMgmt = location.pathname.startsWith("/document-management");

  // Close on click outside / Esc
  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target)) onClose?.();
    }
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    document.addEventListener("mousedown", onDocClick, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleNavigate = (path, onAction) => {
    if (onAction) onAction();
    else navigate(path);
    onClose?.();
  };

  return (
    <div
      ref={menuRef}
      className={`user-menu ${align === "left" ? "align-left" : "align-right"} ${className}`}
      role="menu"
      style={style}
    >
      {/* First row: user name */}
      <button className="um-item" type="button" tabIndex={-1}>
        <span className="um-icon" aria-hidden>
          <Person />
        </span>
        <span className="um-text">{user?.name ?? user?.username ?? "Người dùng"}</span>
      </button>

      <button
        className={`um-item danger ${isOnChat ? "um-item--disabled" : ""}`}
        type="button"
        role="menuitem"
        disabled={isOnChat}
        onClick={() => handleNavigate("/chat", onGoChat)}
      >
        <span className="um-icon" aria-hidden>
          <IntraMind />
        </span>
        <span className="um-text">Chat</span>
      </button>

      {/* Admin rows */}
      {!!user?.is_admin && (
        <>
          <button
            className={`um-item danger um-item-audit ${isOnAuditLogs ? "um-item--disabled" : ""}`}
            type="button"
            role="menuitem"
            disabled={isOnAuditLogs}
            onClick={() => handleNavigate("/audit-logs", onViewAuditLogs)}
          >
            <span className="um-icon" aria-hidden>
              <Log />
            </span>
            <span className="um-text">Nhật ký hệ thống</span>
          </button>

          <button
            className={`um-item danger ${isOnUserMgmt ? "um-item--disabled" : ""}`}
            type="button"
            role="menuitem"
            disabled={isOnUserMgmt}
            onClick={() => handleNavigate("/user-management", onManageUsers)}
          >
            <span className="um-icon" aria-hidden>
              <Person />
            </span>
            <span className="um-text">Quản lý người dùng</span>
          </button>
        </>
      )}

      {/* Repository management — admins OR the commander role (story 66) */}
      {canManageDocuments(user) && (
        <button
          className={`um-item danger ${isOnDocMgmt ? "um-item--disabled" : ""}`}
          type="button"
          role="menuitem"
          disabled={isOnDocMgmt}
          onClick={() => handleNavigate("/document-management", onManageDocuments)}
        >
          <span className="um-icon" aria-hidden>
            <FolderStar />
          </span>
          <span className="um-text">Quản lý kho tài liệu</span>
        </button>
      )}

      {/* Logout row */}
      <button
        className="um-item danger"
        type="button"
        role="menuitem"
        onClick={() => {
          onLogout?.();
          onClose?.();
        }}
      >
        <span className="um-icon" aria-hidden>
          <Logout />
        </span>
        <span className="um-text">Đăng xuất</span>
      </button>
    </div>
  );
}
