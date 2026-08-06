// src/features/documents/__tests__/documentSelectUnitTag.test.js
//
// Story 35: a super-admin links repo docs from multiple units into one chat,
// so the left "Quản lý tài liệu" panel must show each repo doc's SOURCE UNIT.
// Only for the super-admin view; a unit user/admin sees no unit tag (story 33).
import React from "react";
import { render } from "@testing-library/react";

import DocumentSelect from "features/documents/components/DocumentSelect";

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

jest.mock("stores/useDocumentStore", () => {
  const docState = {
    documents: [
      {
        id: "r1",
        name: "kho.pdf",
        status: "COMPLETED",
        from_repository: true,
        unit_name: "Phòng Kế hoạch",
      },
      { id: "u1", name: "tu_upload.pdf", status: "COMPLETED" },
    ],
    selectedDocumentIds: [],
    setSelectedDocumentIds: jest.fn(),
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

// Mutable user so a single suite can render both the super-admin and unit views.
let mockUser = { id: "a1", is_admin: true, unit_id: null };
jest.mock("stores/useAuthStore", () => ({
  __esModule: true,
  default: () => ({ user: mockUser }),
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

test("documentSelect_superAdmin_repoDoc_showsUnitTag", () => {
  mockUser = { id: "a1", is_admin: true, unit_id: null }; // super admin
  const { container } = render(<DocumentSelect />);
  const tag = Array.from(container.querySelectorAll(".ds-unit-tag")).find(
    (el) => el.textContent === "Phòng Kế hoạch"
  );
  expect(tag).toBeTruthy();
});

test("documentSelect_nonSuper_noUnitTag", () => {
  mockUser = { id: "u9", is_admin: false, unit_id: 7 }; // unit user
  const { container } = render(<DocumentSelect />);
  expect(container.querySelector(".ds-unit-tag")).toBeNull();
});

test("documentSelect_selfUploadedDoc_noUnitTag_evenForSuperAdmin", () => {
  mockUser = { id: "a1", is_admin: true, unit_id: null };
  const { container } = render(<DocumentSelect />);
  // The self-uploaded doc row carries no unit tag (only repo docs do).
  const selfRow = Array.from(container.querySelectorAll(".ds-filename"))
    .find((el) => el.textContent === "tu_upload.pdf")
    .closest(".ds-row");
  expect(selfRow.querySelector(".ds-unit-tag")).toBeNull();
});
