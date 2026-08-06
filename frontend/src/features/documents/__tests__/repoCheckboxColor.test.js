// src/features/documents/__tests__/repoCheckboxColor.test.js
//
// Story 74: the RepoPickerModal checkboxes are native <input type="checkbox">
// with no accent-color → the browser drew the tick/indeterminate in its default
// blue, not the design's brand teal. Setting accent-color to the brand colour
// fixes the tick + the "Chọn tất cả" indeterminate dash.
//
// jsdom can't compute colours from external CSS, so we assert the CSS source
// directly (same approach as viewerCloseAlign.test.js, story 63).
import fs from "fs";
import path from "path";

const CSS_PATH = path.join(
  __dirname,
  "..",
  "components",
  "repoPicker",
  "RepoPickerModal.css"
);

function ruleBody(css, marker) {
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

test("repoCheckboxColor_usesBrandAccentColor", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const body = ruleBody(css, '.rp-row input[type="checkbox"]');
  // Tick + indeterminate follow the brand colour (teal), not the browser default.
  expect(body).toMatch(/accent-color\s*:\s*var\(--brand-primary/);
});
