// src/features/admin/components/UnitFocusModal.js
import React, { useEffect, useState } from "react";
import "./DocumentEditModal.css";
import "./UnitFocusModal.css";
import { ReactComponent as CloseIcon } from "assets/images/close.svg";
import { SearchBar } from "components";
import { AlertModal } from "components/common";
import { getUnits } from "features/admin/api";

/**
 * UnitFocusModal — super-admin picks which unit's document repository to view.
 *
 * A unit-less (structural super) admin has no "own" unit, so they must focus
 * one before listing/uploading. Selecting a unit calls ``onSelect(unit)``.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {number|null} props.currentUnitId   currently focused unit (if any)
 * @param {(unit:{id:number,name:string}) => void} props.onSelect
 * @param {() => void} props.onClose
 */
export default function UnitFocusModal({
  open,
  currentUnitId,
  onSelect,
  onClose,
}) {
  const [units, setUnits] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [alertState, setAlertState] = useState({ open: false, message: "" });

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    getUnits({ page: 1, page_size: 100 })
      .then((data) => {
        if (cancelled) return;
        // Tolerate both the paginated object and a bare array (defensive).
        setUnits(Array.isArray(data) ? data : data.items || []);
      })
      .catch((e) => {
        if (!cancelled)
          setAlertState({
            open: true,
            message: e?.message || "Tải danh sách đơn vị thất bại.",
          });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const q = search.trim().toLowerCase();
  const filtered = q
    ? units.filter((u) => (u.name || "").toLowerCase().includes(q))
    : units;

  function onBackdropClick(e) {
    if (e.target === e.currentTarget) onClose?.();
  }

  return (
    <div className="dem-backdrop" onMouseDown={onBackdropClick}>
      <div
        className="dem-dialog ufm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ufm-title"
      >
        <button
          className="dem-close"
          type="button"
          onClick={onClose}
          aria-label="Đóng"
        >
          <CloseIcon />
        </button>

        <h2 id="ufm-title" className="dem-title">
          Chọn đơn vị
        </h2>

        <SearchBar
          placeholder="Tìm đơn vị"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <ul className="ufm-list">
          {loading ? (
            <li className="ufm-empty">Đang tải...</li>
          ) : filtered.length === 0 ? (
            <li className="ufm-empty">Không có đơn vị nào.</li>
          ) : (
            filtered.map((u) => (
              <li
                key={u.id}
                className={`ufm-item${u.id === currentUnitId ? " ufm-item--active" : ""}`}
                onClick={() => onSelect?.({ id: u.id, name: u.name })}
              >
                {u.name}
              </li>
            ))
          )}
        </ul>
      </div>

      <AlertModal
        open={alertState.open}
        onClose={() => setAlertState({ open: false, message: "" })}
        title="Lỗi"
        message={alertState.message}
      />
    </div>
  );
}
