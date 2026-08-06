// src/components/layout/__tests__/cardShadowCss.test.js
//
// Story 120: the framed page cards had an inconsistent drop shadow — only the
// admin cards (.um-sidebar/.user-mgmt) carried `box-shadow: 0 1px 3px …`, while
// the Chat panels, the unit-repo card and the doc-management split had none. Fix
// (per story 119 / ADR-065): one `--card-shadow` token applied to every framed
// card. jsdom can't compute shadows, so assert the CSS source (single source).
import fs from "fs";
import path from "path";

const read = (rel) =>
  fs
    .readFileSync(path.join(__dirname, "..", "..", "..", rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const indexCss = read("index.css");
const headerScopeCss = {
  chat: read("features/chat/pages/Chat.css"),
  admin: read("features/admin/pages/UserManagement.css"),
  docMgmt: read("features/admin/pages/DocumentManagement.css"),
  unitRepo: read("features/documents/pages/UnitRepository.css"),
};

function ruleBody(css, selector) {
  const marker = `\n${selector} {`;
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

const usesToken = /box-shadow\s*:\s*var\(--card-shadow\)/;

describe("card box-shadow — single --card-shadow token (story 120)", () => {
  test("indexCss_definesCardShadowToken", () => {
    expect(indexCss).toMatch(/--card-shadow\s*:/);
  });

  test("adminCards_useCardShadowToken_notHardcoded", () => {
    expect(ruleBody(headerScopeCss.admin, ".um-sidebar")).toMatch(usesToken);
    expect(ruleBody(headerScopeCss.admin, ".user-mgmt")).toMatch(usesToken);
    // The old hardcoded shadow is gone (tokenized).
    expect(headerScopeCss.admin).not.toMatch(
      /box-shadow\s*:\s*0 1px 3px rgba\(0, 0, 0, 0\.08\)/
    );
  });

  test("chatPanels_useCardShadowToken", () => {
    // The panels' shared rule is the only box-shadow in Chat.css → assert the
    // file carries the token (robust to the multi-line selector formatting).
    expect(headerScopeCss.chat).toMatch(usesToken);
    expect(headerScopeCss.chat).not.toMatch(/box-shadow\s*:\s*0 /); // no hardcoded
  });

  test("unitRepoCards_useCardShadowToken", () => {
    expect(ruleBody(headerScopeCss.unitRepo, ".unit-repo__card")).toMatch(usesToken);
    expect(ruleBody(headerScopeCss.unitRepo, ".unit-repo__viewer")).toMatch(usesToken);
  });

  test("docMgmtSplitCards_useCardShadowToken", () => {
    expect(ruleBody(headerScopeCss.docMgmt, ".dm-list")).toMatch(usesToken);
    expect(ruleBody(headerScopeCss.docMgmt, ".dm-viewer")).toMatch(usesToken);
  });
});
