// src/features/analysis/components/DraftUploadModal.js
import React, { useCallback, useEffect, useRef, useState } from "react";
import "./DraftUploadModal.css";
import "components/common/modals/share.css";
import { ReactComponent as ReportIcon } from "assets/images/report.svg";

// Mirrors the AI service's directive_review_max_upload_size.
const MAX_DRAFT_BYTES = 50 * 1024 * 1024;
// Mirrors the AI service's _ALLOWED_UPLOAD_EXTENSIONS (api/routes/directive_review.py).
// .pdf covers both native-text and scanned drafts — BE's liteparse processor
// OCRs image-only pages internally, so no separate "scanned" picker is needed.
const ALLOWED_EXTENSIONS = [".docx", ".pdf"];

/**
 * DraftUploadModal
 * Takes the draft resolution (.docx or .pdf, including scanned PDFs) for a
 * directive review. The draft is transient — it is never indexed into the
 * corpus, unlike the reference documents, which come from the conversation's
 * doc-panel selection.
 *
 * `open` and `onClose` are injected by the global ModalRenderer.
 *
 * Props:
 * - open: boolean
 * - onClose: () => void
 * - documentCount?: number  — reference docs selected (default 0)
 * - maxDocuments?: number   — default 10 (the AI service's cap)
 * - onPick: (file: File) => void
 */
export default function DraftUploadModal({
  open,
  onClose,
  documentCount = 0,
  maxDocuments = 10,
  onPick,
}) {
  const backdropRef = useRef(null);
  const dialogRef = useRef(null);
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");

  const handleEsc = useCallback(
    (e) => {
      if (e.key === "Escape" && open) onClose?.();
    },
    [open, onClose]
  );

  useEffect(() => {
    if (!open) return undefined;
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

  function handleFileChange(e) {
    const picked = e.target.files?.[0];
    if (!picked) return;
    const name = picked.name.toLowerCase();
    if (!ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      setFile(null);
      setError(`Chỉ hỗ trợ file ${ALLOWED_EXTENSIONS.join(", ")}`);
      return;
    }
    if (picked.size > MAX_DRAFT_BYTES) {
      setFile(null);
      setError("File vượt quá dung lượng cho phép (50 MB)");
      return;
    }
    setError("");
    setFile(picked);
  }

  function handleSubmit() {
    if (!file) return;
    onPick?.(file);
    onClose?.();
  }

  return (
    <div className="modal-backdrop" ref={backdropRef} onMouseDown={handleBackdropClick}>
      <section
        className="du-modal"
        role="dialog"
        aria-label="Rà soát dự thảo"
        aria-modal="true"
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="du-header">
          <h2 className="du-title">Rà soát dự thảo</h2>
          <button type="button" className="du-close" aria-label="Đóng" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="du-limit">
          <span className="du-limit-label">Văn bản tham chiếu</span>
          <span className="du-limit-count">
            {documentCount}/{maxDocuments}
          </span>
        </div>

        <div className="du-body">
          <div className="du-section-label">Tải lên dự thảo cần rà soát</div>

          <label className="du-drop" htmlFor="du-file">
            <span className="du-drop-icon">
              <ReportIcon />
            </span>
            <span className="du-drop-text">
              {file ? file.name : `Chọn file ${ALLOWED_EXTENSIONS.join(", ")}`}
            </span>
            <input
              id="du-file"
              type="file"
              accept={ALLOWED_EXTENSIONS.join(",")}
              aria-label="Chọn file dự thảo"
              className="du-input"
              onChange={handleFileChange}
            />
          </label>

          {error ? <div className="du-error">{error}</div> : null}

          <button
            type="button"
            className="du-submit"
            disabled={!file}
            onClick={handleSubmit}
          >
            Bắt đầu rà soát
          </button>
        </div>
      </section>
    </div>
  );
}
