// src/components/common/modals/__tests__/deleteModal.test.js
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import DeleteModal from "../DeleteModal";

// Story 103: the shared delete/confirm modal must match Figma — a danger badge
// (rose circle + red ✕) before the title, a default confirm label of "Đồng ý",
// and an opt-out prop for non-delete warnings (lock/logout).

test("deleteModal_default_showsDangerBadgeAndDongYLabel", () => {
  render(<DeleteModal open onClose={() => {}} onConfirm={() => {}} />);

  // Default confirm label is "Đồng ý" (was "Xoá").
  expect(screen.getByRole("button", { name: /đồng ý/i })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /^xoá$/i })
  ).not.toBeInTheDocument();
  // Danger badge rendered by default.
  expect(screen.getByTestId("modal-danger-badge")).toBeInTheDocument();
});

test("deleteModal_showIconFalse_hidesDangerBadge", () => {
  render(
    <DeleteModal open showIcon={false} onClose={() => {}} onConfirm={() => {}} />
  );
  expect(screen.queryByTestId("modal-danger-badge")).not.toBeInTheDocument();
});

test("deleteModal_respectsConfirmLabelProp", () => {
  render(
    <DeleteModal
      open
      confirmLabel="Khoá"
      onClose={() => {}}
      onConfirm={() => {}}
    />
  );
  expect(screen.getByRole("button", { name: /khoá/i })).toBeInTheDocument();
});

test("deleteModal_asyncConfirm_disablesButtonsAndShowsLoadingLabel", async () => {
  let resolve;
  const onConfirm = jest.fn(
    () => new Promise((r) => {
      resolve = r;
    })
  );
  render(
    <DeleteModal
      open
      loadingLabel="Đang xoá..."
      onClose={() => {}}
      onConfirm={onConfirm}
    />
  );

  fireEvent.click(screen.getByRole("button", { name: /đồng ý/i }));

  await waitFor(() =>
    expect(screen.getByRole("button", { name: /đang xoá/i })).toBeDisabled()
  );
  expect(screen.getByRole("button", { name: /huỷ/i })).toBeDisabled();

  resolve();
});
