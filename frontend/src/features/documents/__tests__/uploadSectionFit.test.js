// src/features/documents/__tests__/uploadSectionFit.test.js
//
// Story 89: the upload dropzone text block (.ufs-drop-text/title/caption) had a
// hard-coded width:704px. UploadFileSection is reused inside the narrower admin
// "Thêm tài liệu" dialog (.dem-dialog = min(520px,...)), so the 704px block
// overflowed horizontally → an unnecessary horizontal scrollbar on the popup.
// Fix: make the block container-relative (width:100% capped at max-width:704px)
// so it fits the narrow dialog yet keeps its ≤704px look in the wide chat modal.
//
// jsdom can't compute layout from external CSS, so we assert the CSS source
// directly (same approach as userModalNoScroll.test.js, story 73/84).
import fs from "fs";
import path from "path";

const CSS_PATH = path.join(
  __dirname,
  "..",
  "components",
  "UploadFileSection.css"
);

/** Body of a base `.<selector> { ... }` rule (first, non-media occurrence). */
function ruleBody(css, selector) {
  const marker = `\n.${selector} {`;
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

const SELECTORS = ["ufs-drop-text", "ufs-drop-title", "ufs-drop-caption"];

test("uploadSectionFit_dropText_noFixed704Width", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  for (const sel of SELECTORS) {
    const body = ruleBody(css, sel);
    // No plain fixed width:704px (max-width:704px is allowed / expected).
    expect(body).not.toMatch(/[^-]width:\s*704px/);
  }
});

test("uploadSectionFit_dropText_isContainerRelative", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  for (const sel of SELECTORS) {
    const body = ruleBody(css, sel);
    expect(body).toMatch(/width:\s*100%/);
    expect(body).toMatch(/max-width:\s*704px/);
  }
});
