// src/features/documents/__tests__/folderIconColor.test.js
//
// Story 100: the "Kho tài liệu" folder icon in the chat tree was tinted brand
// teal (var(--brand-primary), story 41 for the old Figma node 841-48830). The
// current design (node 1074-26180) draws the folder icon in neutral #262626 =
// var(--txt-neutral-secondary); the checkbox is the only teal element when a row
// is selected. Lock the icon colour to the neutral token so it can't regress back
// to brand teal. jsdom can't compute external CSS, so we assert the CSS source
// (same approach as story 63/74/97).
import fs from "fs";
import path from "path";

const CSS_PATH = path.join(
  __dirname,
  "..",
  "components",
  "DocumentSelect.css",
);

function ruleBody(css, marker) {
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

const css = () => fs.readFileSync(CSS_PATH, "utf8");

test("folderIconColor_usesNeutralNotBrand", () => {
  const body = ruleBody(css(), ".ds-folder-icon {");
  // Neutral #262626 (design 1074-26180), not brand teal.
  expect(body).toMatch(/color\s*:\s*var\(--txt-neutral-secondary/);
  expect(body).not.toMatch(/--brand-primary/);
});
