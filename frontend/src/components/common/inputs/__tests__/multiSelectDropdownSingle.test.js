// src/components/common/inputs/__tests__/multiSelectDropdownSingle.test.js
//
// Story 91: MultiSelectDropdown gains an optional `single` mode so the same
// "Nhóm tài liệu" lookup design can drive the single-choice unit filter
// (none selected = all). Picking an option REPLACES the selection (and closes);
// picking the already-selected option clears it (→ []). The default (multi) mode
// is unchanged.
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import MultiSelectDropdown from "components/common/inputs/MultiSelectDropdown";

jest.mock("assets/images/chevron-down.svg", () => ({
  ReactComponent: () => null,
}));

const OPTIONS = [
  { value: 1, label: "Tổng" },
  { value: 2, label: "Đon vi 2" },
  { value: 3, label: "Don vi 3" },
];

function openPanel() {
  fireEvent.click(screen.getByRole("button"));
}

test("single_pickOption_replacesSelection_callsOnChangeWithOne", () => {
  const onChange = jest.fn();
  render(
    <MultiSelectDropdown
      single
      options={OPTIONS}
      selected={[]}
      onChange={onChange}
      placeholder="Tất cả đơn vị"
      searchable={false}
    />
  );
  openPanel();
  fireEvent.click(screen.getByText("Đon vi 2"));
  expect(onChange).toHaveBeenCalledWith([2]);
});

test("single_pickAlreadySelected_clearsToEmpty", () => {
  const onChange = jest.fn();
  render(
    <MultiSelectDropdown
      single
      options={OPTIONS}
      selected={[2]}
      onChange={onChange}
      placeholder="Tất cả đơn vị"
      searchable={false}
    />
  );
  openPanel();
  // The trigger also shows "Đon vi 2" (selected) — target the list option.
  fireEvent.click(screen.getByRole("option", { name: "Đon vi 2" }));
  expect(onChange).toHaveBeenCalledWith([]);
});

test("multi_default_unchanged_togglesAdditively", () => {
  const onChange = jest.fn();
  render(
    <MultiSelectDropdown
      options={OPTIONS}
      selected={[1]}
      onChange={onChange}
      placeholder="Nhóm"
      searchable={false}
    />
  );
  openPanel();
  fireEvent.click(screen.getByText("Don vi 3"));
  // multi mode adds to the existing selection
  expect(onChange).toHaveBeenCalledWith([1, 3]);
});
