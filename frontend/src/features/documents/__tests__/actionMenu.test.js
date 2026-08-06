// src/features/documents/__tests__/actionMenu.test.js
import React from "react";
import { render, screen } from "@testing-library/react";

import ActionMenu from "components/menus/ActionMenu";

// Story 96: ActionMenu now draws its icons INLINE (no svgr imports), so the old
// edit/delete/eye.svg mocks are gone — nothing to mock.

test("actionMenu_default_showsThreeItems", () => {
  render(<ActionMenu open x={0} y={0} onAction={() => {}} onClose={() => {}} />);
  expect(screen.getByText("Xem tài liệu")).toBeInTheDocument();
  expect(screen.getByText("Sửa tên tài liệu")).toBeInTheDocument();
  expect(screen.getByText("Xoá tài liệu")).toBeInTheDocument();
});

test("actionMenu_hidesRename_whenShowRenameFalse", () => {
  render(
    <ActionMenu
      open
      x={0}
      y={0}
      onAction={() => {}}
      onClose={() => {}}
      showRename={false}
      deleteLabel="Gỡ khỏi hội thoại"
    />,
  );
  expect(screen.getByText("Xem tài liệu")).toBeInTheDocument();
  expect(screen.queryByText("Sửa tên tài liệu")).not.toBeInTheDocument();
  expect(screen.getByText("Gỡ khỏi hội thoại")).toBeInTheDocument();
});
