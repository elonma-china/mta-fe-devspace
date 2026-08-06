// src/features/admin/pages/AuditLogs.js
import React, { useEffect, useState } from "react";
import "./AuditLogs.css";
import "./UserManagement.css";
import { getAuditLogs, getAuditLogFields } from "../api/admin";
import { SearchBar } from "components";
import { DataTable } from "components/common";

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [fields, setFields] = useState({ action: [], entityType: [] });

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(15);
  const [total, setTotal] = useState(0);

  const [searchQuery, setSearchQuery] = useState("");

  const [filters, setFilters] = useState({
    action: "",
    entityType: "",
    startDate: "",
    endDate: "",
    userName: "",
    ip: "",
    entityId: "",
    cid: ""
  });

  async function loadFields() {
    try {
      const data = await getAuditLogFields();
      const actionField = data.find(f => typeof f === 'object' && f.action);
      const entityField = data.find(f => typeof f === 'object' && f.entity_type);
      setFields({
        action: actionField ? actionField.action : [],
        entityType: entityField ? entityField.entity_type : []
      });
    } catch (e) {
      console.error("Failed to load audit fields", e);
    }
  }

  async function loadLogs() {
    setLoading(true);
    setError(null);
    try {
      const params = { page, limit };
      if (filters.action) params.action = filters.action;
      if (filters.entityType) params.entityType = filters.entityType;
      if (filters.startDate) params.startDate = new Date(filters.startDate).toISOString();
      if (filters.endDate) params.endDate = new Date(filters.endDate).toISOString();
      if (filters.userName) params.userName = filters.userName;
      if (filters.ip) params.ip = filters.ip;
      if (filters.entityId) params.entityId = filters.entityId;
      if (filters.cid) params.conversationId = filters.cid;

      if (searchQuery) {
        // Keeping searchQuery as a general broad filter if needed
        params.search = searchQuery;
      }

      const res = await getAuditLogs(params);
      setLogs(res.data || []);
      setTotal(res.pagination?.total || 0);
    } catch (e) {
      setError(e.message || "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFields();
  }, []);

  useEffect(() => {
    loadLogs();
  }, [page, limit, filters, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const pageList = React.useMemo(() => {
    const keep = new Set([1, 2, 3, totalPages, totalPages - 1, totalPages - 2, page, page - 1, page + 1]);
    const arr = [...keep].filter(n => n >= 1 && n <= totalPages).sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      out.push(arr[i]);
      if (i < arr.length - 1 && arr[i + 1] !== arr[i] + 1) out.push("…");
    }
    return out;
  }, [page, totalPages]);

  const formatId = (id) => id ? (String(id).length > 8 ? `${String(id).slice(0, 8)}...` : String(id)) : "-";
  const formatAgent = (ag) => ag ? (String(ag).length > 80 ? String(ag).slice(0, 80) + "..." : String(ag)) : "";

  const columns = [
    { label: "Thời gian", width: "10vw", render: (L) => new Date(L.timestamp).toLocaleString("vi-VN") },
    {
      label: "Người dùng", width: "12vw", wordBreak: "break-all", render: (L) => (
        <div title={`ID: ${L.user_id}${L.user_username ? ` | Username: ${L.user_username}` : ''}`}>
          <strong>{L.user_name || "Hệ thống"}</strong>
          <br />
          <small>{formatId(L.user_id)}</small>
        </div>
      )
    },
    { label: "Hành động", width: "12vw", render: (L) => <span className="badge-action">{L.action}</span> },
    { label: "Loại", width: "8vw", key: "entity_type" },
    { label: "Thực thể", width: "10vw", wordBreak: "break-all", render: (L) => <span title={L.entity_id}>{formatId(L.entity_id)}</span> },
    { label: "Conversation", width: "10vw", wordBreak: "break-all", render: (L) => <span title={L.conversation_id}>{formatId(L.conversation_id)}</span> },
    {
      label: "IP / Trình duyệt", width: "auto", render: (L) => (
        <div className="ip-agent" title={`IP: ${L.ip_address} | Agent: ${L.user_agent}`}>
          {L.ip_address}<br /><small>{formatAgent(L.user_agent)}</small>
        </div>
      )
    }
  ];

  const handleFilterChange = (name, value) => {
    setFilters(prev => ({ ...prev, [name]: value }));
    setPage(1);
  };

  return (
    <div className="user-mgmt audit-mgmt">
      {/* Story 123: screen title inside the panel, above the toolbar divider. */}
      <h2 className="audit-title">Nhật ký hệ thống</h2>
      <div className="toolbar audit-toolbar">
        <div className="audit-search-row">
          <input
            className="audit-filter-input"
            placeholder="Tên người dùng..."
            value={filters.userName}
            onChange={(e) => handleFilterChange("userName", e.target.value)}
          />
          <input
            className="audit-filter-input"
            placeholder="IP Address..."
            value={filters.ip}
            onChange={(e) => handleFilterChange("ip", e.target.value)}
          />
          <input
            className="audit-filter-input"
            placeholder="Entity ID..."
            value={filters.entityId}
            onChange={(e) => handleFilterChange("entityId", e.target.value)}
          />
          <input
            className="audit-filter-input"
            placeholder="Conversation ID..."
            value={filters.cid}
            onChange={(e) => handleFilterChange("cid", e.target.value)}
          />
        </div>
        <div className="audit-filter-group">
          <select
            value={filters.action}
            onChange={e => handleFilterChange("action", e.target.value)}
            className="audit-filter-select"
          >
            <option value="">Tất cả Hành động</option>
            {fields.action.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select
            value={filters.entityType}
            onChange={e => handleFilterChange("entityType", e.target.value)}
            className="audit-filter-select"
          >
            <option value="">Tất cả Nguồn</option>
            {fields.entityType.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
          <div className="date-range">
            <input
              type="date"
              value={filters.startDate}
              onChange={e => handleFilterChange("startDate", e.target.value)}
              className="audit-filter-date"
              title="Từ ngày"
            />
            <span>-</span>
            <input
              type="date"
              value={filters.endDate}
              onChange={e => handleFilterChange("endDate", e.target.value)}
              className="audit-filter-date"
              title="Đến ngày"
            />
          </div>
          <button
            className="btn-reset"
            onClick={() => {
              setFilters({
                action: "", entityType: "", startDate: "", endDate: "",
                userName: "", ip: "", entityId: "", cid: ""
              });
              setSearchQuery("");
              setPage(1);
            }}
          >
            Làm mới
          </button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={logs}
        loading={loading}
        error={error}
        emptyMessage="Không có dữ liệu tìm thấy."
        page={page}
        limit={limit}
        totalCount={total}
        onPageChange={setPage}
        totalTextFormat={(t) => `Tìm thấy ${t.toLocaleString("vi-VN")} bản ghi`}
      />
    </div>
  );
}
