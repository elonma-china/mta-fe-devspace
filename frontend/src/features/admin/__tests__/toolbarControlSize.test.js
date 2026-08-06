// src/features/admin/__tests__/toolbarControlSize.test.js
//
// Story 124: the management-screen toolbar controls (search 56 / lookup 48 /
// button 40) were taller and mismatched vs the Chat lookup (44px). This unifies
// them to 44px SCOPED to the management toolbars — the shared SearchBar /
// MultiSelectDropdown base size is left UNCHANGED so chat + modals keep theirs.
// jsdom can't compute layout, so assert the CSS source.
import fs from "fs";
import path from "path";

const read = (rel) =>
  fs.readFileSync(path.join(__dirname, "..", "..", "..", rel), "utf8");

const userMgmtCss = read("features/admin/pages/UserManagement.css");
const unitRepoCss = read("features/documents/pages/UnitRepository.css");
const searchBarCss = read("components/common/inputs/SearchBar.css");
const msDropdownCss = read("components/common/inputs/MultiSelectDropdown.css");

function ruleBody(css, selector) {
  const marker = `\n${selector} {`;
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

describe("toolbar control size — 44px scoped, base unchanged (story 124)", () => {
  test("userMgmtToolbar_controls_44px", () => {
    // Scoped rules under `.user-mgmt .toolbar` set 44px for search/lookup/button.
    expect(userMgmtCss).toMatch(
      /\.user-mgmt \.toolbar \.searchbar[\s\S]{0,260}height:\s*44px/
    );
    expect(userMgmtCss).toMatch(
      /\.user-mgmt \.toolbar \.ms-dropdown__trigger\s*\{[^}]*height:\s*44px/
    );
    expect(userMgmtCss).toMatch(
      /\.user-mgmt \.toolbar \.add-user-btn\s*\{[^}]*height:\s*44px/
    );
  });

  test("unitRepoToolbar_controls_44px", () => {
    expect(unitRepoCss).toMatch(
      /\.unit-repo__toolbar \.searchbar[\s\S]{0,260}height:\s*44px/
    );
    expect(unitRepoCss).toMatch(
      /\.unit-repo__toolbar \.ms-dropdown__trigger\s*\{[^}]*height:\s*44px/
    );
  });

  test("toolbarBox_navHeight80_levelsWithMenuTitle (story 126)", () => {
    // Story 126: on the nav screens the content toolbar is an 80px flush header
    // (matching the 80px menu-title header) so controls center at the SAME height as
    // the title; the divider stays at y=80. (Base `.user-mgmt .toolbar` = 56 remains
    // for the audit screen, which overrides height:auto anyway.)
    expect(userMgmtCss).toMatch(
      /\.user-mgmt-layout \.user-mgmt \.toolbar\s*\{[^}]*height:\s*80px/
    );
  });

  test("baseSearchBar_unchanged_56px", () => {
    // The shared component base is NOT touched (chat RepoPicker / modals safe).
    expect(ruleBody(searchBarCss, ".searchbar")).toMatch(/height:\s*56px/);
  });

  test("baseMsDropdownTrigger_unchanged_48px", () => {
    expect(ruleBody(msDropdownCss, ".ms-dropdown__trigger")).toMatch(/height:\s*48px/);
  });
});
