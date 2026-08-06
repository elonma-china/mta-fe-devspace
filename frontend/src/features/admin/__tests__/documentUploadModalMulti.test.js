// src/features/admin/__tests__/documentUploadModalMulti.test.js
//
// Story 47: the repository upload modal must accept MULTIPLE files at once —
// upload each sequentially (one doc per file), keep going if one fails, and
// close only when all succeed. (UploadFileSection already passes the full array;
// the modal previously truncated to files[0].)
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import DocumentUploadModal from "features/admin/components/DocumentUploadModal";

jest.mock("assets/images/close.svg", () => ({ ReactComponent: () => <span /> }));
jest.mock("components/common", () => ({ AlertModal: () => null }));

// Stub UploadFileSection: clicking "pick" hands the modal a 2-file array,
// exactly like the real picker does in autoUpload=false mode.
jest.mock("features/documents/components/UploadFileSection", () => ({
  __esModule: true,
  default: ({ onUpload }) => (
    <button
      type="button"
      onClick={() =>
        onUpload([new global.File(["a"], "a.pdf"), new global.File(["b"], "b.pdf")])
      }
    >
      pick
    </button>
  ),
}));

test("uploadModal_multipleFiles_uploadsEachAndCloses", async () => {
  const onUpload = jest.fn().mockResolvedValue(undefined);
  const onClose = jest.fn();
  render(<DocumentUploadModal open onUpload={onUpload} onClose={onClose} />);

  fireEvent.click(screen.getByText("pick"));

  await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(2));
  expect(onUpload.mock.calls[0][0].name).toBe("a.pdf");
  expect(onUpload.mock.calls[1][0].name).toBe("b.pdf");
  // All succeeded → the modal closes itself.
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

test("uploadModal_oneFileFails_othersStillUpload_andStaysOpen", async () => {
  // First file rejects, second resolves — the second must still upload.
  const onUpload = jest
    .fn()
    .mockRejectedValueOnce(new Error("boom"))
    .mockResolvedValueOnce(undefined);
  const onClose = jest.fn();
  render(<DocumentUploadModal open onUpload={onUpload} onClose={onClose} />);

  fireEvent.click(screen.getByText("pick"));

  await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(2));
  // A failure keeps the modal open so the admin can see which file failed.
  expect(onClose).not.toHaveBeenCalled();
});
