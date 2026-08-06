// src/utils/__tests__/clipboardCallsites.test.js
//
// Story 137 regression guard.
//
// The copy button was dead on the internal deployment because the page is
// served over plain HTTP, where the browser exposes no `navigator.clipboard`
// at all. Every copy path now goes through `copyTextToClipboard`, which falls
// back to the legacy command. This test keeps it that way: if someone adds a
// direct `navigator.clipboard` call to a component again, that component will
// silently break on http:// — so fail the build instead.
//
// Production sources only. Test files legitimately stub the clipboard object.
import fs from "fs";
import path from "path";

const SRC_DIR = path.join(__dirname, "..", "..");

// The one file allowed to touch the raw API — it *is* the wrapper.
const ALLOWED = [path.join("utils", "helpers.js")];

const CODE_EXT = new Set([".js", ".jsx", ".ts", ".tsx"]);

/**
 * Drop comments so prose about the API isn't mistaken for a call to it
 * (same approach as chatInputNoArrows.test.js).
 */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** Collect production source files (skipping tests and fixtures). */
function collectSources(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "__mocks__") continue;
      collectSources(full, found);
      continue;
    }
    if (!CODE_EXT.has(path.extname(entry.name))) continue;
    if (/\.(test|spec)\.[jt]sx?$/.test(entry.name)) continue;
    found.push(full);
  }
  return found;
}

describe("clipboard access is centralised (story 137)", () => {
  const sources = collectSources(SRC_DIR);

  test("test_sources_were_actually_scanned", () => {
    // Guard the guard: a broken walk would make the check below vacuously pass.
    expect(sources.length).toBeGreaterThan(20);
  });

  test("test_no_component_calls_navigator_clipboard_directly", () => {
    const offenders = sources
      .filter((file) => {
        const rel = path.relative(SRC_DIR, file);
        return !ALLOWED.includes(rel);
      })
      .filter((file) =>
        /navigator\s*\.\s*clipboard/.test(stripComments(fs.readFileSync(file, "utf8")))
      )
      .map((file) => path.relative(SRC_DIR, file));

    expect(offenders).toEqual([]);
  });

  test("test_the_shared_helper_still_owns_the_modern_api", () => {
    const helpers = stripComments(
      fs.readFileSync(path.join(SRC_DIR, "utils", "helpers.js"), "utf8")
    );
    // The wrapper must keep preferring the real API where it exists, rather
    // than degrading everyone to the legacy path.
    expect(helpers).toMatch(/navigator\.clipboard\?\.writeText/);
    expect(helpers).toMatch(/execCommand\("copy"\)/);
  });
});
