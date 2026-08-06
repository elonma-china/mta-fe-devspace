// src/features/admin/__tests__/sidebarTitleCenter.test.js
//
// Story 126: the left-menu title on the management screens was pushed DOWN (the
// header had top-only padding `var(--card-padding) ... 0`), so it didn't read as
// centered like Chat's panel title. This centers it AND levels the content toolbar
// to the same height ("dóng ngang") by making the content an 80px flush header —
// while the story-123 divider (y=80) and the story-124 44px controls are kept.
// jsdom can't compute layout, so assert the CSS source.
import fs from "fs";
import path from "path";

const css = fs.readFileSync(
  path.join(__dirname, "..", "pages", "UserManagement.css"),
  "utf8"
);

function ruleBody(css, selector) {
  const marker = `\n${selector} {`;
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

describe("sidebar title centered + toolbar leveled (story 126)", () => {
  test("umSidebarHeader_symmetricPadding_centersTitle", () => {
    const body = ruleBody(css, ".um-sidebar__header");
    // Symmetric vertical padding (no top-only) → align-items:center truly centers.
    expect(body).toMatch(/padding:\s*0 var\(--space-md\)/);
    expect(body).not.toMatch(/padding:\s*var\(--card-padding\) var\(--space-md\) 0/);
    expect(body).toMatch(/align-items:\s*center/);
  });

  test("umSidebarTitle_matchesChatTypography_h3", () => {
    expect(ruleBody(css, ".um-sidebar__title")).toMatch(
      /font-size:\s*var\(--font-size-h3\)/
    );
  });

  test("navContent_flushTop_toolbar80_levelsTitle", () => {
    // Content becomes an 80px flush header (padding-top:0 + toolbar height 80) so it
    // levels with the centered title; scoped to the nav layout (audit untouched).
    expect(css).toMatch(/\.user-mgmt-layout \.user-mgmt\s*\{[^}]*padding-top:\s*0/);
    expect(css).toMatch(
      /\.user-mgmt-layout \.user-mgmt \.toolbar\s*\{[^}]*height:\s*80px/
    );
  });
});
