// src/features/admin/__tests__/unitDeleteModal.test.js
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import UnitDeleteModal from "features/admin/components/UnitDeleteModal";

// Stub the close SVG the modal renders (CRA5 @svgr mapping is incompatible
// with React 19's render — see units.test.js).
jest.mock("assets/images/close.svg", () => ({
  ReactComponent: () => null,
}));

const UNIT = { id: 3, name: "Phòng A" };
const UNITS = [
  { id: 3, name: "Phòng A" },
  { id: 5, name: "Phòng B" },
  { id: 7, name: "Phòng C" },
];

test("unitDeleteModal_open_showsDangerBadge", () => {
  // Story 104: match Figma 841-48732 — the shared danger badge (rose circle +
  // red ✕, reused from story 103) sits before the "Xoá đơn vị" title.
  render(
    <UnitDeleteModal
      open
      unit={UNIT}
      units={UNITS}
      onClose={() => {}}
      onConfirm={() => {}}
    />
  );
  expect(screen.getByTestId("modal-danger-badge")).toBeInTheDocument();
});

test("unitDeleteModal_open_rendersTitleWarningCheckboxAndButtons", () => {
  render(
    <UnitDeleteModal
      open
      unit={UNIT}
      units={UNITS}
      onClose={() => {}}
      onConfirm={() => {}}
    />
  );

  expect(screen.getByText("Xoá đơn vị")).toBeInTheDocument();
  expect(screen.getByText(/tất cả dữ liệu sẽ bị xóa/i)).toBeInTheDocument();
  expect(
    screen.getByLabelText(/chuyển toàn bộ dữ liệu sang đơn vị khác/i)
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /huỷ/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /đồng ý/i })).toBeInTheDocument();
});

test("unitDeleteModal_checkboxOff_hidesTargetAndConfirmsWithoutTransfer", async () => {
  const onConfirm = jest.fn().mockResolvedValue(undefined);
  render(
    <UnitDeleteModal
      open
      unit={UNIT}
      units={UNITS}
      onClose={() => {}}
      onConfirm={onConfirm}
    />
  );

  // Target dropdown hidden while the checkbox is off.
  expect(screen.queryByLabelText(/chọn đơn vị/i)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /đồng ý/i }));
  await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(undefined));
});

test("unitDeleteModal_checkboxOn_withoutTarget_disablesConfirm", () => {
  const onConfirm = jest.fn();
  render(
    <UnitDeleteModal
      open
      unit={UNIT}
      units={UNITS}
      onClose={() => {}}
      onConfirm={onConfirm}
    />
  );

  fireEvent.click(
    screen.getByLabelText(/chuyển toàn bộ dữ liệu sang đơn vị khác/i)
  );
  // Dropdown appears; confirm is disabled until a target is chosen.
  expect(screen.getByLabelText(/chọn đơn vị/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /đồng ý/i })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /đồng ý/i }));
  expect(onConfirm).not.toHaveBeenCalled();
});

test("unitDeleteModal_checkboxOn_withTarget_confirmsWithTargetId", async () => {
  const onConfirm = jest.fn().mockResolvedValue(undefined);
  render(
    <UnitDeleteModal
      open
      unit={UNIT}
      units={UNITS}
      onClose={() => {}}
      onConfirm={onConfirm}
    />
  );

  fireEvent.click(
    screen.getByLabelText(/chuyển toàn bộ dữ liệu sang đơn vị khác/i)
  );
  fireEvent.change(screen.getByLabelText(/chọn đơn vị/i), {
    target: { value: "5" },
  });
  fireEvent.click(screen.getByRole("button", { name: /đồng ý/i }));
  await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(5));
});

test("unitDeleteModal_targetDropdown_excludesUnitBeingDeleted", () => {
  render(
    <UnitDeleteModal
      open
      unit={UNIT}
      units={UNITS}
      onClose={() => {}}
      onConfirm={() => {}}
    />
  );

  fireEvent.click(
    screen.getByLabelText(/chuyển toàn bộ dữ liệu sang đơn vị khác/i)
  );
  // The unit being deleted ("Phòng A") must not be a transfer target.
  const optionLabels = screen
    .getAllByRole("option")
    .map((o) => o.textContent);
  expect(optionLabels).not.toContain("Phòng A");
  expect(optionLabels).toContain("Phòng B");
  expect(optionLabels).toContain("Phòng C");
});
