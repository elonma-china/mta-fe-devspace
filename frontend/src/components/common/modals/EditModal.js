// src/components/common/modals/EditModal.js
import React, { useEffect, useRef, useCallback, useState } from "react";
import "./EditModal.css";
import "./share.css";

/**
 * EditModal
 *
 * Props:
 * - open: boolean
 * - onClose: () => void
 * - onConfirm: (value: string) => void
 * - title?: string                 // default: "Chỉnh sửa"
 * - label?: string                 // default: "Giá trị"
 * - placeholder?: string           // default: ""
 * - initialValue?: string          // default: ""
 * - cancelLabel?: string           // default: "Huỷ"
 * - confirmLabel?: string          // default: "Lưu"
 * - isConfirmLoading?: boolean     // optional - disable buttons while confirming
 * - maxLength?: number             // optional character limit
 */
export default function EditModal({
  open,
  onClose,
  onConfirm,
  title = "Chỉnh sửa",
  label = "Giá trị",
  placeholder = "",
  initialValue = "",
  cancelLabel = "Huỷ",
  confirmLabel = "Lưu",
  isConfirmLoading = false,
  maxLength,
}) {
  const backdropRef = useRef(null);
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const [value, setValue] = useState(initialValue);
  const [internalLoading, setInternalLoading] = useState(false);
  const loading = isConfirmLoading || internalLoading;

  // keep initialValue in sync when the modal re-opens with different data
  useEffect(() => {
    if (open) setValue(initialValue ?? "");
  }, [open, initialValue]);

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
    if (open && dialogRef.current) {
      dialogRef.current.focus();
      // slight delay ensures focus lands on the input in Safari/Firefox
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  function handleBackdropClick(e) {
    if (e.target === backdropRef.current) onClose?.();
  }

  async function handleConfirm() {
    if (loading) return;
    try {
      const res = onConfirm?.(value);
      if (res instanceof Promise) {
        setInternalLoading(true);
        await res;
      }
    } finally {
      setInternalLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleConfirm();
    }
  }

  return (
    <div className="modal-backdrop" ref={backdropRef} onMouseDown={handleBackdropClick}>
      <section className="modal-shell" role="dialog" ref={dialogRef} tabIndex={-1}>
        <h2 className="modal-title">{title}</h2>

        <div className="edit-input-group">
          <label htmlFor="eum-input" className="edit-label">{label}</label>
          <input
            id="eum-input"
            ref={inputRef}
            className="edit-input-field"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          {maxLength && (
            <span className="edit-counter">{value.length}/{maxLength}</span>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn-base btn-outline" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </button>
          <button className="btn-base btn-filled" onClick={handleConfirm} disabled={loading}>
            {loading ? "Đang lưu..." : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
