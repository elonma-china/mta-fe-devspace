// src/features/chat/__tests__/chatBodyNoPageScroll.test.js
//
// Story 76: the chat page produced a page-level vertical scrollbar on the far
// right. The shared MainLayout wraps each page in a <section overflowY:auto>;
// `.chat-body` was `min-height:100%` + `margin-top:var(--space-md)` → 100% + ~16px
// tall → it overflowed that section by the margin → outer scrollbar (big thumb =
// tiny overflow). Fix: height:100% + padding-top (inside border-box) fills the
// section exactly while keeping the header↔panels gap — no overflow.
//
// jsdom can't compute layout from external CSS, so we assert the CSS source.
import fs from "fs";
import path from "path";

const CSS_PATH = path.join(__dirname, "..", "pages", "Chat.css");

// Strip /* ... */ comments so the explanatory CSS comment (which mentions the old
// margin-top / min-height values) doesn't trip the "absent" assertions below.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");

function chatBodyRuleBody(rawCss) {
  const css = stripComments(rawCss);
  const marker = "\n.chat-body {";
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

test("chatBody_fillsShellExactly_noOverflowMargin", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const body = chatBodyRuleBody(css);
  // The overflow-causing stack is gone...
  expect(body).not.toMatch(/margin-top\s*:\s*var\(--space-md\)/);
  expect(body).not.toMatch(/min-height\s*:\s*100%/);
  // ...replaced by an exact fill + inside-border-box padding for the gap.
  expect(body).toMatch(/height\s*:\s*100%/);
  expect(body).toMatch(/padding-top\s*:\s*var\(--space-md\)/);
});
