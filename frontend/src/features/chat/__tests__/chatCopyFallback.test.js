// src/features/chat/__tests__/chatCopyFallback.test.js
//
// Story 137 regression — the chat message copy button.
//
// `ChatInterface.handleCopy` was the second (and only other) place calling
// `navigator.clipboard` directly, so it broke on plain HTTP exactly like the
// info-panel button. It now delegates to the shared `copyTextToClipboard`
// helper. This test locks the two things that must NOT drift:
//   1. it no longer touches the raw clipboard API, and
//   2. the user-facing labels stay "Đã copy" / "Copy lỗi", driven by whether
//      the helper reported success.
//
// ChatInterface can't be rendered in jsdom — its component barrels pull in
// react-router-dom v7 (ESM), which CRA 5's Jest cannot resolve. Same constraint
// and same approach as chatInputNoArrows.test.js / chatBodyNoPageScroll.test.js:
// exercise the extractable behaviour and assert the source for the rest.
import fs from "fs";
import path from "path";
import { copyTextToClipboard } from "utils/helpers";

const SRC_PATH = path.join(__dirname, "..", "components", "ChatInterface.js");
// Comments are stripped so prose mentioning the old API isn't read as a call to
// it (same approach as chatInputNoArrows.test.js).
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const src = stripComments(fs.readFileSync(SRC_PATH, "utf8"));

describe("chat copy goes through the shared helper (story 137)", () => {
  test("test_chat_no_longer_calls_navigator_clipboard_directly", () => {
    // The exact call that threw on http://.
    expect(src).not.toMatch(/navigator\s*\.\s*clipboard/);
  });

  test("test_chat_imports_the_shared_copy_helper", () => {
    expect(src).toMatch(/import\s*\{[^}]*copyTextToClipboard[^}]*\}\s*from\s*"utils\/helpers"/);
    expect(src).toMatch(/await\s+copyTextToClipboard\(text\)/);
  });

  test("test_chat_labels_are_unchanged_and_driven_by_the_helper_result", () => {
    // Success and failure wording is what the user reads — keep both, and keep
    // them tied to the helper's boolean rather than to a thrown error.
    expect(src).toMatch(/ok\s*\?\s*"Đã copy"\s*:\s*"Copy lỗi"/);
  });

  test("test_chat_still_clears_the_label_after_one_second", () => {
    expect(src).toMatch(/setCopyState\(\{\s*index:\s*null,\s*message:\s*""\s*\}\),\s*1000/);
  });

  test("test_chat_still_ignores_empty_text", () => {
    expect(src).toMatch(/if\s*\(!text\)\s*return;/);
  });
});

// The label mapping above is a source assertion, so pin the helper contract it
// depends on: a boolean, never a throw. If copyTextToClipboard started
// rejecting, handleCopy would blow up unnoticed by the assertions above.
describe("helper contract the chat labels rely on (story 137)", () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(
    window.navigator,
    "clipboard"
  );

  afterEach(() => {
    jest.restoreAllMocks();
    delete document.execCommand;
    if (originalClipboard) {
      Object.defineProperty(window.navigator, "clipboard", originalClipboard);
    } else {
      delete window.navigator.clipboard;
    }
  });

  function setClipboard(value) {
    Object.defineProperty(window.navigator, "clipboard", {
      value,
      configurable: true,
      writable: true,
    });
  }

  test("test_helper_resolves_true_on_insecure_origin_so_label_reads_da_copy", async () => {
    setClipboard(undefined); // http:// — no clipboard object
    document.execCommand = jest.fn(() => true);

    await expect(copyTextToClipboard("tin nhắn")).resolves.toBe(true);
  });

  test("test_helper_resolves_false_instead_of_throwing_so_label_reads_copy_loi", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    setClipboard(undefined);
    document.execCommand = jest.fn(() => false);

    await expect(copyTextToClipboard("tin nhắn")).resolves.toBe(false);
  });
});
