import { copyTextToClipboard, formatTimestampVi } from "utils/helpers";

// Story 136: the generated-document list showed only a relative time ("1 phút
// trước"), so several results created in the same minute looked identical.
// `formatTimestampVi` gives an absolute "HH:mm:ss DD/MM/YYYY" stamp (matching the
// conversation-name format) so each generation is distinguishable.
describe("formatTimestampVi", () => {
  test("formats a date as HH:mm:ss DD/MM/YYYY with zero-padding", () => {
    const d = new Date(2026, 6, 26, 9, 4, 8); // 2026-07-26 09:04:08 (month 6 = Jul)
    expect(formatTimestampVi(d)).toBe("09:04:08 26/07/2026");
  });

  test("accepts an ISO string", () => {
    const iso = new Date(2026, 0, 2, 13, 24, 58).toISOString();
    expect(formatTimestampVi(iso)).toBe("13:24:58 02/01/2026");
  });

  test("returns empty string for invalid/empty input", () => {
    expect(formatTimestampVi("")).toBe("");
    expect(formatTimestampVi("not a date")).toBe("");
    expect(formatTimestampVi(null)).toBe("");
  });
});

// Story 137: served over plain HTTP on a LAN IP the page is not a secure
// context, so the browser never exposes `navigator.clipboard` — the old direct
// call threw "Cannot read properties of undefined (reading 'writeText')" and
// copy silently did nothing. `copyTextToClipboard` tries the modern API first
// and falls back to the legacy `execCommand` path, which still works on http://.
describe("copyTextToClipboard (story 137)", () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(
    window.navigator,
    "clipboard"
  );

  /** Replace navigator.clipboard (undefined = insecure origin). */
  function setClipboard(value) {
    Object.defineProperty(window.navigator, "clipboard", {
      value,
      configurable: true,
      writable: true,
    });
  }

  beforeEach(() => {
    // jsdom implements neither clipboard nor execCommand, so both are installed
    // per-test; that also lets us assert which path ran.
    setClipboard(undefined);
    document.execCommand = jest.fn(() => true);
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete document.execCommand;
    if (originalClipboard) {
      Object.defineProperty(window.navigator, "clipboard", originalClipboard);
    } else {
      delete window.navigator.clipboard;
    }
  });

  test("test_secure_context_uses_clipboard_api_and_skips_fallback", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    await expect(copyTextToClipboard("xin chào")).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith("xin chào");
    // The legacy path must stay untouched when the modern one works.
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  test("test_insecure_context_without_clipboard_api_falls_back_and_copies", async () => {
    // This is the reported bug: http:// on a LAN IP → no clipboard object.
    setClipboard(undefined);

    await expect(copyTextToClipboard("bài phát biểu")).resolves.toBe(true);

    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });

  test("test_clipboard_api_rejected_falls_back_instead_of_failing", async () => {
    // Permission denied — recoverable, so the legacy path should still run.
    const writeText = jest.fn().mockRejectedValue(new Error("denied"));
    setClipboard({ writeText });

    await expect(copyTextToClipboard("tổng hợp văn bản")).resolves.toBe(true);

    expect(writeText).toHaveBeenCalled();
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });

  test("test_both_paths_fail_resolves_false_and_logs_without_throwing", async () => {
    setClipboard(undefined);
    document.execCommand = jest.fn(() => false);

    await expect(copyTextToClipboard("nội dung")).resolves.toBe(false);

    // Never swallowed silently: the caller gets false AND the reason is logged.
    expect(console.error).toHaveBeenCalled();
  });

  test("test_execCommand_throwing_resolves_false_not_reject", async () => {
    setClipboard(undefined);
    document.execCommand = jest.fn(() => {
      throw new Error("boom");
    });

    await expect(copyTextToClipboard("nội dung")).resolves.toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  test("test_missing_execCommand_resolves_false_not_throw", async () => {
    // Older jsdom / hardened browsers expose no execCommand at all.
    setClipboard(undefined);
    delete document.execCommand;

    await expect(copyTextToClipboard("nội dung")).resolves.toBe(false);
  });

  test("test_empty_or_non_string_input_is_a_no_op", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    await expect(copyTextToClipboard("")).resolves.toBe(false);
    await expect(copyTextToClipboard(null)).resolves.toBe(false);
    await expect(copyTextToClipboard(undefined)).resolves.toBe(false);

    // No success indicator should ever be shown for nothing.
    expect(writeText).not.toHaveBeenCalled();
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  test("test_fallback_restores_focus_and_leaves_no_leftover_node", async () => {
    setClipboard(undefined);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    await copyTextToClipboard("giữ tiêu điểm");

    // Focus goes back to where the user left it...
    expect(document.activeElement).toBe(input);
    // ...and the scratch textarea is gone.
    expect(document.querySelectorAll("textarea")).toHaveLength(0);

    document.body.removeChild(input);
  });
});
