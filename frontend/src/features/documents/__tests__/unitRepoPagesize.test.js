// src/features/documents/__tests__/unitRepoPagesize.test.js
//
// Story 127 (vế B): the page-size lookup ("N tài liệu/trang") in the unit
// repository footer was a NATIVE <select> — it kept the browser's default arrow /
// box and sat inline (baseline-misaligned) next to "Tổng cộng … tài liệu", so it
// read as inconsistent with the app's lookup language and "vỡ khung". Fix (CSS
// only, scoped to `.unit-repo`): strip the native appearance + draw our own
// chevron + vertically center it in the footer. jsdom can't compute layout, so we
// assert the CSS source (same approach as unitRepoUiCss).
import fs from "fs";
import path from "path";

const CSS_PATH = path.join(__dirname, "..", "pages", "UnitRepository.css");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const css = stripComments(fs.readFileSync(CSS_PATH, "utf8"));

function ruleBody(selector) {
  const marker = `\n${selector} {`;
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

describe("UnitRepository.css — story 127 vế B pagesize lookup", () => {
  test("pagesizeSelect_stripsNative_drawsChevron", () => {
    const body = ruleBody(".unit-repo__pagesize select");
    // Native arrow/box removed...
    expect(body).toMatch(/appearance:\s*none/);
    // ...replaced by our own chevron drawn via a background image...
    expect(body).toMatch(/background-image:\s*url\(/);
    // ...and the dark-mode-aware text token is kept (story-116 lock #5).
    expect(body).toMatch(/--txt-neutral-primary/);
  });

  test("footerText_scopedFlex_centersLookup", () => {
    // Scoped to `.unit-repo` so the shared DataTable footer on the other list
    // screens (users/docs/audit) is NOT touched.
    const m = css.match(
      /\.unit-repo\s+\.data-table-footer\s+\.footer-text\s*\{([^}]*)\}/
    );
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/display:\s*(inline-)?flex/);
    expect(m[1]).toMatch(/align-items:\s*center/);
  });
});
