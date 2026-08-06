// src/features/chat/__tests__/chatInputNoArrows.test.js
//
// Story 114: the chat input textarea showed 2 native up/down scrollbar arrow
// buttons (▲▼) even on a single line that doesn't need scrolling. Two-part fix:
//   1. resizeTextarea() toggles overflowY — hidden while content fits (no
//      scrollbar/arrows), auto only once content exceeds the max height.
//   2. .ci-input styles the scrollbar thin AND removes the native
//      ::-webkit-scrollbar-button (the arrows) + scrollbar-width: thin (Firefox).
//
// ChatInterface itself can't render in jsdom (react-markdown ESM), so we unit
// test the pure helper and assert the CSS source (same approach as
// chatBodyNoPageScroll.test.js).
import fs from "fs";
import path from "path";
import {
  resizeTextarea,
  CHAT_INPUT_MAX_HEIGHT,
} from "features/chat/components/resizeTextarea";

const CSS_PATH = path.join(__dirname, "..", "components", "ChatInterface.css");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const css = stripComments(fs.readFileSync(CSS_PATH, "utf8"));

function ciInputRuleBody(rawCss) {
  const marker = "\n.ci-input {";
  const start = rawCss.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = rawCss.indexOf("{", start);
  const close = rawCss.indexOf("}", open);
  return rawCss.slice(open + 1, close);
}

describe("resizeTextarea (story 114)", () => {
  test("contentFits_overflowHidden_noScrollbar", () => {
    const el = { style: {}, scrollHeight: 40 };
    resizeTextarea(el);
    // Height follows content...
    expect(el.style.height).toBe("40px");
    // ...and scrolling stays off → no scrollbar, hence no arrow buttons.
    expect(el.style.overflowY).toBe("hidden");
  });

  test("contentAtMax_overflowHidden_noScroll", () => {
    const el = { style: {}, scrollHeight: CHAT_INPUT_MAX_HEIGHT };
    resizeTextarea(el);
    expect(el.style.height).toBe(`${CHAT_INPUT_MAX_HEIGHT}px`);
    expect(el.style.overflowY).toBe("hidden");
  });

  test("contentExceedsMax_capsHeight_enablesScroll", () => {
    const el = { style: {}, scrollHeight: 300 };
    resizeTextarea(el);
    // Height caps at the max...
    expect(el.style.height).toBe(`${CHAT_INPUT_MAX_HEIGHT}px`);
    // ...and only now scrolling turns on (the bar itself is arrow-less via CSS).
    expect(el.style.overflowY).toBe("auto");
  });

  test("customMaxHeight_respected", () => {
    const el = { style: {}, scrollHeight: 120 };
    resizeTextarea(el, 80);
    expect(el.style.height).toBe("80px");
    expect(el.style.overflowY).toBe("auto");
  });

  test("nullElement_noThrow", () => {
    expect(() => resizeTextarea(null)).not.toThrow();
  });
});

describe("chat input scrollbar has no native up/down arrows (story 114 CSS)", () => {
  test("webkitScrollbarButton_hidden_removesArrows", () => {
    // The native ▲▼ buttons live in ::-webkit-scrollbar-button.
    expect(css).toMatch(
      /\.ci-input::-webkit-scrollbar-button\s*\{[^}]*display\s*:\s*none/
    );
  });

  test("firefoxScrollbar_thin_noArrows", () => {
    // Firefox thin scrollbar has no arrow buttons by design.
    const body = ciInputRuleBody(css);
    expect(body).toMatch(/scrollbar-width\s*:\s*thin/);
  });

  test("ciInput_defaultOverflowNotAuto", () => {
    // Base rule no longer forces overflow-y:auto (which reserved the arrow bar);
    // resizeTextarea toggles it at runtime instead.
    const body = ciInputRuleBody(css);
    expect(body).not.toMatch(/overflow-y\s*:\s*auto/);
  });
});
