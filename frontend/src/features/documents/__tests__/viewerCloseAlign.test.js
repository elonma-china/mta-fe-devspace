// src/features/documents/__tests__/viewerCloseAlign.test.js
//
// Story 63: the preview close (✕) button must sit on the RIGHT for every file
// type. The header row `.dv-tabs` is a flex row; for PDF the two `.dv-tab`
// (flex:1) push `.dv-close` to the right, but for non-PDF there are no tabs so
// `.dv-close` fell to the LEFT. `margin-left:auto` pins it right regardless of
// whether the tabs are present (PDF or non-PDF).
//
// jsdom can't compute layout from external CSS, so we assert the CSS source
// directly (same approach as viewerFillWidth.test.js, story 53).
import fs from "fs";
import path from "path";

const CSS_PATH = path.join(
  __dirname,
  "..",
  "components",
  "viewer",
  "DocumentViewer.css"
);

/** Body of the exact `.dv-close { ... }` rule (not :hover / descendant). */
function dvCloseRuleBody(css) {
  const marker = "\n.dv-close {";
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

test("viewerCloseAlign_dvClose_pinnedRight", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const body = dvCloseRuleBody(css);
  // Pins the close button to the right edge of the header flex row for ALL file
  // types (PDF keeps it right; non-PDF no longer falls to the left).
  expect(body).toMatch(/margin-left\s*:\s*auto/);
});
