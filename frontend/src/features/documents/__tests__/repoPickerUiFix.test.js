// src/features/documents/__tests__/repoPickerUiFix.test.js
//
// Story 95: the chat "Kho tài liệu" picker (RepoPickerModal) was rendered with
// "tạm" sizing from story 16 and never aligned to Figma 841:48818 — small fonts,
// a plain rectangular search box with no icon, and ungrouped columns. This locks
// the presentation back to the design. All changes stay scoped under
// `.repo-picker-shell` / `.rp-*` (never the global modal/btn classes in
// share.css). jsdom can't compute external CSS, so the layout rules are asserted
// against the CSS source (same approach as story 63/74), plus a render check for
// the new search icon.
import fs from "fs";
import path from "path";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

import RepoPickerModal from "features/documents/components/repoPicker/RepoPickerModal";
import useChatRepoStore from "stores/useChatRepoStore";

jest.mock("assets/images/x.svg", () => ({
  ReactComponent: () => <span data-testid="x" />,
}));
jest.mock("features/documents/api", () => ({
  getUnitRepositoryDocuments: jest.fn(),
  linkRepositoryDocs: jest.fn(),
}));

import { getUnitRepositoryDocuments } from "features/documents/api";

const CSS_PATH = path.join(
  __dirname,
  "..",
  "components",
  "repoPicker",
  "RepoPickerModal.css"
);

function ruleBody(css, marker) {
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

describe("story 95 — repo picker UI fix (CSS source)", () => {
  const css = () => fs.readFileSync(CSS_PATH, "utf8");

  test("repoPickerUiFix_searchIsPillWithTint", () => {
    const body = ruleBody(css(), ".rp-search");
    // Pill shape + light brand-tint background (Figma search bar).
    expect(body).toMatch(/border-radius\s*:\s*999px/);
    expect(body).toMatch(/background\s*:\s*var\(--bg-brand-subtle/);
  });

  test("repoPickerUiFix_searchInputIs16px", () => {
    const body = ruleBody(css(), ".rp-search input");
    expect(body).toMatch(/font-size\s*:\s*16px/);
  });

  test("repoPickerUiFix_columnsAreBorderedCards", () => {
    const body = ruleBody(css(), ".rp-col {");
    expect(body).toMatch(/border\s*:/);
    expect(body).toMatch(/border-radius\s*:/);
  });

  test("repoPickerUiFix_rowIs16px", () => {
    const body = ruleBody(css(), ".rp-row {");
    expect(body).toMatch(/font-size\s*:\s*16px/);
  });

  test("repoPickerUiFix_titleOverrideRemoved", () => {
    // The 18px override is gone so the title inherits the global 24px .modal-title.
    expect(css()).not.toMatch(/\.rp-header\s+\.modal-title[^}]*font-size\s*:\s*18px/);
  });

  test("repoPickerUiFix_keepsBrandAccentCheckbox", () => {
    // Story 74 stays: checkbox tick uses the brand teal.
    const body = ruleBody(css(), '.rp-row input[type="checkbox"]');
    expect(body).toMatch(/accent-color\s*:\s*var\(--brand-primary/);
  });

  test("repoTitleDivider_headerHasNoBottomBorder", () => {
    // Story 97: Figma 841:48818 has no divider under the title — the header
    // flows straight into the search box. Drop the .rp-header border-bottom.
    const body = ruleBody(css(), ".rp-header {");
    expect(body).not.toMatch(/border-bottom/);
  });
});

describe("story 95 — repo picker UI fix (render)", () => {
  beforeEach(() => {
    getUnitRepositoryDocuments.mockReset().mockResolvedValue({
      groups: [{ id: 1, name: "Kế hoạch" }],
      documents: [{ id: "f1", name: "doc2.pdf", group_id: null }],
    });
    useChatRepoStore.setState({
      groups: [],
      documents: [],
      openFolderId: null,
      selectedIds: [],
      loading: false,
      error: null,
      importing: false,
    });
  });

  test("repoPickerUiFix_searchHasMagnifierIcon", async () => {
    const { container } = render(
      <RepoPickerModal open unitName="Phòng A" userId="u1" conversationId="c1" onClose={() => {}} />
    );
    await waitFor(() => screen.getByText("doc2.pdf"));
    expect(container.querySelector(".rp-search .rp-search-icon")).toBeTruthy();
  });
});
