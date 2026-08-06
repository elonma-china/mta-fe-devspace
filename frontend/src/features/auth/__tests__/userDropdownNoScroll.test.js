// src/features/auth/__tests__/userDropdownNoScroll.test.js
//
// Story 92 (supersedes story 84): the Vai trò / Đơn vị lookups in the create-user
// modal must OVERLAY (float) like the MultiSelectDropdown lookup, NOT push content
// in-flow. Story 84 made the list in-flow (position:static) to dodge the original
// clipping bug, but that resized the dialog when a lookup opened and made the X
// button misfire (the centered dialog re-centers on close, moving the absolute X
// between mousedown↔mouseup). The real fix: drop the `.aum-fields { overflow:auto }`
// clipping ancestor (story 73's scroll fallback) so the popup can be an absolute
// overlay again — no resize, X stays put. The popup gets its own max-height +
// scroll for long lists. `.aum-dialog` (story 73 height:auto + max-height) stays.
//
// jsdom can't compute layout from external CSS, so we assert the CSS source
// directly (same approach as userModalNoScroll.test.js, story 73).
import fs from "fs";
import path from "path";

const CSS_PATH = path.join(
  __dirname,
  "..",
  "components",
  "UserProfileModal.css"
);

function ruleBody(css, selector) {
  const marker = `\n.${selector} {`;
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

test("userDropdown_listIsAbsoluteOverlay_doesNotResizeForm", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const body = ruleBody(css, "aum-dropdown-list");
  // Overlay so opening a lookup floats over the fields instead of pushing them.
  expect(body).toMatch(/position\s*:\s*absolute/);
  expect(body).toMatch(/z-index/);
});

test("userDropdown_listHasOwnScrollCap_forLongLists", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const body = ruleBody(css, "aum-dropdown-list");
  // Long unit lists scroll WITHIN the popup (not by resizing the dialog).
  expect(body).toMatch(/max-height/);
  expect(body).toMatch(/overflow-y\s*:\s*auto/);
});

test("userDropdown_fieldsHaveNoOverflowClip_soOverlayIsNotClipped", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const body = ruleBody(css, "aum-fields");
  // The `.aum-fields { overflow:auto }` ancestor (story 73) is what clipped the
  // absolute popup (story 84). It must be gone so the overlay shows in full.
  expect(body).not.toMatch(/overflow\s*:\s*auto/);
});

test("userDropdown_dialogStillSizesToContent_story73Kept", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const body = ruleBody(css, "aum-dialog");
  expect(body).toMatch(/height\s*:\s*auto/);
  expect(body).toMatch(/max-height\s*:\s*calc\(100dvh/);
});
