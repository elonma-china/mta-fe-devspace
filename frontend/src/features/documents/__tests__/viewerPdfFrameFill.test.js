// src/features/documents/__tests__/viewerPdfFrameFill.test.js
//
// Story 128: the directive-review merge (commit 2b52814) inserted a
// `<div.fov-cite-host>` wrapper between the PDF host `.dv-pdf-wrap` (a flex-ROW)
// and the `<iframe.dv-file-frame>`. That wrapper only sets height:100% — no
// `flex`/`width` — so as a default flex item in the row it collapsed to the
// iframe's intrinsic ~300px width, shrinking the "File gốc" PDF preview to a
// thin strip instead of filling the pane. The fix is a SCOPED rule that makes
// the wrapper fill the flex-row host (`flex:1; min-width:0`). It targets only
// the PDF host, so non-PDF (`.dv-main` block) and CitationCard (`.cc-body`
// flex-column) hosts are untouched — same family of fix as viewerFillWidth
// (story 53).
//
// jsdom can't compute layout from external CSS, so we assert the CSS source
// directly (same approach as viewerFillWidth.test.js / viewerCloseAlign.test.js).
import fs from "fs";
import path from "path";

const CSS_PATH = path.join(
  __dirname,
  "..",
  "components",
  "viewer",
  "DocumentViewer.css"
);

/** Body of the exact `.dv-pdf-wrap > .fov-cite-host { ... }` scoped rule. */
function pdfWrapCiteHostRuleBody(css) {
  const marker = ".dv-pdf-wrap > .fov-cite-host {";
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

test("viewerPdfFrameFill_citeHostInPdfWrap_growsToFillRow", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const body = pdfWrapCiteHostRuleBody(css);
  // The citation wrapper must GROW to fill the flex-row PDF host (so the iframe's
  // width:100% resolves against the full pane, not the ~300px intrinsic width).
  expect(body).toMatch(/flex\s*:\s*1/);
});

test("viewerPdfFrameFill_citeHostInPdfWrap_canShrinkBelowContent", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const body = pdfWrapCiteHostRuleBody(css);
  // min-width:0 lets the flex item shrink below its content min-width so it
  // tracks the pane on resize (no horizontal overflow / stuck-wide).
  expect(body).toMatch(/min-width\s*:\s*0/);
});
