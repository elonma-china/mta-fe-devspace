// src/features/documents/__tests__/unitRepoUiCss.test.js
//
// Story 116: CSS-only fixes for the "Kho tài liệu" (unit repository) screen.
// jsdom can't resolve CSS custom-property cascade or the `.dark` class, so we
// assert the CSS source (same approach as chatBodyNoPageScroll / chatInputNoArrows).
//   #5 dark mode: the back button / title / page-size text must use the CANONICAL
//      --txt-neutral-primary token (it switches in .dark), NOT the undefined typo
//      --text-neutral-primary (which fell back to a hardcoded dark literal).
//   #3 bold headers: a scoped .unit-repo header rule recolors the muted-gray header.
//   #4 search icon: a scoped rule enlarges the magnifier beyond the shared 24px.
import fs from "fs";
import path from "path";

const CSS_PATH = path.join(__dirname, "..", "pages", "UnitRepository.css");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const css = stripComments(fs.readFileSync(CSS_PATH, "utf8"));

describe("UnitRepository.css — story 116 UI fixes", () => {
  test("darkMode_usesCanonicalTxtVariable_notTypo (#5)", () => {
    // The typo variable is gone everywhere...
    expect(css).not.toMatch(/--text-neutral-primary/);
    // ...replaced by the canonical, dark-mode-aware token on the 3 affected rules.
    expect(css).toMatch(/\.unit-repo__back\b[^}]*--txt-neutral-primary/);
    expect(css).toMatch(/\.unit-repo__title\b[^}]*--txt-neutral-primary/);
    expect(css).toMatch(/\.unit-repo__pagesize[^}]*--txt-neutral-primary/);
  });

  test("boldHeaders_scopedOverride (#3)", () => {
    // Scoped to the repo screen only (no admin blast radius): recolor + bolden.
    expect(css).toMatch(
      /\.unit-repo\s+\.data-table\s+thead\s+th\s*\{[^}]*--txt-neutral-primary/
    );
    expect(css).toMatch(
      /\.unit-repo\s+\.data-table\s+thead\s+th\s*\{[^}]*font-weight\s*:\s*700/
    );
  });

  test("searchIcon_scopedEnlarged (#4)", () => {
    // Scoped enlarge of the magnifier (shared default is 24px).
    const m = css.match(
      /\.unit-repo__toolbar\s+\.searchbar__icon\s+svg\s*\{([^}]*)\}/
    );
    expect(m).not.toBeNull();
    const wm = m[1].match(/width\s*:\s*(\d+)px/);
    expect(wm).not.toBeNull();
    expect(Number(wm[1])).toBeGreaterThan(24);
  });
});
