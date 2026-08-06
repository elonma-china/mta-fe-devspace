// src/features/auth/components/__tests__/userMenuRepoIcon.test.js
//
// Story 65: the account dropdown's "Quản lý kho tài liệu" item must use the
// folder-star icon (story 61), matching the sidebar nav item — not the generic
// file sheet. Render UserMenu (admin) and assert the item shows folder-star.
// Mock every svg (svgr transform is incompatible with React 19 in jsdom — story
// 61 gotcha) + react-router (UserMenu uses useLocation/useNavigate).
import React from "react";
import { render, screen } from "@testing-library/react";

import UserMenu from "../UserMenu";

jest.mock("react-router-dom", () => ({
  __esModule: true,
  useLocation: () => ({ pathname: "/chat" }),
  useNavigate: () => jest.fn(),
}));

jest.mock("assets/images/person.svg", () => ({ ReactComponent: (p) => <span {...p} /> }));
jest.mock("assets/images/logout.svg", () => ({ ReactComponent: (p) => <span {...p} /> }));
jest.mock("assets/images/intramind.svg", () => ({ ReactComponent: (p) => <span {...p} /> }));
jest.mock("assets/images/log.svg", () => ({ ReactComponent: (p) => <span {...p} /> }));
jest.mock("assets/images/file.svg", () => ({
  ReactComponent: (p) => <span data-testid="file-icon" {...p} />,
}));
jest.mock("assets/images/folder-star.svg", () => ({
  ReactComponent: (p) => <span data-testid="folder-star-icon" {...p} />,
}));

const adminUser = { id: 1, name: "Admin", is_admin: true, unit_id: 1 };

test("userMenu_repoItem_usesFolderStarIcon", () => {
  render(<UserMenu open user={adminUser} onClose={jest.fn()} onLogout={jest.fn()} />);
  const btn = screen.getByRole("menuitem", { name: /Quản lý kho tài liệu/i });
  expect(btn.querySelector('[data-testid="folder-star-icon"]')).toBeTruthy();
});

test("userMenu_repoItem_dropsFileIcon", () => {
  render(<UserMenu open user={adminUser} onClose={jest.fn()} onLogout={jest.fn()} />);
  const btn = screen.getByRole("menuitem", { name: /Quản lý kho tài liệu/i });
  expect(btn.querySelector('[data-testid="file-icon"]')).toBeNull();
});
