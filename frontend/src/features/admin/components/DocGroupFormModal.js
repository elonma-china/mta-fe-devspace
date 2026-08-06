// src/features/admin/components/DocGroupFormModal.js
import React, { useEffect, useState } from "react";
import "./DocGroupFormModal.css";
import { ReactComponent as CloseIcon } from "assets/images/close.svg";
import { AlertModal } from "components/common";

/**
 * Create/edit a document group (nhóm tài liệu).
 *
 * Matches the Figma modals 841-48588 ("Thêm nhóm tài liệu") and 841-48600
 * ("Sửa nhóm tài liệu"): a single "Tên nhóm tài liệu" field plus a submit
 * button whose label depends on the mode ("Thêm" vs "Lưu"). A blank name is
 * blocked client-side before any network call.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {"add"|"edit"} [props.mode]
 * @param {{ id?: number, name?: string }} [props.initialValues]
 * @param {(payload: { name: string }) => (void|Promise<void>)} props.onSubmit
 * @param {() => void} props.onClose
 */
export default function DocGroupFormModal({
  open,
  mode = "add",
  initialValues,
  onSubmit,
  onClose,
}) {
  const isEdit = mode === "edit";

  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [alertState, setAlertState] = useState({
    open: false,
    title: "Lỗi",
    message: "",
  });

  const showAlert = (message, title = "Lỗi") =>
    setAlertState({ open: true, title, message });
  const closeAlert = () =>
    setAlertState({ open: false, title: "Lỗi", message: "" });

  // Reset the field whenever the modal (re)opens.
  useEffect(() => {
    if (!open) return;
    setName(initialValues?.name ?? "");
  }, [open, initialValues]);

  if (!open) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    if (loading) return;
    if (!name.trim()) {
      showAlert("Tên nhóm tài liệu không được để trống.");
      return;
    }
    try {
      const res = onSubmit?.({ name: name.trim() });
      if (res instanceof Promise) {
        setLoading(true);
        await res;
      }
    } catch (err) {
      showAlert(err?.message || "Đã xảy ra lỗi khi lưu nhóm tài liệu.");
    } finally {
      setLoading(false);
    }
  }

  function onBackdropClick(e) {
    if (e.target === e.currentTarget) onClose?.();
  }

  const submitLabel = isEdit ? "Lưu" : "Thêm";

  return (
    <div className="dgm-backdrop" onMouseDown={onBackdropClick}>
      <div
        className="dgm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dgm-title"
      >
        <button
          className="dgm-close"
          type="button"
          onClick={onClose}
          aria-label="Đóng"
        >
          <CloseIcon />
        </button>

        <form className="dgm-content" onSubmit={handleSubmit}>
          <div className="dgm-header">
            <h2 id="dgm-title" className="dgm-title">
              {isEdit ? "Sửa nhóm tài liệu" : "Thêm nhóm tài liệu"}
            </h2>
          </div>

          <label className="dgm-field">
            <span className="dgm-label">Tên nhóm tài liệu</span>
            <div className="dgm-input">
              <input
                type="text"
                placeholder="Nhập tên nhóm tài liệu"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
          </label>

          <div className="dgm-footer">
            <button className="dgm-primary" type="submit" disabled={loading}>
              {loading ? "Đang lưu..." : submitLabel}
            </button>
          </div>
        </form>
      </div>

      <AlertModal
        open={alertState.open}
        onClose={closeAlert}
        title={alertState.title}
        message={alertState.message}
      />
    </div>
  );
}
