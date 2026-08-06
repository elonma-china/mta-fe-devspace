// src/features/documents/__tests__/menuLabelLeft.test.js
//
// Story 106: the popup item text (Xem / Sửa tên / Xoá tài liệu) rendered
// CENTRED — `.as-menu-item` is a <button> (browser default text-align:center)
// and the `.as-mi-label` span (flex:1, wide) inherited it. Story 105 widened the
// menu (width:max-content) which exposed the centring. Fix: pin the label to
// text-align:left so every row's text hugs the icon on a common left margin.
// jsdom can't compute external CSS, so assert the CSS source (story 63/74/97/105).
import fs from "fs";
import path from "path";

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

test("menuLabelLeft_labelIsLeftAligned", () => {
  const body = ruleBody(css(), ".as-mi-label {");
  // Left-aligned, overriding the inherited <button> text-align:center.
  expect(body).toMatch(/text-align\s*:\s*left/);
});
