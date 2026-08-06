// src/components/layout/__tests__/shellLayoutCss.test.js
//
// Story 119: the shared shell (logo column + left menu + content) misaligned when
// navigating Chat ↔ admin because the left-column width was three independent
// magic numbers (Chat 320px vs admin sidebar 300px vs header .left 300px) and the
// page-root padding differed per screen. Fix: ONE `--sidebar-width` token pointed
// at by all three, `--card-padding` for card insets, and a flush page-root.
// jsdom can't compute layout, so assert the CSS source (single source of truth).
import fs from "fs";
import path from "path";

const read = (rel) =>
  fs
    .readFileSync(path.join(__dirname, "..", "..", "..", rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const indexCss = read("index.css");
const headerCss = read("components/layout/Header.css");
const userMgmtCss = read("features/admin/pages/UserManagement.css");
const chatCss = read("features/chat/pages/Chat.css");
const unitRepoCss = read("features/documents/pages/UnitRepository.css");

/** Body of the exact `\n<selector> {` rule (not descendant/prefixed selectors). */
function ruleBody(css, selector) {
  const marker = `\n${selector} {`;
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

describe("shell layout tokens — single source of truth (story 119)", () => {
  test("indexCss_definesSidebarWidth_and_cardPadding", () => {
    expect(indexCss).toMatch(/--sidebar-width\s*:/);
    expect(indexCss).toMatch(/--card-padding\s*:/);
  });

  test("indexCss_noStandalonePanelDocWidthMagic", () => {
    // The old magic 320px token is gone — the doc panel points at --sidebar-width.
    expect(indexCss).not.toMatch(/--panel-doc-width/);
  });

  test("headerLeft_usesSidebarWidthToken", () => {
    expect(ruleBody(headerCss, ".main-header .left")).toMatch(
      /min-width\s*:\s*var\(--sidebar-width\)/
    );
  });

  test("adminSidebar_usesSidebarWidthToken", () => {
    expect(ruleBody(userMgmtCss, ".um-sidebar")).toMatch(
      /width\s*:\s*var\(--sidebar-width\)/
    );
  });

  test("chatDocumentPanel_usesSidebarWidthToken", () => {
    expect(ruleBody(chatCss, ".document-panel")).toMatch(
      /var\(--sidebar-width\)/
    );
  });

  test("adminContent_and_repoCard_useCardPaddingToken", () => {
    expect(ruleBody(userMgmtCss, ".user-mgmt")).toMatch(
      /padding\s*:\s*var\(--card-padding\)/
    );
    expect(ruleBody(unitRepoCss, ".unit-repo__card")).toMatch(
      /padding\s*:\s*var\(--card-padding\)/
    );
  });

  test("unitRepoRoot_flushHorizontal_noSidePadding", () => {
    // Page-root has NO horizontal padding (content starts flush like chat/admin).
    // Accept top-only shorthand `var(--space-md) 0 0` / `var(--space-md) 0`.
    const body = ruleBody(unitRepoCss, ".unit-repo");
    expect(body).not.toMatch(/padding\s*:\s*var\(--space-md[^;]*\);/); // not all-sides
    expect(body).toMatch(/padding\s*:\s*var\(--space-md[^;]*\)\s+0/); // top then 0 horiz
  });

  test("mobileMainPage_noDuplicatePaddingRuleInHeaderCss", () => {
    // The @768px `.main-page{padding:20px}` duplicate (conflicting with App.css)
    // is removed from Header.css — App.css owns the mobile .main-page padding.
    expect(headerCss).not.toMatch(/\.main-page\s*\{[^}]*padding\s*:\s*20px/);
  });
});
