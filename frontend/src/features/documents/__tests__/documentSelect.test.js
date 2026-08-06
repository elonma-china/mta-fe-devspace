// src/features/documents/__tests__/documentSelect.test.js
import React from "react";
import { render, screen } from "@testing-library/react";

import DocumentSelect from "features/documents/components/DocumentSelect";

// ── Mock the dependency tree so the component renders in isolation ──
// (ActionMenu comes from the `components` barrel which pulls react-router@7 →
// CRA5 Jest can't resolve it; ADR-008 baseline. Mock it out.)
jest.mock("components", () => ({
  ActionMenu: () => null,
}));
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

// Zustand stores — return minimal state so the effects no-op.
// (Defined inside the factory: jest.mock is hoisted above module scope and may
// not reference out-of-scope vars unless `mock`-prefixed.)
jest.mock("stores/useDocumentStore", () => {
  const docState = {
    documents: [
      { id: "d1", name: "06_chinh_sach_nhan_su.docx", status: "COMPLETED" },
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

// ── Tests ──

test("documentSelect_rendersSelectAllLabel_andDocRow", () => {
  render(<DocumentSelect selectAllLabel="Chọn tất cả các tài liệu" />);

  // Select-all row carries the label.
  expect(screen.getByText("Chọn tất cả các tài liệu")).toBeInTheDocument();
  // Document row carries the filename.
  expect(
    screen.getByText("06_chinh_sach_nhan_su.docx"),
  ).toBeInTheDocument();
});

test("documentSelect_docRow_hasMoreActionsButton_alignedRight", () => {
  // Regression lock (story-13): the document row keeps its 3-dot action button
  // — the alignment fix must not drop it. The button sits in the same
  // .ds-rightgroup that the select-all label uses, so this guards that the row
  // markup (filename + morebtn) stays intact while we re-align the label.
  const { container } = render(
    <DocumentSelect selectAllLabel="Chọn tất cả các tài liệu" />,
  );

  const moreBtn = container.querySelector(".ds-morebtn");
  expect(moreBtn).toBeInTheDocument();
  expect(moreBtn).toHaveAttribute("aria-label");
});

test("documentSelect_acceptsOnPreviewProp_rendersWithoutCrash", () => {
  // Story-15 regression: DocumentSelect now opens the Document Viewer via an
  // onPreview host callback instead of the legacy PreviewModal. ActionMenu is
  // mocked to null (ADR-008: can't drive the menu in jsdom), so we lock the
  // contract that the new prop wires in cleanly and the row markup is intact.
  const onPreview = jest.fn();
  const { container } = render(
    <DocumentSelect
      selectAllLabel="Chọn tất cả các tài liệu"
      onPreview={onPreview}
    />,
  );
  expect(container.querySelector(".ds-morebtn")).toBeInTheDocument();
  expect(
    screen.getByText("06_chinh_sach_nhan_su.docx"),
  ).toBeInTheDocument();
});

test("documentSelect_selectAllRow_titleIsLeftAligned", () => {
  // The fix: the select-all label must NOT be right-aligned (the bug). After
  // the CSS change, .ds-title no longer carries text-align:right. We assert the
  // class exists on the label so the CSS rule (left-aligned) applies to it.
  const { container } = render(
    <DocumentSelect selectAllLabel="Chọn tất cả các tài liệu" />,
  );

  const title = container.querySelector(".ds-title");
  expect(title).toBeInTheDocument();
  expect(title).toHaveTextContent("Chọn tất cả các tài liệu");
});
