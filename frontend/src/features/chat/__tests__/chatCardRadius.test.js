// src/features/chat/__tests__/chatCardRadius.test.js
//
// Story 121: the framed page cards had an inconsistent corner radius — the Chat
// panels used var(--radius-lg) (=12px) while every admin/repo card used 16px, so
// Chat "stood out". Fix (per ADR-065): one `--card-radius` token (=16px) applied
// to every framed card. jsdom can't compute layout, so assert the CSS source.
import fs from "fs";
import path from "path";

const read = (rel) =>
  fs
    .readFileSync(path.join(__dirname, "..", "..", "..", rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const indexCss = read("index.css");
const chatCss = read("features/chat/pages/Chat.css");
const docMgmtCss = read("features/admin/pages/DocumentManagement.css");
const userMgmtCss = read("features/admin/pages/UserManagement.css");
const unitRepoCss = read("features/documents/pages/UnitRepository.css");

function ruleBody(css, selector) {
  const marker = `\n${selector} {`;
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

const usesRadiusToken = /border-radius\s*:\s*var\(--card-radius\)/;

describe("card corner-radius — single --card-radius token (story 121)", () => {
  test("indexCss_definesCardRadiusToken_16px", () => {
    expect(indexCss).toMatch(/--card-radius\s*:\s*16px/);
  });

  test("chatPanels_useCardRadiusToken_notRadiusLg", () => {
    // Both panel rules (shared .document/.conversation/.analysis + .conversation)
    // now carry the token; none stays on the 12px scale token (which caused drift).
    expect(chatCss).toMatch(usesRadiusToken);
    expect(chatCss).not.toMatch(/border-radius\s*:\s*var\(--radius-lg\)/);
  });

  test("adminRepoCards_useCardRadiusToken_notHardcoded16", () => {
    expect(ruleBody(docMgmtCss, ".dm-list")).toMatch(usesRadiusToken);
    expect(ruleBody(docMgmtCss, ".dm-viewer")).toMatch(usesRadiusToken);
    expect(ruleBody(userMgmtCss, ".um-sidebar")).toMatch(usesRadiusToken);
    expect(ruleBody(userMgmtCss, ".user-mgmt")).toMatch(usesRadiusToken);
    expect(ruleBody(unitRepoCss, ".unit-repo__card")).toMatch(usesRadiusToken);
    expect(ruleBody(unitRepoCss, ".unit-repo__viewer")).toMatch(usesRadiusToken);
  });
});
