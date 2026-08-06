// src/features/documents/pages/UnitRepository.js
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ReactComponent as BackIcon } from "assets/images/chevron-left.svg";
import { SearchBar } from "components";
import { DataTable, MultiSelectDropdown } from "components/common";
// Story 82: reuse the SAME chat/admin DocumentViewer to preview a repo doc in
// place. Import the component directly (NOT via a barrel) so it renders in
// jsdom tests.
import DocumentViewer from "features/documents/components/viewer/DocumentViewer";
import ResizeHandle from "features/documents/components/viewer/ResizeHandle";
import {
  clampSplitRatio,
  DEFAULT_SPLIT_RATIO,
} from "features/documents/components/viewer/viewerUtils";
import {
  getUnitRepositoryDocumentPages,
  fetchUnitRepositoryDocumentFile,
  fetchUnitRepositoryPageImage,
} from "features/documents/api";
import { useUnitRepoStore } from "stores/useUnitRepoStore";
import useAuthStore from "stores/useAuthStore";

import "./UnitRepository.css";

// Story 93: status labels (mirrors the admin DocumentManagement screen) for the
// "Trạng thái" filter. Read-only — used only to label the filter options.
const STATUS_LABELS = {
  UPLOADED: "Chưa số hoá",
  PENDING: "Chưa số hoá",
  PROCESSING: "Đang xử lý",
  COMPLETED: "Đã số hoá",
  APPROVED: "Đã duyệt",
  ERROR: "Lỗi xử lý",
};

const PAGE_SIZES = [10, 20, 50];

function formatDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("vi-VN");
}

/**
 * UnitRepository — a regular user's READ-ONLY view of their own unit's document
 * repository. Story 93 redesigns it to match the design (Figma 1088-24989) and
 * reuse the admin "Quản lý kho tài liệu" presentation: a top bar (back +
 * unit-named title), a search/filter toolbar, the richer columns (Trích yếu / Số
 * văn bản / Nhóm / Ngày↕ / Tên), and a paginated footer. Opening a document
 * (row click) shows it in the shared DocumentViewer and marks it read. No
 * upload/edit/delete — those stay on the admin screen.
 */
