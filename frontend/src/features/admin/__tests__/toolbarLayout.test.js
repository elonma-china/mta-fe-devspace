// src/features/admin/__tests__/toolbarLayout.test.js
//
// Story 43: the shared admin list toolbar `.user-mgmt .toolbar` used
// `justify-content: space-between`. With the search bar capped at 720px, the
// leftover width spread as uneven gaps between search / lookup / action button,
// so the search↔lookup gap didn't match the design. The fix drops space-between
// (search + lookup sit at the fixed toolbar gap) and pushes the trailing action
// button group to the right via `margin-left: auto` on the first `.add-user-btn`.
//
// jsdom can't compute layout from external CSS, so we lock against the CSS
// source: space-between is gone AND the right-push mechanism is present (so the
// 2-item search+button toolbars don't regress to a left-stuck button).
import fs from "fs";
import path from "path";

const CSS_PATH = path.join(__dirname, "..", "pages", "UserManagement.css");

/** Body of the exact `.user-mgmt .toolbar { ... }` rule (not the descendant
 *  `.user-mgmt .toolbar .searchbar` / `.add-user-btn` rules). */
function toolbarRuleBody(css) {
  const marker = "\n.user-mgmt .toolbar {";
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

test("toolbarLayout_listToolbar_noSpaceBetween", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const body = toolbarRuleBody(css);
  // space-between is what spread the search↔lookup gap — must be gone.
  expect(body).not.toMatch(/justify-content\s*:\s*space-between/);
});

test("toolbarLayout_actionButton_pushedRight", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  // Action buttons must stay on the right once space-between is removed.
  expect(css).toMatch(
    /\.user-mgmt\s+\.toolbar\s+\.add-user-btn\s*\{[^}]*margin-left\s*:\s*auto/,
  );
});
