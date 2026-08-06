// src/components/layout/__tests__/header.test.js
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import Header from "../Header";

// Story 38: the header gains a "Kho tài liệu" shortcut button (admin only) that
// navigates to the repository management screen. Mock the heavy barrel imports
// + SVGs so Header renders in jsdom (the `components` barrel pulls extra deps).
// react-router-dom is fully mocked (no requireActual) — this CRA jest config
// can't resolve the real package (same reason App.test.js fails to load), and
// Header only consumes useNavigate + useLocation.
const mockNavigate = jest.fn();
let mockPathname = "/chat";
jest.mock("react-router-dom", () => ({
  __esModule: true,
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: mockPathname }),
}));

jest.mock("assets/images/logo-text-white.svg", () => ({ ReactComponent: () => <span data-testid="logo-dark" /> }));
jest.mock("assets/images/logo-text-fullcolor.svg", () => ({ ReactComponent: () => <span data-testid="logo-light" /> }));
jest.mock("assets/images/logo-white.svg", () => ({ ReactComponent: () => <span /> }));
jest.mock("assets/images/logo-fullcolor.svg", () => ({ ReactComponent: () => <span /> }));
jest.mock("assets/images/three-line.svg", () => ({ ReactComponent: () => <span /> }));
// Story 55: the repo-shortcut icon is the folder-doc glyph (Figma 1074-26179),
// not the generic file sheet.
jest.mock("assets/images/folder-doc.svg", () => ({ ReactComponent: () => <span data-testid="repo-folder-icon" /> }));

jest.mock("components", () => ({
  __esModule: true,
  InfoButton: () => <span />,
  ThemeButton: () => <span />,
}));
jest.mock("features/auth/components", () => ({
  __esModule: true,
  UserButton: () => <span />,
  UserMenu: () => <span />,
}));

let mockUser = { id: "a1", is_admin: true, unit_id: 1 };
jest.mock("stores/useAuthStore", () => ({
  __esModule: true,
  default: () => ({ user: mockUser, logout: jest.fn() }),
}));

// useDocRepoStore is called with a selector: useDocRepoStore((s) => s.focusUnitName).
// Story 54: Header also reads s.unreadCount + s.fetchUnreadCount (badge poll).
// Story 115: badge/poll depend on unreadCount → make the mock state mutable.
let mockDocRepo = {
  focusUnitName: null,
  unreadCount: 0,
  fetchUnreadCount: jest.fn(),
};
jest.mock("stores/useDocRepoStore", () => ({
  __esModule: true,
  useDocRepoStore: (sel) => (sel ? sel(mockDocRepo) : mockDocRepo),
}));

// Story 117: the admin header title comes from the page-title store (dynamic per
// active tab). Mutable mock so tests can set it per pathname.
let mockPageTitle = "";
jest.mock("stores/usePageTitleStore", () => ({
  __esModule: true,
  default: (sel) => (sel ? sel({ title: mockPageTitle }) : { title: mockPageTitle }),
}));

function renderHeader() {
  return render(<Header brand="" />);
}

beforeEach(() => {
  mockNavigate.mockReset();
  mockPathname = "/chat";
  mockUser = { id: "a1", is_admin: true, unit_id: 1 };
  mockDocRepo = {
    focusUnitName: null,
    unreadCount: 0,
    fetchUnreadCount: jest.fn(),
  };
  mockPageTitle = "";
});

// ── Story 117/118: header title = dynamic per active tab (from the page-title
// store), route fallback. Story 118: the LOGO now shows top-left on EVERY route
// (consistent with Chat); the admin title sits AFTER the logo in a separate
// `.main-header__screen-title` slot (over the content), not in `.left`. ─────────

test("header_admin_showsLogoInHeader", () => {
  // Story 118: admin screens now show the logo in the header (like Chat), not a
  // bare title in place of the logo.
  mockPathname = "/user-management";
  mockPageTitle = "Quản lý người dùng";
  const { container } = renderHeader();
  expect(container.querySelector(".left [data-testid='logo-light']")).not.toBeNull();
});

test("header_userManagement_noTitleSlot_titleMovedToPanel", () => {
  // Story 123: the admin screen title moved OUT of the global header INTO the
  // content panel (left-menu top). The header no longer renders a title slot.
  mockPathname = "/user-management";
  mockPageTitle = "Quản lý đơn vị"; // ignored by the header now
  const { container } = renderHeader();
  expect(container.querySelector(".main-header__screen-title")).toBeNull();
  // Logo stays in .left; no admin title text leaks into the header.
  expect(
    container.querySelector(".left [data-testid='logo-light']")
  ).not.toBeNull();
  expect(screen.queryByText(/Quản lý/)).toBeNull();
});

test("header_documentManagement_noTitleInHeader", () => {
  // Story 123: the doc-management title lives in the content panel, not the header.
  mockPathname = "/document-management";
  mockPageTitle = "Quản lý nhóm tài liệu";
  renderHeader();
  expect(screen.queryByText("Quản lý nhóm tài liệu")).toBeNull();
});

test("header_admin_noTitleEvenWhenStoreEmpty", () => {
  // No header title regardless of the page-title store value.
  mockPathname = "/user-management";
  mockPageTitle = "";
  renderHeader();
  expect(screen.queryByText(/Quản lý/)).toBeNull();
});

