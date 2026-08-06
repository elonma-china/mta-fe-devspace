// src/features/admin/__tests__/previewBorderAlign.test.js
//
// Story 64: on the repository screen the three cards (menu / content / preview)
// must read as one family — consistent corner radius AND an even gap. Story 59
// gave content/preview a border + radius:var(--radius-lg)=12px, while the menu
// (.um-sidebar) uses 16px; and .dm-split had gap:0 (story 40) so the preview sat
// flush against the content while menu↔content has var(--space-md). This story
// unifies the radius to 16px and adds the gap. jsdom can't compute layout, so we
// lock the CSS source (pattern: viewerFillWidth/viewerPanelBorder, story 53/59).
import fs from "fs";
import path from "path";

const CSS_PATH = path.join(
  __dirname,
  "..",
  "pages",
  "DocumentManagement.css"
);

/** Body of the exact `<selector> { ... }` rule. */
function ruleBody(css, selector) {
  const marker = `\n${selector} {`;
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

test("previewBorderAlign_split_hasGap", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const body = ruleBody(css, ".dm-split");
  // The preview no longer sits flush against the content — gap matches the
  // menu↔content gap (var(--space-md)), not 0.
  expect(body).toMatch(/gap\s*:\s*var\(--space-md\)/);
  expect(body).not.toMatch(/gap\s*:\s*0\b/);
});

test("previewBorderAlign_cards_radius16", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  // Story 121: content + preview cards adopt the shared `--card-radius` token
  // (=16px, one family with the menu card AND the Chat panels — no more 12/16 drift).
  expect(ruleBody(css, ".dm-viewer")).toMatch(/border-radius\s*:\s*var\(--card-radius\)/);
  expect(ruleBody(css, ".dm-list")).toMatch(/border-radius\s*:\s*var\(--card-radius\)/);
});
