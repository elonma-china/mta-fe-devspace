// src/features/auth/__tests__/userModalNoScroll.test.js
//
// Story 73: the create/edit user modal showed an unnecessary vertical scrollbar
// because `.aum-dialog` had a FIXED height (652px / 540px tablet) that the
// content nearly exceeded (commander variant adds a note line). The fix sizes
// the dialog to its content (`height: auto`) and keeps `max-height` so it still
// scrolls only when the viewport is genuinely too short.
//
// jsdom can't compute layout from external CSS, so we assert the CSS source
// directly (same approach as viewerCloseAlign.test.js, story 63).
import fs from "fs";
import path from "path";

const CSS_PATH = path.join(
  __dirname,
  "..",
  "components",
  "UserProfileModal.css"
);

/** Body of the exact `.aum-dialog { ... }` base rule (not media-query copy). */
function aumDialogRuleBody(css) {
  const marker = "\n.aum-dialog {";
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

test("userModalNoScroll_dialog_sizesToContent_keepsMaxHeight", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const body = aumDialogRuleBody(css);
  // Sizes to content (no fixed height that forces a scrollbar)...
  expect(body).toMatch(/height\s*:\s*auto/);
  expect(body).not.toMatch(/height\s*:\s*652px/);
  // ...but still caps to the viewport so small screens can scroll as a fallback.
  expect(body).toMatch(/max-height\s*:\s*calc\(100dvh/);
});

test("userModalNoScroll_noFixedDialogHeightAnywhere", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  // Neither the base rule nor the tablet media query may pin a fixed height
  // (652px desktop / 540px tablet both removed).
  expect(css).not.toMatch(/height\s*:\s*652px/);
  expect(css).not.toMatch(/height\s*:\s*540px/);
});
