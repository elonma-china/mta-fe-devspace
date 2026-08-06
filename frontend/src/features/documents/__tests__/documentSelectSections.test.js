// src/features/documents/__tests__/documentSelectSections.test.js
//
// Story 33: the chat document panel must match Figma — split into two titled
// sections, "Tài liệu của tôi" (self-uploaded) and "Kho tài liệu" (repository
// docs, from_repository), with grouped repo docs nested under an expandable
// folder labelled by the group name. Existing selection/menu/spinner behaviour
// stays untouched (covered by documentSelect*.test.js).
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import DocumentSelect from "features/documents/components/DocumentSelect";
import useDocumentStore from "stores/useDocumentStore";

jest.mock("components", () => ({ ActionMenu: () => null }));
jest.mock("components/common", () => ({
  AlertModal: () => null,
  DeleteModal: () => null,
  EditModal: () => null,
  PreviewModal: () => null,
}));
jest.mock("assets/images/more-vert.svg", () => ({
  ReactComponent: () => <span data-testid="more-icon" />,
}));
jest.mock("hooks/useTaskPoller", () => ({ useTaskPoller: () => {} }));

const mockSetSelected = jest.fn();

jest.mock("stores/useDocumentStore", () => {
  const docState = {
    documents: [
      // Mine (self-uploaded → no from_repository)
      { id: "u1", name: "Image1.jpeg", status: "COMPLETED" },
      { id: "u2", name: "Doc.pdf", status: "COMPLETED" },
      // Repo, ungrouped (flat under "Kho tài liệu")
      {
        id: "r1",
        name: "Doc3.doc",
        status: "COMPLETED",
        from_repository: true,
        group_id: null,
      },
      // Repo, grouped under "Kế hoạch"
      {
        id: "r2",
        name: "doc4.pdf",
        status: "COMPLETED",
        from_repository: true,
        group_id: 5,
        group_name: "Kế hoạch",
      },
      {
        id: "r3",
        name: "Doc5.doc",
        status: "COMPLETED",
        from_repository: true,
        group_id: 5,
        group_name: "Kế hoạch",
      },
    ],
    selectedDocumentIds: [],
    setSelectedDocumentIds: (...a) => mockSetSelected(...a),
    pollingTasks: {},
    pending: [],
    fetchDocuments: jest.fn().mockResolvedValue({}),
    updateDocumentStatus: jest.fn(),
    completePolling: jest.fn(),
    deleteDocument: jest.fn(),
    renameDocument: jest.fn(),
    connectSSE: jest.fn(),
    disconnectSSE: jest.fn(),
    sseFallback: false,
  };
  const fn = () => docState;
  fn.getState = () => docState;
  return { __esModule: true, default: fn };
});
jest.mock("stores/useAuthStore", () => ({
  __esModule: true,
  default: () => ({ user: { id: "u1" } }),
}));
jest.mock("stores/useChatStore", () => {
  const st = { selectedConvId: "c1" };
  const fn = () => st;
  fn.getState = () => st;
  return { __esModule: true, default: fn };
});
jest.mock("stores/useModalStore", () => ({
  __esModule: true,
  default: () => ({ showModal: jest.fn(), hideModal: jest.fn() }),
}));

beforeEach(() => mockSetSelected.mockClear());

function rowFor(container, name) {
  const filename = Array.from(container.querySelectorAll(".ds-filename")).find(
    (el) => el.textContent === name,
  );
  return filename?.closest(".ds-row");
}

test("documentSelect_mixedDocs_rendersTwoSections", () => {
  render(<DocumentSelect selectAllLabel="Chọn tất cả các tài liệu" />);
  expect(screen.getByText("Tài liệu của tôi")).toBeInTheDocument();
  expect(screen.getByText("Kho tài liệu")).toBeInTheDocument();
});

test("documentSelect_repoGrouped_rendersFolderWithGroupName", () => {
  render(<DocumentSelect />);
  // The folder label = group name.
  expect(screen.getByText("Kế hoạch")).toBeInTheDocument();
});

test("documentSelect_folderOpenByDefault_showsChildren", () => {
  const { container } = render(<DocumentSelect />);
  // Default open → grouped docs visible and nested.
  const child = rowFor(container, "doc4.pdf");
  expect(child).toBeTruthy();
  expect(child.classList.contains("ds-row-nested")).toBe(true);
});

test("documentSelect_folderToggle_collapsesChildren", () => {
  const { container } = render(<DocumentSelect />);
  const folderBtn = screen.getByText("Kế hoạch").closest("button");
  expect(folderBtn).toBeTruthy();
  fireEvent.click(folderBtn);
  // After collapse the grouped children disappear.
  expect(rowFor(container, "doc4.pdf")).toBeFalsy();
  // Re-expand restores them.
  fireEvent.click(folderBtn);
  expect(rowFor(container, "doc4.pdf")).toBeTruthy();
});

test("documentSelect_folderCheckbox_selectsWholeGroup", () => {
  const { container } = render(<DocumentSelect />);
  const folderRow = screen.getByText("Kế hoạch").closest(".ds-folder-row");
  expect(folderRow).toBeTruthy();
  const cb = folderRow.querySelector(".ds-checkbox");
  fireEvent.click(cb);
  // None selected → clicking selects every id in the group.
  expect(mockSetSelected).toHaveBeenCalledTimes(1);
  const arg = mockSetSelected.mock.calls[0][0];
  expect(new Set(arg)).toEqual(new Set(["r2", "r3"]));
});

test("documentSelect_repoFlat_noGroup_rendersUnderRepoSection", () => {
  const { container } = render(<DocumentSelect />);
  // Ungrouped repo doc is a flat row, not nested in a folder.
  const flat = rowFor(container, "Doc3.doc");
  expect(flat).toBeTruthy();
  expect(flat.classList.contains("ds-row-nested")).toBe(false);
});

test("documentSelect_mineDoc_rendersFlatNoFolder", () => {
  const { container } = render(<DocumentSelect />);
  const mine = rowFor(container, "Image1.jpeg");
  expect(mine).toBeTruthy();
  expect(mine.classList.contains("ds-row-nested")).toBe(false);
});

test("documentSelect_repoFolder_iconUsesCurrentColorSvg", () => {
  // The folder icon color is driven by CSS on `.ds-folder-icon` via
  // `stroke="currentColor"`. Lock the mechanism so the icon stays an SVG with
  // class `ds-folder-icon` and an inheriting `currentColor` stroke — a hardcoded
  // stroke would break the CSS color. (Story 41 set it to brand teal; story 100
  // switched it to neutral #262626 per Figma 1074-26180 — the exact hue is locked
  // separately in folderIconColor.test.js.)
  render(<DocumentSelect />);
  const folderBtn = screen.getByText("Kế hoạch").closest("button");
  const icon = folderBtn.querySelector("svg.ds-folder-icon");
  expect(icon).toBeTruthy();
  const path = icon.querySelector("path");
  expect(path).toBeTruthy();
  expect(path.getAttribute("stroke")).toBe("currentColor");
});

test("documentSelect_selectAll_selectsAcrossSections", () => {
  const { container } = render(<DocumentSelect />);
  const master = container.querySelector(".ds-checkbox");
  fireEvent.click(master);
  expect(mockSetSelected).toHaveBeenCalledTimes(1);
  const arg = mockSetSelected.mock.calls[0][0];
  // Master selects every visible doc across both sections.
  expect(new Set(arg)).toEqual(new Set(["u1", "u2", "r1", "r2", "r3"]));
});
