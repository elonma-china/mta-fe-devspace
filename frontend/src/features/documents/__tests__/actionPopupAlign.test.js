// src/features/documents/__tests__/actionPopupAlign.test.js
//
// Story 105: the action popup (ActionMenu, panel "Quản lý tài liệu" in chat) did
// not match Figma 859:23955 — long labels were clipped ("Gỡ khỏi hội t…") because
// `.as-menu` was a fixed 185px width + `.as-mi-label` used text-overflow:ellipsis,
// and the icon rows read as not-level. Fix: menu sizes to content with a
// min-width:185px floor (keeps the design width for short menus AND the shared
// UserCard admin menu unchanged), the label no longer truncates, and the inline
// icons stay a uniform 24×24 outline set (optical leveling is a manual/visual
// check — jsdom can't measure layout). jsdom can't compute external CSS, so we
// assert the CSS source (same approach as story 63/74/97/100).
import fs from "fs";
import path from "path";
import React from "react";
import { render } from "@testing-library/react";

import ActionMenu from "components/menus/ActionMenu";

const CSS_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "components",
  "menus",
  "ActionMenu.css",
);

function ruleBody(css, marker) {
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

const css = () => fs.readFileSync(CSS_PATH, "utf8");

test("actionPopupAlign_menuSizesToContent_withMinWidthFloor", () => {
  const body = ruleBody(css(), ".as-menu {");
  // Width grows to fit the longest label (no clip) but never below the design
  // 185px — so the shared UserCard menu (short labels) stays exactly 185px.
  expect(body).toMatch(/width\s*:\s*max-content/);
  expect(body).toMatch(/min-width\s*:\s*185px/);
});

test("actionPopupAlign_label_doesNotTruncate", () => {
  const body = ruleBody(css(), ".as-mi-label {");
  // "Gỡ khỏi hội thoại" / "Gỡ toàn bộ khỏi hội thoại" must show in full.
  expect(body).not.toMatch(/text-overflow/);
  expect(body).not.toMatch(/overflow\s*:\s*hidden/);
});

test("actionPopupAlign_iconsStayUniform24Outline", () => {
  const { container } = render(
    <ActionMenu open x={0} y={0} onAction={() => {}} onClose={() => {}} />,
  );
  const icons = container.querySelectorAll(".as-menu-item svg.as-mi-icon");
  expect(icons).toHaveLength(3);
  icons.forEach((svg) => {
    // Uniform slot = rows can line up; leveling handled by centered glyphs.
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("fill")).toBe("none");
  });
});
