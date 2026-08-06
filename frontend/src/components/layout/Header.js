// src/components/layout/Header.js
import React, { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  BrandLogoTextDark as LogoDark,
  BrandLogoTextLight as LogoLight,
  BrandLogoMarkDark as SmallLogoDark,
  BrandLogoMarkLight as SmallLogoLight,
} from "./BrandLogo";
import { ReactComponent as ThreeLineIcon } from "assets/images/three-line.svg";
import { ReactComponent as FolderDocIcon } from "assets/images/folder-doc.svg";
import { InfoButton, ThemeButton } from "components";
import { UserButton, UserMenu } from "features/auth/components"
import useAuthStore from "stores/useAuthStore";
import { useDocRepoStore } from "stores/useDocRepoStore";
import { canManageDocuments } from "lib/roles";
import "./Header.css"

/**
 * Header
 * Props:
 *  - brand?: string
 *  - onInfoClick?: () => void   // optional (InfoModal is handled inside InfoButton)
 *  - themeButtonTitle?: string
 */
export default function Header({
  brand = "",
  onInfoClick,
  themeButtonTitle = "",
}) {
  const { user, logout } = useAuthStore();
  // Story 54: unread repository documents → red badge on the "Kho tài liệu"
  // button. Polled while an admin is logged in (best-effort; 0 hides the badge).
  const unreadCount = useDocRepoStore((s) => s.unreadCount);
  const fetchUnreadCount = useDocRepoStore((s) => s.fetchUnreadCount);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const mobileMenuRef = useRef(null);

  const isDocumentManagement = location.pathname.includes("/document-management");
  const isUnitRepository = location.pathname.includes("/unit-repository");
  // Story 38/82: a header shortcut to the repository, hidden while already on a
  // repository screen. Who sees it + where it goes depends on the role:
  //  - admins AND the commander role (canManageDocuments) → manage screen
  //    "/document-management" (story 38/66).
  //  - a regular user WITH a unit → their read-only "/unit-repository" view
  //    (story 82). A user with no unit sees nothing.
  // Role routing inside the manage screen (super-admin unit popup vs unit-admin
  // direct) is handled by the page itself.
  const isRepoManager = canManageDocuments(user);
  const hasUnit = user?.unit_id != null;
  const canSeeRepo = isRepoManager || hasUnit;
  const repoTarget = isRepoManager ? "/document-management" : "/unit-repository";
  const showRepoShortcut =
    canSeeRepo && !isDocumentManagement && !isUnitRepository;
  // Story 115: admins (super admin AND unit admin — both carry is_admin) no
  // longer receive the unread notification badge; they manage/upload documents
  // and don't need to be nudged. The commander ("Chỉ huy", is_admin false) and
  // regular users keep it. The shortcut button itself is unaffected.
  const isAdminRole = Boolean(user?.is_admin);

  useEffect(() => {
    function handleClickOutside(event) {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target)) {
        setMobileMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Story 54/82/115: keep the unread badge fresh for anyone who RECEIVES it —
  // the commander AND a regular user with a unit. Story 115: admins skip the
  // fetch/poll entirely (they no longer get the badge). Fetch once on mount and
  // poll every 30s; the count is role-scoped server-side.
  useEffect(() => {
    if (!canSeeRepo || isAdminRole) return undefined;
    fetchUnreadCount();
    const timer = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(timer);
  }, [canSeeRepo, isAdminRole, fetchUnreadCount]);

  // Story 123: the admin screen title moved OUT of the global header and INTO the
  // content panel (top of the left menu / topbar), matching Chat. The header now
  // holds only the logo (left) + actions (right) on every route. Amends ADR-063/064.
  return (
    <header className="main-header">
      <div className="left">
        <LogoLight className="main-logo logo-light" />
        <LogoDark className="main-logo logo-dark" />
        <h1 className="brand">{brand}</h1>
      </div>

      <div className="right">
        <div className="desktop-actions">
          {showRepoShortcut && (
            <button
              type="button"
              className="repo-shortcut-btn"
              onClick={() => navigate(repoTarget)}
              title="Kho tài liệu"
            >
              <FolderDocIcon className="repo-shortcut-btn__icon" />
              <span className="repo-shortcut-btn__label">Kho tài liệu</span>
              {!isAdminRole && unreadCount > 0 && (
                <span className="repo-shortcut-btn__badge" aria-label="Tài liệu chưa đọc">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>
          )}
          <ThemeButton title={themeButtonTitle} />
          <InfoButton onClick={onInfoClick} />
        </div>

        <div className="mobile-actions" ref={mobileMenuRef}>
          <button className="mobile-menu-btn" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            <ThreeLineIcon />
          </button>

          {mobileMenuOpen && (
            <div className="mobile-actions-dropdown">
              <ThemeButton title={themeButtonTitle} />
              <div className="mobile-actions-info-row">
                <InfoButton onClick={onInfoClick} />
                <span>Info</span>
              </div>
            </div>
          )}
        </div>
        <div className="user-menu-wrap">
          <UserButton username={user?.username} onClick={() => setMenuOpen((v) => !v)} />
          <UserMenu
            open={menuOpen}
            user={user}          // <-- pass user here
            onClose={() => setMenuOpen(false)}
            onLogout={logout}
            onGoChat={() => navigate("/chat")}
            onManageUsers={() => navigate("/user-management")}  // <-- go to admin page
            onManageDocuments={() => navigate("/document-management")}
            onViewAuditLogs={() => navigate("/audit-logs")}
            align="right"
          />
        </div>
      </div>
    </header>
  );
}
