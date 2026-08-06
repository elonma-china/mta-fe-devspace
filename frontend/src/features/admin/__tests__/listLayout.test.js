// src/features/admin/__tests__/listLayout.test.js
//
// Story 42: the shared admin list-page content frame `.user-mgmt` had a
// hardcoded `max-width: 1856px` + `margin-left/right: auto`. In the flex row
// `.user-mgmt-layout` (sidebar 300px + content) this caps the content on wide
// screens and centers it, leaving a big gap between the left menu and the list
// — only on large viewports. The fix removes the cap + auto margins so the list
// fills the space next to the menu. This locks that the hardcode stays removed.
//
// jsdom can't compute layout from external CSS, so we assert against the CSS
// source directly: the `.user-mgmt` rule must not re-introduce the cap.
import fs from "fs";
import path from "path";

const CSS_PATH = path.join(
  __dirname,
  "..",
  "pages",
  "UserManagement.css",
);

/** Extract the body of the exact `.user-mgmt { ... }` rule (not .user-mgmt-layout
 *  nor descendant selectors like `.user-mgmt .toolbar`). */
function userMgmtRuleBody(css) {
  const marker = "\n.user-mgmt {";
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

test("listLayout_userMgmtFrame_noHardcodedWidthCap", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const body = userMgmtRuleBody(css);
  // No hardcoded max-width cap (root cause of the wide-screen gap).
  expect(body).not.toMatch(/max-width\s*:/);
});

test("listLayout_userMgmtFrame_noAutoCenteringMargins", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const body = userMgmtRuleBody(css);
  // No auto side-margins → content stays adjacent to the left menu, not centered.
  expect(body).not.toMatch(/margin-left\s*:\s*auto/);
  expect(body).not.toMatch(/margin-right\s*:\s*auto/);
});
