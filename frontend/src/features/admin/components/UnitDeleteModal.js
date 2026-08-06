// src/features/admin/components/UnitDeleteModal.js
import React, { useEffect, useState } from "react";
import "./UnitDeleteModal.css";
import DangerBadge from "components/common/modals/DangerBadge";
import { ReactComponent as CloseIcon } from "assets/images/close.svg";

/**
 * Delete a unit, optionally transferring its data to another unit first.
 *
 * Matches Figma 841-48732: a confirmation warning, an opt-in "transfer all
 * data to another unit before deleting" checkbox, and a target-unit dropdown
 * that only appears when the checkbox is on. Confirming calls ``onConfirm``
 * with the chosen target unit id, or ``undefined`` for a plain delete.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {{ id: number, name?: string }} props.unit  unit being deleted
 * @param {Array<{ id: number, name?: string }>} [props.units]  transfer targets
 * @param {(transferToUnitId: number|undefined) => (void|Promise<void>)} props.onConfirm
 * @param {() => void} props.onClose
 */
export default function UnitDeleteModal({
  open,
  unit,
  units = [],
  onConfirm,
  onClose,
}) {
  const [transferEnabled, setTransferEnabled] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [loading, setLoading] = useState(false);

  // Reset local state whenever the modal (re)opens.
  useEffect(() => {
    if (!open) return;
    setTransferEnabled(false);
    setTargetId("");
    setLoading(false);
  }, [open, unit]);

  if (!open) return null;

  const targets = units.filter((u) => u.id !== unit?.id);
  const confirmDisabled = loading || (transferEnabled && !targetId);

  function onBackdropClick(e) {
    if (e.target === e.currentTarget) onClose?.();
  }

  async function handleConfirm() {
    if (confirmDisabled) return;
    const transferTo = transferEnabled ? Number(targetId) : undefined;
    try {
      const res = onConfirm?.(transferTo);
      if (res instanceof Promise) {
        setLoading(true);
        await res;
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="udm-backdrop" onMouseDown={onBackdropClick}>
      <div
        className="udm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="udm-title"
      >
        <button
          className="udm-close"
          type="button"
          onClick={onClose}
          aria-label="Đóng"
        >
          <CloseIcon />
        </button>

        <div className="udm-header">
          <DangerBadge />
          <h2 id="udm-title" className="udm-title">
            Xoá đơn vị
          </h2>
        </div>
        <p className="udm-message">
          Bạn có chắc chắn muốn xóa đơn vị này? Hãy gán các người dùng và tài
          liệu của đơn vị này vào một đơn vị khác nếu không tất cả dữ liệu sẽ bị
          xóa cùng đơn vị.
        </p>

        <label className="udm-check">
          <input
            type="checkbox"
            checked={transferEnabled}
            onChange={(e) => {
              setTransferEnabled(e.target.checked);
              if (!e.target.checked) setTargetId("");
            }}
          />
          <span>Chuyển toàn bộ dữ liệu sang đơn vị khác trước khi xoá</span>
        </label>

        {transferEnabled && (
          <label className="udm-field">
            <span className="udm-label">Chọn đơn vị</span>
            <select
              className="udm-select"
              aria-label="Chọn đơn vị"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
            >
              <option value="">-- Chọn đơn vị --</option>
              {targets.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || `Đơn vị #${u.id}`}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="udm-actions">
          <button
            className="udm-cancel"
            type="button"
            onClick={onClose}
            disabled={loading}
          >
            Huỷ
          </button>
          <button
            className="udm-confirm"
            type="button"
            onClick={handleConfirm}
            disabled={confirmDisabled}
          >
            {loading ? "Đang xoá..." : "Đồng ý"}
          </button>
        </div>
      </div>
    </div>
  );
}
