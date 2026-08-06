// src/features/admin/__tests__/documentEditApprove.test.js
//
// Story 48: in the edit modal, an admin can mark a COMPLETED ("Đã số hoá")
// document as "Đã duyệt" (APPROVED) — a manual review gate. The approve control
// only appears for COMPLETED docs and the choice is passed to onSubmit as a 3rd
// arg so the page can call the approve endpoint after saving metadata.
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import DocumentEditModal from "features/admin/components/DocumentEditModal";

jest.mock("assets/images/close.svg", () => ({ ReactComponent: () => <span /> }));
jest.mock("assets/images/delete.svg", () => ({ ReactComponent: () => <span /> }));
jest.mock("components/common", () => ({ AlertModal: () => null }));
jest.mock("features/documents/components/UploadFileSection", () => ({
  __esModule: true,
  default: () => <div />,
}));

const base = {
  open: true,
  groups: [],
  onClose: () => {},
};

test("editApprove_completedDoc_showsApproveAndPassesFlag", async () => {
  const onSubmit = jest.fn().mockResolvedValue(undefined);
  render(
    <DocumentEditModal
      {...base}
      initialValues={{ id: "a", name: "kho.pdf", status: "COMPLETED" }}
      onSubmit={onSubmit}
    />
  );
  const approve = screen.getByLabelText(/đánh dấu đã duyệt/i);
  expect(approve).toBeInTheDocument();
  fireEvent.click(approve);
  fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "kho.pdf" }),
      null,
      true
    )
  );
});

test("editApprove_notCompleted_noApproveControl", () => {
  render(
    <DocumentEditModal
      {...base}
      initialValues={{ id: "a", name: "kho.pdf", status: "PROCESSING" }}
      onSubmit={jest.fn()}
    />
  );
  expect(screen.queryByLabelText(/đánh dấu đã duyệt/i)).toBeNull();
});
