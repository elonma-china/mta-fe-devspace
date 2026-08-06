// src/components/common/modals/AlertModal.js
import React, { useEffect, useRef, useCallback } from "react";
import "./AlertModal.css";
import "./share.css";

/**
 * AlertModal
 *
 * Props:
 * - open: boolean
 * - onClose: () => void
 * - title?: string         // default: "Thông báo"
 * - message?: string       // default: ""
 */
export default function AlertModal({
  open,
  onClose,
  title = "Thông báo",
  message = "",
}) {
  const backdropRef = useRef(null);
  const dialogRef = useRef(null);

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
    <div className="modal-backdrop" ref={backdropRef} onMouseDown={handleBackdropClick}>
      <section className="modal-shell" role="dialog" ref={dialogRef} tabIndex={-1}>
        <h2 className="modal-title">{title}</h2>
        
        <div className="modal-content-body">
          <p className="modal-text-message">{message}</p>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-base btn-filled" onClick={onClose}>
            Đóng
          </button>
        </div>
      </section>
    </div>
  );
}
