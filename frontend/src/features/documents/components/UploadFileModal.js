// src/features/documents/components/UploadFileModal.js
import React, { useEffect, useRef, useCallback, useState } from "react";
import "./UploadFileModal.css";
import { ReactComponent as CloseIcon } from "assets/images/close.svg";
import { DOCUMENTS_STATUS } from "constants/status";
import { UploadFileSection, UploadFileList } from ".";
import { AlertModal } from "components/common";
import { getEnv } from "config";

export default function UploadFileModal({
  open,
  onClose,
  onUpload,
  title = "Thêm tài liệu",
  buttonLabel = "Tải tài liệu lên",
}) {
  const backdropRef = useRef(null);
  const dialogRef = useRef(null);

  // Files selected in this modal (NOT uploaded yet)
  const [fileItems, setFileItems] = useState([]); // {id, file, name, size}

  // Error alert modal state
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertMessage, setAlertMessage] = useState("");

  const showError = useCallback((msg) => {
    if (!msg) return;
    setAlertMessage(msg);
    setAlertOpen(true);
  }, []);

  const handleEsc = useCallback(
    (e) => {
      if (e.key === "Escape" && open) {
        handleClose();
      }
    },
    [open]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open, handleEsc]);

  useEffect(() => {
    if (open && dialogRef.current) {
      dialogRef.current.focus();
    }
  }, [open]);

  if (!open) return null;

  function handleBackdropClick(e) {
    if (e.target === backdropRef.current) {
      handleClose();
    }
  }

  function handleClose() {
    setFileItems([]);
    setAlertOpen(false);
    setAlertMessage("");
    onClose?.();
  }

  // Called by UploadFileSection when user selects/drops files
  function handleFilesSelected(newFiles) {
    if (!newFiles?.length) return;

    setFileItems((prev) => {
      const existingCount = prev.length;
      const timestamp = Date.now();
      // TODO(security): Client-side file quantity limits are removed per user request.
      // Server-side validation must be enforced in the backend.
      const mapped = newFiles.map((f, idx) => ({
        id: `${timestamp}-${existingCount + idx}`,
        file: f,
        name: f.name,
        size: f.size,
        status: DOCUMENTS_STATUS.PENDING,
        error: null,
      }));

      return [...prev, ...mapped];
    });
  }

  function handleRemoveFile(id) {
    setFileItems((prev) => prev.filter((f) => f.id !== id));
  }

  function handleContinue() {
    if (!fileItems.length) return;
    const files = fileItems.map((item) => item.file);

    // Fire-and-forget: parent (Chat) will do the async upload
    onUpload?.(files);

    // Clear local list; parent will close modal via `open={openUpload}`
    setFileItems([]);
  }

  const canContinue = fileItems.length > 0;

  return (
    <>
      <div
        className="ufm-backdrop"
        ref={backdropRef}
        onMouseDown={handleBackdropClick}
        aria-hidden={false}
      >
        <section
          className="ufm-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ufm-title"
          tabIndex={-1}
          ref={dialogRef}
        >
          {/* Close button */}
          <button
            className="ufm-close-btn"
            type="button"
            aria-label="Đóng"
            onClick={handleClose}
          >
            <span className="ufm-close-btn-container">
              <CloseIcon />
            </span>
          </button>

          {/* Header */}
          <div className="ufm-header">
            <h2 id="ufm-title" className="ufm-title">
              {title}
            </h2>
          </div>

          <UploadFileSection
            autoUpload={false}
            onUpload={handleFilesSelected} // just add to list
            buttonLabel={buttonLabel}
            onError={showError}
          />

          <UploadFileList files={fileItems} onRemove={handleRemoveFile} />

          <div className="ufm-actions">
            {/* Outline button */}
            <button
              type="button"
              className="ufm-btn ufm-btn-outline"
              onClick={handleClose}
            >
              <span className="ufm-btn-content ufm-btn-content-outline">
                <span className="ufm-btn-state">
                  <span className="ufm-btn-icon" aria-hidden="true" />
                  <span className="ufm-btn-label">Huỷ</span>
                </span>
              </span>
            </button>

            {/* Filled button */}
            <button
              type="button"
              className="ufm-btn ufm-btn-primary"
              onClick={handleContinue}
              disabled={!canContinue}
            >
              <span className="ufm-btn-content ufm-btn-content-primary">
                <span className="ufm-btn-state">
                  <span className="ufm-btn-icon" aria-hidden="true" />
                  <span className="ufm-btn-label">Tiếp tục</span>
                </span>
              </span>
            </button>
          </div>
        </section>
      </div>

      {/* Error alert modal */}
      <AlertModal
        open={alertOpen}
        onClose={() => setAlertOpen(false)}
        title="Thông báo"
        message={alertMessage}
      />
    </>
  );
}
