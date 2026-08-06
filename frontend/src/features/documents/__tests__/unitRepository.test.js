// src/features/documents/__tests__/unitRepository.test.js
// Story 93: the user's READ-ONLY unit-repository screen, redesigned to match the
// design (top bar + search/filter toolbar + richer columns + pagination) and
// reuse the admin presentation. Opening a doc = row click → viewer + mark read.
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";

import UnitRepository from "features/documents/pages/UnitRepository";

const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({
  __esModule: true,
  useNavigate: () => mockNavigate,
}));

jest.mock("components", () => ({
  __esModule: true,
  SearchBar: (p) => <input aria-label="search" {...p} />,
}));

const mockMsdProps = [];
jest.mock("components/common", () => ({
  __esModule: true,
  // Render each column (label node + render()) + forward row click / class.
  // Story 116: also render `footerExtra` (the page-size selector moved into the
  // footer) in a slot OUTSIDE .unit-repo__toolbar so tests can assert placement.
  DataTable: ({ columns, data, onRowClick, rowClassName, footerExtra }) => (
    <div>
      <table>
        <thead>
          <tr>{columns.map((c, i) => <th key={i}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={row.id || i}
              className={rowClassName ? rowClassName(row) : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((c, ci) => (
                <td key={ci}>{c.render ? c.render(row, i) : row[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mock-dt-footer">{footerExtra}</div>
    </div>
  ),
  MultiSelectDropdown: (p) => {
    mockMsdProps.push(p);
    return <div data-testid="msd" data-placeholder={p.placeholder} />;
  },
}));

jest.mock("assets/images/chevron-left.svg", () => ({
  ReactComponent: () => null,
}));

jest.mock("features/documents/components/viewer/DocumentViewer", () => ({
  __esModule: true,
  default: () => <div data-testid="doc-viewer" />,
}));
jest.mock("features/documents/api", () => ({
  __esModule: true,
  getUnitRepositoryDocumentPages: jest.fn(),
  fetchUnitRepositoryDocumentFile: jest.fn(),
  fetchUnitRepositoryPageImage: jest.fn(),
}));

jest.mock("stores/useAuthStore", () => ({
  __esModule: true,
  default: (sel) => sel({ user: { unit_name: "Đơn vị 5" } }),
}));

const markRead = jest.fn();
const fetchDocuments = jest.fn();
let mockState;
jest.mock("stores/useUnitRepoStore", () => ({
  __esModule: true,
  useUnitRepoStore: () => mockState,
}));

beforeEach(() => {
  markRead.mockReset();
  fetchDocuments.mockReset();
  mockNavigate.mockReset();
  mockMsdProps.length = 0;
  mockState = {
    documents: [
      {
        id: "d1", name: "Moi.pdf", group_id: 1, created_at: "2026-06-01",
        is_unread: true, summary: "Bao cao tai chinh", doc_number: "DM-11",
        status: "COMPLETED",
      },
      {
        id: "d2", name: "Cu.pdf", group_id: null, created_at: "2026-05-01",
        is_unread: false, summary: "Chinh sach nhan su", doc_number: "LS-07",
        status: "ERROR",
      },
    ],
    groups: [{ id: 1, name: "Nhóm A" }],
    loading: false,
    error: null,
    fetchDocuments,
    markRead,
  };
});

const msd = (placeholder) =>
  mockMsdProps.find((p) => p.placeholder === placeholder);

test("unitRepository_topBar_titleWithUnitName_andBack", () => {
  // Story 116 #6: the title no longer prepends a literal "đơn vị" (the unit name
  // already carries it) → "Kho tài liệu - Đơn vị 5", not "... - đơn vị Đơn vị 5".
  render(<UnitRepository />);
  expect(screen.getByText("Kho tài liệu - Đơn vị 5")).toBeInTheDocument();
  expect(screen.queryByText(/đơn vị Đơn vị 5/)).toBeNull();
  fireEvent.click(screen.getByText(/Về Sổ ghi chú/));
  expect(mockNavigate).toHaveBeenCalledWith("/chat");
});

test("unitRepository_dateColumn_hasCorrectLabel", () => {
  // Story 116 #7: the upload-date column reads "Ngày tải tài liệu lên".
  render(<UnitRepository />);
  expect(screen.getByText(/Ngày tải tài liệu lên/)).toBeInTheDocument();
});

test("unitRepository_pageSize_inFooterNotToolbar", () => {
  // Story 116 #1: the page-size selector moved out of the toolbar into the table
  // footer (next to "Tổng cộng …") via DataTable's footerExtra slot.
  render(<UnitRepository />);
  const select = screen.getByLabelText("Số tài liệu mỗi trang");
  expect(select).toBeInTheDocument();
  // No longer inside the toolbar.
  expect(select.closest(".unit-repo__toolbar")).toBeNull();
});

test("unitRepository_rendersRichColumns_summaryAndDocNumber", () => {
  render(<UnitRepository />);
  expect(screen.getByText("Bao cao tai chinh")).toBeInTheDocument(); // Trích yếu
  expect(screen.getByText("DM-11")).toBeInTheDocument(); // Số văn bản
  expect(screen.getByText("Nhóm A")).toBeInTheDocument(); // Nhóm
});

test("unitRepository_readOnly_noWriteActions", () => {
  render(<UnitRepository />);
  expect(screen.queryByText(/Upload/i)).toBeNull();
  expect(screen.queryByText(/Số hoá lại/i)).toBeNull();
  expect(screen.queryByTitle("Sửa")).toBeNull();
  expect(screen.queryByTitle("Xoá")).toBeNull();
});

test("unitRepository_fetchesOnMount", () => {
  render(<UnitRepository />);
  expect(fetchDocuments).toHaveBeenCalled();
});

test("unitRepository_unreadRow_getsHighlightClass", () => {
  render(<UnitRepository />);
  const rows = screen.getAllByRole("row");
  // rows[0] = header; rows[1] = d1 (unread, newest first by date desc).
  expect(rows[1].className).toContain("unit-repo__row--unread");
});

test("unitRepository_rowClick_marksReadAndShowsViewer", () => {
  render(<UnitRepository />);
  expect(screen.queryByTestId("doc-viewer")).toBeNull();
  // Click the first data row (d1).
  fireEvent.click(screen.getByText("Moi.pdf").closest("tr"));
  expect(markRead).toHaveBeenCalledWith("d1");
  expect(screen.getByTestId("doc-viewer")).toBeInTheDocument();
});

test("unitRepository_search_filtersByContent", () => {
  render(<UnitRepository />);
  expect(screen.getByText("Moi.pdf")).toBeInTheDocument();
  expect(screen.getByText("Cu.pdf")).toBeInTheDocument();
  // Search matches d1's summary only.
  fireEvent.change(screen.getByLabelText("search"), {
    target: { value: "Bao cao" },
  });
  expect(screen.getByText("Moi.pdf")).toBeInTheDocument();
  expect(screen.queryByText("Cu.pdf")).toBeNull();
});

test("unitRepository_statusFilter_filtersRows", () => {
  render(<UnitRepository />);
  const status = msd("Trạng thái");
  expect(status).toBeDefined();
  // Keep only COMPLETED → d1 stays, d2 (ERROR) goes.
  act(() => status.onChange(["COMPLETED"]));
  expect(screen.getByText("Moi.pdf")).toBeInTheDocument();
  expect(screen.queryByText("Cu.pdf")).toBeNull();
});
