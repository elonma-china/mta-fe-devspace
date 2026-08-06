// src/components/common/modals/DeleteModal.js
import React, { useEffect, useRef, useCallback, useState } from "react";
import DangerBadge from "./DangerBadge";
import "./DeleteModal.css";
import "./share.css";

/**
 * DeleteUserModal
 *
 * Props:
 * - open: boolean
 * - onClose: () => void
 * - onConfirm: () => void
 * - title?: string                             // default: "Xoá tài khoản"
 * - message?: string                           // default: "Bạn chắc chắn muốn xoá tài khoản này?"
 * - cancelLabel?: string                       // default: "Huỷ"
 * - confirmLabel?: string                      // default: "Đồng ý"
 * - showIcon?: boolean                          // default: true — danger badge (Figma). Set false for non-delete warnings (lock/logout).
 * - isConfirmLoading?: boolean                 // optional - disable buttons while confirming
 */
export default function DeleteModal({
  open,
  onClose,
  onConfirm,
  title = "Xoá tài khoản",
  message = "Bạn chắc chắn muốn xoá tài khoản này?",
  cancelLabel = "Huỷ",
  confirmLabel = "Đồng ý",
  loadingLabel = "Đang xoá...",
  showIcon = true,
  isConfirmLoading = false,
}) {
  const backdropRef = useRef(null);
  const dialogRef = useRef(null);
  const [internalLoading, setInternalLoading] = useState(false);
  const loading = isConfirmLoading || internalLoading;

  async function handleConfirm() {
    if (loading) return;
    try {
      const res = onConfirm?.();
      if (res instanceof Promise) {
        setInternalLoading(true);
        await res;
      }
    } finally {
      setInternalLoading(false);
    }
  }

  const handleEsc = useCallback(
    (e) => {
      if (e.key === "Escape" && open) onClose?.();
    },
    [open, onClose]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open, handleEsc]);

  useEffect(() => {
    if (open && dialogRef.current) dialogRef.current.focus();
  }, [open]);

  if (!open) return null;

  function handleBackdropClick(e) {
    if (e.target === backdropRef.current) onClose?.();
  }

  return (
    // Change classNames to use global utilities
    <div className="modal-backdrop" ref={backdropRef} onMouseDown={handleBackdropClick}>
      <section className="modal-shell" role="dialog" ref={dialogRef} tabIndex={-1}>
        <div className="modal-header">
          {showIcon && <DangerBadge />}
          <h2 className="modal-title">{title}</h2>
        </div>
        <p className="modal-message">{message}</p>
        <div className="modal-actions">
          <button className="btn-base btn-outline" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </button>
          <button className="btn-base btn-filled" onClick={handleConfirm} disabled={loading}>
            {loading ? loadingLabel : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
