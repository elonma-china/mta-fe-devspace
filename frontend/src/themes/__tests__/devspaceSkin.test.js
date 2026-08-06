/**
 * The Dev Space skin must be a pure token override that stays off by default.
 *
 * Two failures this guards against, both of which would be found late and by
 * eye rather than by a test:
 *   1. a component rule sneaking into devspace.css, which would make the skin
 *      impossible to lift cleanly out of the voice handover diff;
 *   2. the skin overriding a token that index.css never declared, which
 *      silently does nothing.
 */
import fs from "fs";
import path from "path";

const read = (rel) =>
  fs.readFileSync(path.join(__dirname, "..", "..", rel), "utf8");

const skin = read("themes/devspace.css");
const base = read("index.css");

/** Selectors a stylesheet declares, ignoring at-rules and comments. */
const selectorsOf = (css) =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("}")
    .map((block) => block.split("{")[0].trim())
    .filter((sel) => sel && !sel.startsWith("@"));

/** Custom-property names declared inside a stylesheet. */
const tokensOf = (css) => {
  const out = new Set();
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) out.add(m[1]);
  return out;
};

test("the skin only ever targets the opt-in body class", () => {
  // Anything else here is a component rule, and component rules are exactly
  // what makes a skin unmergeable.
  for (const selector of selectorsOf(skin)) {
    expect(selector).toMatch(/^body\.brand-devspace(\.dark)?$/);
  }
});

test("the skin declares nothing but custom properties", () => {
  const withoutComments = skin.replace(/\/\*[\s\S]*?\*\//g, "");
  const declarations = withoutComments.match(/[a-z-]+\s*:/gi) || [];
  for (const decl of declarations) {
    expect(decl.trim()).toMatch(/^--/);
  }
});

test("every token the skin overrides is one index.css actually declares", () => {
  // Overriding an undeclared token is a no-op that looks like a fix.
  const baseTokens = tokensOf(base);
  for (const token of tokensOf(skin)) {
    expect(baseTokens.has(token)).toBe(true);
  }
});

test("index.css declares the two tokens that used to exist only as fallbacks", () => {
  // `var(--bg-brand-subtle, #d6f2e8)` always resolved to the fallback while
  // the token went undeclared, so no theme could reach those surfaces.
  const baseTokens = tokensOf(base);
  expect(baseTokens.has("--bg-brand-subtle")).toBe(true);
  expect(baseTokens.has("--accent-primary")).toBe(true);
  expect(baseTokens.has("--brand-primary-hover")).toBe(true);
});

test("the skin covers dark mode too", () => {
  expect(skin).toMatch(/body\.brand-devspace\.dark\s*\{/);
  // The dark brand colour must differ from the light one, or dark mode reads
  // as unstyled.
  const light = /body\.brand-devspace\s*\{[\s\S]*?--brand-primary:\s*([^;]+);/.exec(skin);
  const dark = /body\.brand-devspace\.dark\s*\{[\s\S]*?--brand-primary:\s*([^;]+);/.exec(skin);
  expect(light[1].trim()).not.toBe(dark[1].trim());
});

test("no brand hex escapes the token system", () => {
  // The skin can only reach surfaces that read a token. Any bare teal literal
  // left in a component stylesheet is a patch of IntraMind green surviving in
  // a red build.
  const srcDir = path.join(__dirname, "..", "..");
  const offenders = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".css")) {
        const rel = path.relative(srcDir, full);
        if (rel === "index.css" || rel.startsWith("themes")) continue;
        // Strip comments first: several stylesheets *describe* the old teal
        // in prose ("#226355 semibold, read = dark regular"), which is
        // documentation, not a surviving literal.
        const css = fs
          .readFileSync(full, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "");
        for (const line of css.split("\n")) {
          // Bare literals only — `var(--brand-primary, #226355)` is fine,
          // the token wins.
          if (/#(226355|267c69|1c5b4c|226335)\b/i.test(line) && !line.includes("var(--")) {
            offenders.push(`${rel}: ${line.trim()}`);
          }
        }
      }
    }
  };
  walk(srcDir);

  expect(offenders).toEqual([]);
});