test("header_chat_noAdminTitle_keepsLogoBranch", () => {
  // Scope: /chat stays in the logo branch — no admin title text leaks in.
  mockPathname = "/chat";
  mockPageTitle = "Quản lý đơn vị"; // stale store value must NOT show on chat
  renderHeader();
  expect(screen.queryByText(/Quản lý/)).toBeNull();
});

test("header_auditLogs_noAdminTitle_keepsLogoBranch", () => {
  // Regression: /audit-logs falls in the same else/logo branch as chat — it must
  // NOT switch to a bare admin title.
  mockPathname = "/audit-logs";
  mockPageTitle = "Quản lý đơn vị";
  renderHeader();
  expect(screen.queryByText(/Quản lý/)).toBeNull();
});

test("header_repoShortcut_visibleForAdmin", () => {
  renderHeader();
  expect(
    screen.getByRole("button", { name: /Kho tài liệu/i })
  ).toBeInTheDocument();
});

test("header_repoShortcut_usesFolderDocIcon", () => {
  // Story 55: the button shows the folder-doc icon (not the generic file sheet).
  renderHeader();
  const btn = screen.getByRole("button", { name: /Kho tài liệu/i });
  expect(btn.querySelector('[data-testid="repo-folder-icon"]')).toBeTruthy();
});

// Story 82: a regular user WITH a unit now sees the button too (their read-only
// repo view) — it no longer requires admin. Only a user with NO unit is hidden.
test("header_repoShortcut_visibleForRegularUserWithUnit", () => {
  mockUser = { id: "u1", is_admin: false, unit_id: 2 };
  renderHeader();
  expect(
    screen.getByRole("button", { name: /Kho tài liệu/i })
  ).toBeInTheDocument();
});

test("header_repoShortcut_hiddenForUserWithoutUnit", () => {
  // Story 82: a regular user with no unit has no unit repository → no button.
  mockUser = { id: "u2", is_admin: false, unit_id: null };
  renderHeader();
  expect(screen.queryByRole("button", { name: /Kho tài liệu/i })).toBeNull();
});

test("header_repoShortcut_navigatesToDocumentManagement", () => {
  // Admin/commander still go to the management screen.
  renderHeader();
  fireEvent.click(screen.getByRole("button", { name: /Kho tài liệu/i }));
  expect(mockNavigate).toHaveBeenCalledWith("/document-management");
});

test("header_repoShortcut_regularUserNavigatesToUnitRepository", () => {
  // Story 82: a regular user goes to their read-only /unit-repository view.
  mockUser = { id: "u1", is_admin: false, unit_id: 2 };
  renderHeader();
  fireEvent.click(screen.getByRole("button", { name: /Kho tài liệu/i }));
  expect(mockNavigate).toHaveBeenCalledWith("/unit-repository");
});

test("header_repoShortcut_hiddenOnDocumentManagementPage", () => {
  // Already on the repo screen → no redundant shortcut.
  mockPathname = "/document-management";
  renderHeader();
  expect(screen.queryByRole("button", { name: /Kho tài liệu/i })).toBeNull();
});

test("header_repoShortcut_hiddenOnUnitRepositoryPage", () => {
  // Story 82: already on the user's read-only repo view → no redundant shortcut.
  mockUser = { id: "u1", is_admin: false, unit_id: 2 };
  mockPathname = "/unit-repository";
  renderHeader();
  expect(screen.queryByRole("button", { name: /Kho tài liệu/i })).toBeNull();
});

// ── Story 115: notification badge is role-scoped ──────────────────────────────
// Admins (super OR unit) no longer get the badge (and skip the poll); the
// commander ("Chỉ huy") and regular users keep it. The button itself still shows.

test("header_badge_hiddenForSuperAdmin", () => {
  mockUser = { id: "a1", is_admin: true, unit_id: null };
  mockDocRepo.unreadCount = 3;
  renderHeader();
  expect(
    screen.getByRole("button", { name: /Kho tài liệu/i })
  ).toBeInTheDocument();
  expect(screen.queryByLabelText(/chưa đọc/i)).toBeNull();
});

test("header_badge_hiddenForUnitAdmin", () => {
  mockUser = { id: "a2", is_admin: true, unit_id: 5 };
  mockDocRepo.unreadCount = 2;
  renderHeader();
  expect(screen.queryByLabelText(/chưa đọc/i)).toBeNull();
});

test("header_noPollForAdmin", () => {
  mockUser = { id: "a1", is_admin: true, unit_id: 1 };
  renderHeader();
  // Admins skip the unread-count fetch/poll entirely.
  expect(mockDocRepo.fetchUnreadCount).not.toHaveBeenCalled();
});

test("header_badge_visibleForCommander", () => {
  // Commander: not an admin, holds documents:read, on the root unit.
  mockUser = {
    id: "c1",
    is_admin: false,
    unit_id: 1,
    permissions: ["documents:read"],
  };
  mockDocRepo.unreadCount = 2;
  renderHeader();
  const badge = screen.getByLabelText(/chưa đọc/i);
  expect(badge).toHaveTextContent("2");
  expect(mockDocRepo.fetchUnreadCount).toHaveBeenCalled();
});

test("header_badge_visibleForRegularUser", () => {
  // Story 82 behavior preserved: a regular member with a unit keeps the badge.
  mockUser = { id: "u1", is_admin: false, unit_id: 2 };
  mockDocRepo.unreadCount = 5;
  renderHeader();
  expect(screen.getByLabelText(/chưa đọc/i)).toHaveTextContent("5");
  expect(mockDocRepo.fetchUnreadCount).toHaveBeenCalled();
});
