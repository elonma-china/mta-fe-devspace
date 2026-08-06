// src/components/common/tables/__tests__/dataTable.test.js
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import DataTable from "../DataTable";

// DataTable + Pagination import chevron SVGs; stub them for jsdom.
jest.mock("assets/images/chevron-left.svg", () => ({ ReactComponent: () => <span /> }));
jest.mock("assets/images/chevron-right.svg", () => ({ ReactComponent: () => <span /> }));

const columns = [{ key: "name", label: "Tên", render: (r) => r.name }];
const data = [
  { id: 1, name: "Alpha" },
  { id: 2, name: "Beta" },
];

test("dataTable_onRowClick_firesWithRow", () => {
  // Story 39: clickable rows (repo viewer). Clicking a row calls onRowClick(row).
  const onRowClick = jest.fn();
  render(<DataTable columns={columns} data={data} onRowClick={onRowClick} />);

  fireEvent.click(screen.getByText("Beta"));
  expect(onRowClick).toHaveBeenCalledWith(data[1]);
});

test("dataTable_activeRowId_highlightsRow", () => {
  // Story 39: the open document's row stays highlighted.
  render(<DataTable columns={columns} data={data} activeRowId={2} />);

  const activeCell = screen.getByText("Beta").closest("tr");
  expect(activeCell.classList.contains("is-active-row")).toBe(true);
  const otherRow = screen.getByText("Alpha").closest("tr");
  expect(otherRow.classList.contains("is-active-row")).toBe(false);
});

test("dataTable_noRowClick_rowsNotClickable", () => {
  // Regression: without onRowClick, rows have no click handler / cursor (existing
  // consumers — users/units/audit/groups — are unaffected).
  render(<DataTable columns={columns} data={data} />);
  const row = screen.getByText("Alpha").closest("tr");
  expect(row.style.cursor).toBe("");
});

test("dataTable_rowClassName_addsPerRowClass", () => {
  // Story 54: rowClassName(row) tags individual rows (unread highlight).
  render(
    <DataTable
      columns={columns}
      data={[
        { id: 1, name: "Alpha", is_unread: true },
        { id: 2, name: "Beta", is_unread: false },
      ]}
      rowClassName={(r) => (r.is_unread ? "dm-row--unread" : "")}
    />
  );
  expect(
    screen.getByText("Alpha").closest("tr").classList.contains("dm-row--unread")
  ).toBe(true);
  expect(
    screen.getByText("Beta").closest("tr").classList.contains("dm-row--unread")
  ).toBe(false);
});

test("dataTable_noRowClassName_unaffected", () => {
  // Regression: without rowClassName, rows carry no extra class.
  render(<DataTable columns={columns} data={data} />);
  expect(screen.getByText("Alpha").closest("tr").className).toBe("");
});

test("dataTable_footerExtra_rendersNextToTotal", () => {
  // Story 116 #1: an optional footerExtra node renders inside .footer-text,
  // right after the total (lets a consumer drop a page-size selector there).
  render(
    <DataTable
      columns={columns}
      data={data}
      footerExtra={<span data-testid="extra">extra</span>}
    />
  );
  const extra = screen.getByTestId("extra");
  expect(extra).toBeInTheDocument();
  expect(extra.closest(".footer-text")).not.toBeNull();
});

test("dataTable_noFooterExtra_absent", () => {
  // Regression: without footerExtra, nothing extra renders (existing consumers
  // — users/units/audit/groups/admin-docs — are unaffected).
  render(<DataTable columns={columns} data={data} />);
  expect(screen.queryByTestId("extra")).toBeNull();
});
