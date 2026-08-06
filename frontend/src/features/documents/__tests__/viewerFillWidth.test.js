// src/features/documents/__tests__/viewerFillWidth.test.js
//
// Story 53: the viewer root `.doc-viewer` only set height:100%, not width. In
// the admin repo host (`.dm-viewer`, a flex-ROW) the viewer is a main-axis item
// with no flex-grow, so it collapsed to its content width — a thin strip instead
// of filling the 42% pane. (The chat host `.analysis-panel` is a flex-COLUMN, so
// it already stretched the width — no bug there.) The fix adds `width: 100%` so
// the viewer fills its host in BOTH layouts.
//
// jsdom can't compute layout from external CSS, so we assert against the CSS
// source directly (same approach as listLayout.test.js, story 42).
import fs from "fs";
import path from "path";

const CSS_PATH = path.join(
  __dirname,
  "..",
  "components",
  "viewer",
  "DocumentViewer.css"
);

/** Body of the exact `.doc-viewer { ... }` rule (not descendant selectors). */
function docViewerRuleBody(css) {
  const marker = "\n.doc-viewer {";
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

test("viewerFillWidth_docViewer_fillsContainerWidth", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const body = docViewerRuleBody(css);
  // The viewer root must fill its host width (fixes the collapsed thin strip in
  // the flex-row admin host).
  expect(body).toMatch(/width\s*:\s*100%/);
});

test("viewerFillWidth_docViewer_keepsFullHeight", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const body = docViewerRuleBody(css);
  // Height fill must remain (regression guard for the existing behavior).
  expect(body).toMatch(/height\s*:\s*100%/);
});
