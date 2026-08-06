// src/features/documents/__tests__/documentSelectRepo.test.js
//
// Story 19: a repository (referenced) doc must render as ready (checkbox), not
// a spinner; a self-uploaded doc that is still UPLOADED keeps its spinner.
import React from "react";
import { render, screen } from "@testing-library/react";

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
  // A repository doc (UPLOADED, from_repository) + a self-uploaded doc (UPLOADED).
  const docState = {
    documents: [
      { id: "repo1", name: "kho.docx", status: "UPLOADED", from_repository: true },
      { id: "up1", name: "tu_upload.pdf", status: "UPLOADED" },
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

function rowFor(container, name) {
  const filename = Array.from(container.querySelectorAll(".ds-filename")).find(
    (el) => el.textContent === name,
  );
  return filename?.closest(".ds-row");
}

test("documentSelect_repoDoc_showsCheckboxNotSpinner", () => {
  const { container } = render(<DocumentSelect />);
  const row = rowFor(container, "kho.docx");
  expect(row).toBeTruthy();
  // Repository doc → selectable checkbox, no spinner.
  expect(row.querySelector(".ds-checkbox")).toBeInTheDocument();
  expect(row.querySelector(".ds-spinner")).not.toBeInTheDocument();
});

test("documentSelect_uploadDoc_uploading_stillSpinner", () => {
  const { container } = render(<DocumentSelect />);
  const row = rowFor(container, "tu_upload.pdf");
  expect(row).toBeTruthy();
  // Self-uploaded doc still UPLOADED → spinner (regression: not broken).
  expect(row.querySelector(".ds-spinner")).toBeInTheDocument();
  expect(row.querySelector(".ds-checkbox")).not.toBeInTheDocument();
});