export default function UnitRepository() {
  const { documents, groups, loading, error, fetchDocuments, markRead } =
    useUnitRepoStore();
  const unitName = useAuthStore((s) => s.user)?.unit_name || "";
  const navigate = useNavigate();

  // Search / filter / sort / pagination (client-side — a unit repo is small).
  const [search, setSearch] = useState("");
  const [groupIds, setGroupIds] = useState([]);
  const [statusFilter, setStatusFilter] = useState([]);
  const [sortDir, setSortDir] = useState("desc"); // by upload date
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // The document currently open in the in-place viewer ({ id, name }) or null.
  const [viewerDoc, setViewerDoc] = useState(null);
  const [splitRatio, setSplitRatio] = useState(DEFAULT_SPLIT_RATIO);
  const splitRef = useRef(null);
  const getSplitRect = React.useCallback(
    () => splitRef.current?.getBoundingClientRect(),
    []
  );

  useEffect(() => {
    fetchDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Any filter/sort/page-size change resets to the first page.
  useEffect(() => {
    setPage(1);
  }, [search, groupIds, statusFilter, sortDir, pageSize]);

  const viewerLoaders = useMemo(
    () =>
      viewerDoc
        ? {
            pages: () => getUnitRepositoryDocumentPages(viewerDoc.id),
            file: () => fetchUnitRepositoryDocumentFile(viewerDoc.id),
            pageImage: (pageNo) =>
              fetchUnitRepositoryPageImage(viewerDoc.id, pageNo),
          }
        : null,
    [viewerDoc]
  );

  const groupNameById = useMemo(() => {
    const map = {};
    groups.forEach((g) => {
      map[g.id] = g.name;
    });
    return map;
  }, [groups]);

  const groupOptions = useMemo(
    () => groups.map((g) => ({ value: g.id, label: g.name })),
    [groups]
  );

  // Status filter options = the distinct statuses actually present (labelled).
  const statusOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    documents.forEach((d) => {
      const s = d.status ? String(d.status).toUpperCase() : null;
      if (s && !seen.has(s)) {
        seen.add(s);
        out.push({ value: s, label: STATUS_LABELS[s] || s });
      }
    });
    return out;
  }, [documents]);

  // Filter → sort → paginate, all client-side.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const groupSet = new Set(groupIds);
    const statusSet = new Set(statusFilter);
    return documents.filter((d) => {
      if (q) {
        const hay = `${d.name || ""} ${d.summary || ""} ${d.doc_number || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (groupSet.size && !groupSet.has(d.group_id)) return false;
      if (
        statusSet.size &&
        !statusSet.has(String(d.status || "").toUpperCase())
      )
        return false;
      return true;
    });
  }, [documents, search, groupIds, statusFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return sortDir === "asc" ? ta - tb : tb - ta;
    });
    return arr;
  }, [filtered, sortDir]);

  const total = sorted.length;
  const pageDocs = useMemo(
    () => sorted.slice((page - 1) * pageSize, page * pageSize),
    [sorted, page, pageSize]
  );

  // Opening a document marks it read for THIS user (clears the unread highlight +
  // decrements the header badge optimistically), then shows it in the viewer.
  const openViewer = (d) => {
    setViewerDoc({ id: d.id, name: d.name });
    markRead(d.id);
  };

  const toggleSort = () => setSortDir((s) => (s === "asc" ? "desc" : "asc"));

  const columns = [
    {
      label: "Trích yếu",
      render: (d) => d.summary || "-",
      width: "calc(100% * 28 / 100)",
      wordBreak: "break-word",
    },
    {
      label: "Số văn bản",
      render: (d) => d.doc_number || "-",
      width: "calc(100% * 14 / 100)",
    },
    {
      label: "Nhóm tài liệu",
      render: (d) => (d.group_id ? groupNameById[d.group_id] || "-" : "-"),
      width: "calc(100% * 18 / 100)",
      wordBreak: "break-word",
    },
    {
      label: (
        <button type="button" className="unit-repo__sort" onClick={toggleSort}>
          Ngày tải tài liệu lên {sortDir === "asc" ? "↑" : "↓"}
        </button>
      ),
      render: (d) => formatDate(d.created_at),
      width: "calc(100% * 16 / 100)",
    },
    {
      label: "Tên văn bản",
      render: (d) => d.name || "-",
      width: "calc(100% * 24 / 100)",
      wordBreak: "break-all",
    },
  ];

  // Story 116 #1: the page-size selector lives next to the "Tổng cộng …" total
  // in the table footer (via DataTable's footerExtra slot), not in the toolbar.
  const pageSizeControl = (
    <label className="unit-repo__pagesize">
      <select
        aria-label="Số tài liệu mỗi trang"
        value={pageSize}
        onChange={(e) => setPageSize(Number(e.target.value))}
      >
        {PAGE_SIZES.map((n) => (
          <option key={n} value={n}>
            {n} tài liệu/trang
          </option>
        ))}
      </select>
    </label>
  );

  const list = (
    <DataTable
      columns={columns}
      data={pageDocs}
      loading={loading}
      error={error}
      emptyMessage="Chưa có tài liệu nào."
      page={page}
      limit={pageSize}
      totalCount={total}
      onPageChange={setPage}
      totalTextFormat={(t) => `Tổng cộng ${t.toLocaleString("vi-VN")} tài liệu`}
      footerExtra={pageSizeControl}
      onRowClick={(row) => openViewer(row)}
      activeRowId={viewerDoc?.id ?? null}
      rowClassName={(row) => (row.is_unread ? "unit-repo__row--unread" : "")}
    />
  );

  return (
    <div className="unit-repo">
      <div className="unit-repo__topbar">
        <button
          type="button"
          className="unit-repo__back"
          onClick={() => navigate("/chat")}
        >
          <BackIcon /> Về Sổ ghi chú
        </button>
        <h1 className="unit-repo__title">
          Kho tài liệu - {unitName}
        </h1>
      </div>

      <div className="unit-repo__card">
        <div className="unit-repo__toolbar">
          <SearchBar
            placeholder="Tìm kiếm trong tất cả nội dung"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            showMenuIcon
          />
          <MultiSelectDropdown
            options={groupOptions}
            selected={groupIds}
            onChange={setGroupIds}
            placeholder="Nhóm tài liệu"
            searchPlaceholder="Tìm nhóm tài liệu"
            emptyMessage="Chưa có nhóm tài liệu nào."
          />
          <MultiSelectDropdown
            options={statusOptions}
            selected={statusFilter}
            onChange={setStatusFilter}
            placeholder="Trạng thái"
            searchable={false}
            emptyMessage="Chưa có trạng thái."
          />
        </div>

        {!viewerDoc ? (
          list
        ) : (
          <div className="unit-repo__split" ref={splitRef}>
            <div className="unit-repo__list">{list}</div>
            <ResizeHandle
              onResize={(r) => setSplitRatio(clampSplitRatio(1 - r))}
              getContainerRect={getSplitRect}
            />
            <div
              className="unit-repo__viewer"
              style={{ flex: `0 0 ${(splitRatio * 100).toFixed(2)}%` }}
            >
              <DocumentViewer
                documentId={viewerDoc.id}
                documentName={viewerDoc.name}
                loaders={viewerLoaders}
                onClose={() => setViewerDoc(null)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
