// src/features/admin/__tests__/titleInPanelCss.test.js
//
// Story 123: the screen title moved into the content panel (top of the left menu
// / topbar) above a horizontal divider that lines up with the content toolbar's
// divider — matching the Chat panel-header pattern. jsdom can't compute layout, so
// lock the CSS source: each management screen carries the title header + divider.
import fs from "fs";
import path from "path";

const read = (rel) =>
  fs.readFileSync(path.join(__dirname, "..", "..", "..", rel), "utf8");

const userMgmtCss = read("features/admin/pages/UserManagement.css");
const auditCss = read("features/admin/pages/AuditLogs.css");
const unitRepoCss = read("features/documents/pages/UnitRepository.css");

function ruleBody(css, selector) {
  const marker = `\n${selector} {`;
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

const bottomDivider = /border-bottom\s*:\s*1px solid var\(--border-neutral-primary/;

describe("title-into-panel — title header + aligned dividers (story 123)", () => {
  test("umSidebarHeader_carriesTitleDivider", () => {
    // Left-menu title header: title above, divider below, nav under it.
    expect(ruleBody(userMgmtCss, ".um-sidebar__header")).toMatch(bottomDivider);
  });

  test("userMgmtToolbar_carriesContentDivider_alignsWithMenu", () => {
    // Content toolbar's divider sits at the same height as the menu title's.
    expect(ruleBody(userMgmtCss, ".user-mgmt .toolbar")).toMatch(bottomDivider);
  });

  test("unitRepoToolbar_carriesDivider", () => {
    expect(ruleBody(unitRepoCss, ".unit-repo__toolbar")).toMatch(bottomDivider);
  });

  test("auditToolbar_carriesDivider", () => {
    expect(ruleBody(auditCss, ".audit-toolbar")).toMatch(bottomDivider);
  });
});
