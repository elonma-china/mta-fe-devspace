import React from 'react';
import { ReactComponent as ChevronLeft } from "assets/images/chevron-left.svg";
import { ReactComponent as ChevronRight } from "assets/images/chevron-right.svg";
import './DataTable.css';
import Pagination from './Pagination';

export default function DataTable({
  columns = [],
  data = [],
  loading = false,
  error = null,
  emptyMessage = "Không có dữ liệu.",
  page = 1,
  limit = 10,
  totalCount = 0,
  onPageChange = () => {},
  totalTextFormat = (total) => `Tổng cộng ${total.toLocaleString("vi-VN")} người dùng`,
  // Story 39: optional row interaction. When `onRowClick` is given, rows become
  // clickable; the row whose id === `activeRowId` is highlighted. Both default
  // off, so existing consumers (users/units/audit/groups) are unaffected.
  onRowClick = null,
  activeRowId = null,
  // Story 54: optional per-row class. `rowClassName(row)` returns an extra class
  // for that row (e.g. "dm-row--unread"). Default off → existing consumers
  // unaffected.
  rowClassName = null,
  // Story 116: optional node rendered inside the footer, right after the total
  // text (e.g. a page-size selector next to "Tổng cộng … tài liệu"). Default null
  // → existing consumers render exactly as before.
  footerExtra = null,
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  return (
    <div className="data-table-container">
      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th key={col.key || i} style={{ width: col.width }}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={columns.length} className="data-table-msg">Đang tải dữ liệu...</td></tr>
            ) : error ? (
              <tr><td colSpan={columns.length} className="data-table-msg error">{error}</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={columns.length} className="data-table-msg">{emptyMessage}</td></tr>
            ) : (
              data.map((row, rowIndex) => {
                const isActive = activeRowId != null && row.id === activeRowId;
                const extraClass = rowClassName ? rowClassName(row) : "";
                const rowClass =
                  [isActive ? "is-active-row" : "", extraClass]
                    .filter(Boolean)
                    .join(" ") || undefined;
                return (
                  <tr
                    key={row.id || rowIndex}
                    className={rowClass}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    style={onRowClick ? { cursor: "pointer" } : undefined}
                  >
                    {columns.map((col, colIndex) => (
                      <td key={col.key || colIndex} style={{ wordBreak: col.wordBreak, ...col.style }}>
                        {col.render ? col.render(row, rowIndex) : row[col.key]}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="data-table-footer">
        <div className="footer-text">{totalTextFormat(totalCount)}{footerExtra}</div>
        <Pagination page={page} limit={limit} totalCount={totalCount} onPageChange={onPageChange} />
      </div>
    </div>
  );
}
