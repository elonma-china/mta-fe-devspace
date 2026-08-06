// src/features/admin/components/DocumentUploadModal.js
import React, { useState } from "react";
import "./DocumentEditModal.css";
import { ReactComponent as CloseIcon } from "assets/images/close.svg";
import UploadFileSection from "features/documents/components/UploadFileSection";
import { AlertModal } from "components/common";

/**
 * Upload a file into the document repository (Figma 841-48754 "Thêm tài liệu").
 *
 * Reuses {@link UploadFileSection} as a file picker (``autoUpload=false``) and
 * forwards the chosen file to ``onUpload`` (the store action). Store only — no
 * AI processing is triggered.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {(file: File) => Promise<void>} props.onUpload
 * @param {() => void} props.onClose
 * @param {string} [props.targetGroupName] Story 45: when uploading from a
 *   group-scoped repository view, the name of the group the document will be
 *   assigned to (shown read-only).
 */
export default function DocumentUploadModal({
  open,
  onUpload,
  onClose,
  targetGroupName,
}) {
  const [loading, setLoading] = useState(false);
  // Story 47: per-file upload status so multiple files can be uploaded at once
  // with visible progress. [{ name, status: pending|uploading|done|error }].
  const [fileStates, setFileStates] = useState([]);
  const [alertState, setAlertState] = useState({
    open: false,
    title: "Lỗi",
    message: "",
  });

  const showAlert = (message, title = "Lỗi") =>
    setAlertState({ open: true, title, message });
  const closeAlert = () =>
    setAlertState({ open: false, title: "Lỗi", message: "" });

  if (!open) return null;

  // Story 47: upload EVERY selected file sequentially (one repository doc per
  // file). A single failure doesn't block the rest; the modal closes itself only
  // when all files succeed, otherwise it stays open so the admin can see which
  // file failed. The parent's onUpload(file) is reused per file (so the group
  // context from story 45 applies to each).
  async function handleFiles(files) {
    const list = Array.from(files || []);
    if (!list.length || loading) return;
    setLoading(true);
    setFileStates(list.map((f) => ({ name: f.name, status: "pending" })));
    const mark = (i, status) =>
      setFileStates((s) =>
        s.map((it, idx) => (idx === i ? { ...it, status } : it))
      );
    let hadError = false;
    for (let i = 0; i < list.length; i += 1) {
      mark(i, "uploading");
      try {
        await onUpload?.(list[i]);
        mark(i, "done");
      } catch (err) {
        hadError = true;
        mark(i, "error");
      }
    }
    setLoading(false);
    if (!hadError) onClose?.();
  }

  const STATUS_TEXT = {
    pending: "Chờ…",
    uploading: "Đang tải…",
    done: "Xong",
    error: "Lỗi",
  };

  function onBackdropClick(e) {
    if (e.target === e.currentTarget) onClose?.();
  }

  return (
    <div className="dem-backdrop" onMouseDown={onBackdropClick}>
      <div
        className="dem-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dum-title"
      >
        <button
          className="dem-close"
          type="button"
          onClick={onClose}
          aria-label="Đóng"
        >
          <CloseIcon />
        </button>

        <h2 id="dum-title" className="dem-title">
          Thêm tài liệu
        </h2>

        {targetGroupName && (
          <p className="dum-target-group">
            Nhóm tài liệu: <strong>{targetGroupName}</strong>
          </p>
        )}

        <UploadFileSection
          autoUpload={false}
          buttonLabel="Tải tài liệu lên"
          onUpload={handleFiles}
          onError={(m) => showAlert(m)}
          disabled={loading}
        />

        {fileStates.length > 0 && (
          <ul className="dum-file-list">
            {fileStates.map((f, i) => (
              <li key={`${f.name}-${i}`} className={`dum-file-row dum-file-${f.status}`}>
                <span className="dum-file-name" title={f.name}>{f.name}</span>
                <span className="dum-file-status">{STATUS_TEXT[f.status]}</span>
              </li>
            ))}
          </ul>
        )}
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
