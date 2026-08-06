// src/features/admin/__tests__/titleTypography.test.js
//
// Story 127 (vế A): screen titles drifted in "độ đậm/nhạt" because the canonical
// Inter character variants (`font-feature-settings: cv01-cv10`) + the exact
// font-family lived ONLY on Chat's `.panel-title`. The left-menu title
// (`.um-sidebar__title`) matched weight/size/color but MISSED those two → glyph
// rendering looked different. Fix = a single source (design tokens
// `--title-font-family` / `--title-font-feature-settings`) that BOTH Chat and the
// left-menu title reference, so they can never drift apart again. jsdom can't
// compute rendered glyphs, so we assert the CSS source (same approach as
// sidebarTitleCenter / unitRepoUiCss).
import fs from "fs";
import path from "path";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");

const indexCss = stripComments(read("..", "..", "..", "index.css"));
const chatCss = stripComments(
  read("..", "..", "..", "features", "chat", "pages", "Chat.css")
);
const umCss = stripComments(read("..", "pages", "UserManagement.css"));

function ruleBody(css, selector) {
  const marker = `\n${selector} {`;
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

describe("Story 127 vế A — title typography 1-source (tokens)", () => {
  test("indexCss_definesTitleTypographyTokens", () => {
    // The canonical, drift-prone bits are defined ONCE, as tokens.
    expect(indexCss).toMatch(/--title-font-family:\s*'Inter'/);
    expect(indexCss).toMatch(
      /--title-font-feature-settings:\s*'cv01'\s*1[^;]*'cv10'\s*1/
    );
  });

  test("chatPanelTitle_referencesTokens_notLiterals", () => {
    // Chat is the STANDARD; its values are unchanged but now point at the source.
    const body = ruleBody(chatCss, ".panel-title");
    expect(body).toMatch(/font-family:\s*var\(--title-font-family\)/);
    expect(body).toMatch(
      /font-feature-settings:\s*var\(--title-font-feature-settings\)/
    );
  });

  test("umSidebarTitle_matchesChat_viaTokens", () => {
    const body = ruleBody(umCss, ".um-sidebar__title");
    // The left-menu title now carries BOTH the canonical font-family and the
    // character variants → matches Chat 100% (no more độ-đậm/nhạt drift)...
    expect(body).toMatch(/font-family:\s*var\(--title-font-family\)/);
    expect(body).toMatch(
      /font-feature-settings:\s*var\(--title-font-feature-settings\)/
    );
    // ...while KEEPING the h3 size (story-126 lock must still hold).
    expect(body).toMatch(/font-size:\s*var\(--font-size-h3\)/);
  });
});
