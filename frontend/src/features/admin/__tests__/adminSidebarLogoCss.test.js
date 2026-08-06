// src/features/admin/__tests__/adminSidebarLogoCss.test.js
//
// Story 118: the IntraMind logo moved from the admin sidebar to the shared header
// (top-left, consistent with the Chat screen). The sidebar no longer renders a
// logo, so the story-117 dark-mode filter rule for `.um-sidebar__logo` must be
// gone (no duplicate logo). jsdom can't compute the cascade, so assert the CSS
// source no longer carries the sidebar-logo dark rule.
import fs from "fs";
import path from "path";

const CSS_PATH = path.join(__dirname, "..", "pages", "UserManagement.css");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const css = stripComments(fs.readFileSync(CSS_PATH, "utf8"));

test("adminSidebar_noLogoDarkRule_movedToHeader (story 118)", () => {
  // The sidebar logo (and its dark-mode filter) are removed — the logo now lives
  // in the header.
  expect(css).not.toMatch(/body\.dark\s+\.um-sidebar__logo/);
  expect(css).not.toMatch(/\.um-sidebar__logo\s*\{/);
});
