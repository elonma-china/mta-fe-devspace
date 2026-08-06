// src/features/documents/__tests__/actionMenuIcons.test.js
//
// Story 96: the action menu (Xem / Sửa tên / Xoá) used a mismatched icon set vs
// the design (Figma 859:23955): the pencil came from a 20×20 viewBox (small,
// inset) and the trash was a SOLID fill, while the design is a consistent 24×24
// OUTLINE set. That both looked wrong and broke the row alignment. ActionMenu now
// draws all three inline as outline SVGs at a uniform 24×24 viewBox. These tests
// lock: (a) three icons, all viewBox 24×24 → uniform slot → aligned; (b) outline
// style (fill="none", not a solid currentColor body) — notably the trash.
import React from "react";
import { render, screen } from "@testing-library/react";

import ActionMenu from "components/menus/ActionMenu";

function renderMenu() {
  return render(
    <ActionMenu open x={0} y={0} onAction={() => {}} onClose={() => {}} />,
  );
}

function iconFor(label) {
  return screen.getByText(label).closest(".as-menu-item").querySelector("svg.as-mi-icon");
}

test("actionMenuIcons_allThree_are24pxViewBox", () => {
  const { container } = renderMenu();
  const icons = container.querySelectorAll(".as-menu-item svg.as-mi-icon");
  expect(icons).toHaveLength(3);
  icons.forEach((svg) => {
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
  });
});

test("actionMenuIcons_trashIsOutlineNotFilled", () => {
  renderMenu();
  const trash = iconFor("Xoá tài liệu");
  expect(trash).toBeTruthy();
  // Design trash is an outline (stroke) — the svg opts out of fill and strokes
  // its paths, unlike the old solid delete.svg (fill="currentColor").
  expect(trash.getAttribute("fill")).toBe("none");
  expect(trash.innerHTML).not.toContain('fill="currentColor"');
  expect(trash.innerHTML).toContain("stroke");
});

test("actionMenuIcons_editAndEye_areOutline", () => {
  renderMenu();
  expect(iconFor("Sửa tên tài liệu").getAttribute("fill")).toBe("none");
  expect(iconFor("Xem tài liệu").getAttribute("fill")).toBe("none");
});
