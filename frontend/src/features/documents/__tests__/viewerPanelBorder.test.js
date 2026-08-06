// src/features/documents/__tests__/viewerPanelBorder.test.js
//
// Story 59 gave the content + preview panels (admin repo + chat) a 1px border to
// read as "cards". Story 125 REVERSES that: every framed page card is now
// borderless — box-shadow ONLY — so Chat's panels stop looking "raised" (nổi) and
// match the admin menu/content cards (.um-sidebar/.user-mgmt were always
// borderless). jsdom can't compute box styles, so lock the CSS source: assert the
// border is GONE and the shadow remains.
import fs from "fs";
import path from "path";

function ruleBody(css, selector) {
  // Match a rule whose selector list contains `selector`, return its body.
  const re = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`
  );
  const m = css.match(re);
  return m ? m[1].replace(/\s/g, "") : null;
}

test("css_adminPanels_borderless_shadowOnly (story 125)", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "../../admin/pages/DocumentManagement.css"),
    "utf8"
  );
  // Border removed (border-radius stays — "border:" won't match "border-radius:").
  expect(ruleBody(css, ".dm-viewer")).not.toMatch(/border:/);
  expect(ruleBody(css, ".dm-list")).not.toMatch(/border:/);
  // Shadow kept (story 120) → cards still separate from the page.
  expect(ruleBody(css, ".dm-viewer")).toMatch(/box-shadow:/);
  expect(ruleBody(css, ".dm-list")).toMatch(/box-shadow:/);
});

test("css_chatPanels_borderless (story 125)", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "../../chat/pages/Chat.css"),
    "utf8"
  );
  // .analysis-panel: FIRST rule (shared base) — no border. .conversation-panel: its
  // own rule — no border.
  expect(ruleBody(css, ".analysis-panel")).not.toMatch(/border:/);
  expect(ruleBody(css, ".conversation-panel")).not.toMatch(/border:/);
});
