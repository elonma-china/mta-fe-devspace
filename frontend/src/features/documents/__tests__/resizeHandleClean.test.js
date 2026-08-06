// src/features/documents/__tests__/resizeHandleClean.test.js
//
// Story 75: the resize divider showed a striped (repeating-linear-gradient)
// column that looked unbalanced next to the panels' clean card borders. The
// handle is now transparent — the two panels' own borders (story 59) form the
// symmetric divider; the drag (width hit-area + cursor + hover hint + ghost on
// drag) is unchanged (behaviour locked by resizeHandle.test.js).
//
// jsdom can't compute layout from external CSS, so we assert the CSS source.
import fs from "fs";
import path from "path";

const CSS_PATH = path.join(
  __dirname,
  "..",
  "components",
  "viewer",
  "ResizeHandle.css"
);

// Strip /* ... */ comments so explanatory CSS comments (which mention the old
// striped value) don't trip the "absent" assertions below.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");

function baseRuleBody(rawCss) {
  const css = stripComments(rawCss);
  const marker = "\n.dv-resize-handle {";
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

test("resizeHandleClean_noStripedBackground_keepsCursor", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const body = baseRuleBody(css);
  // No striped column any more...
  expect(body).not.toMatch(/repeating-linear-gradient/);
  expect(body).toMatch(/background\s*:\s*transparent/);
  // ...but it is still a draggable divider (hit area + cursor).
  expect(body).toMatch(/cursor\s*:\s*col-resize/);
});

test("resizeHandleClean_keepsHoverHint", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  // Hover affordance is preserved so users still discover the drag.
  expect(css).toMatch(/\.dv-resize-handle:hover/);
});
