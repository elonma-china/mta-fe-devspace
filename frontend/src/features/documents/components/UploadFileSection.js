// src/features/documents/components/UploadFileSection.js
import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import "./UploadFileSection.css";
import { ReactComponent as UploadFileIcon } from "assets/images/upload-file.svg";
import { getEnv, READONLY_CORPUS } from "config";

/**
 * UploadFileSection
 *
 * Props:
 * - onUpload: (File[]) => (void | Promise<void>)
 *      If autoUpload = true: real upload (spinner shows)
 *      If autoUpload = false: just notify parent about selected files
 * - autoUpload?: boolean                          // default: true
 * - buttonLabel?: string                          // default: "Tải tài liệu lên"
 * - dropTitle?: string   // dropzone heading; default matches most upload screens.
 *                        // Story 112: the admin "Sửa tài liệu" modal overrides
 *                        // this to match Figma 841-48773; other consumers keep
 *                        // the default so their text is unchanged.
 * - onUploadingChange?: (bool) => void
 * - maxFiles?: number
 * - maxTotalSizeMB?: number
 * - onError?: (message: string) => void
 * - disabled?: boolean
 * - onClickAlternative?: () => void
 */
export default function UploadFileSection({
  onUpload,
  autoUpload = true,
  buttonLabel = "Tải tài liệu lên",
  dropTitle = "Kéo thả hoặc nhấn tải lên để thêm tài liệu để bắt đầu",
  onUploadingChange,
  onError,
  disabled = false,
  onClickAlternative,
}) {
  // Story 24: widened default (kept in sync with the BE upload allow-list,
  // document.py _REPO_ALLOWED_EXTENSIONS). REACT_APP_FILE_EXT overrides this at
  // runtime, so `.env`/`.env.example` must list the same set.
  const exts = getEnv(
    "REACT_APP_FILE_EXT",
    ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.md,.png,.jpg,.jpeg"
  ).split(",");
  const accepted = exts.map((s) => s.trim()).filter(Boolean);

  const fileInputRef = useRef(null);

  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const acceptAttr = useMemo(() => accepted.join(","), [accepted]);

  const resetState = useCallback(() => {
    setIsDragging(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  useEffect(() => {
    // Only report uploading state when autoUpload mode is used
    if (autoUpload) {
      onUploadingChange?.(isUploading);
    } else {
      onUploadingChange?.(false);
    }
  }, [isUploading, autoUpload, onUploadingChange]);

  function stopDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function onDragEnter(e) {
    if (disabled) return;
    stopDefaults(e);
    setIsDragging(true);
  }
  function onDragOver(e) {
    if (disabled) return;
    stopDefaults(e);
    setIsDragging(true);
  }
  function onDragLeave(e) {
    if (disabled) return;
    stopDefaults(e);
    setIsDragging(false);
  }

  async function onDrop(e) {
    if (disabled) return;
    stopDefaults(e);
    setIsDragging(false);
    const files = Array.from(e.dataTransfer?.files || []);
    await handleIncoming(files);
  }

  function handleBrowseClick() {
    if (disabled || (autoUpload && isUploading)) return;
    fileInputRef.current?.click();
  }

  function triggerAlternativeClick(e) {
    e.preventDefault();
    e.stopPropagation();
    onClickAlternative?.();
  }

  async function onFileChange(e) {
    const files = Array.from(e.target.files || []);
    await handleIncoming(files);
    e.target.value = "";
  }

  function filterByExt(files) {
    const acc = accepted.map((s) => s.toLowerCase().trim());
    return files.filter((f) => {
      const ext = "." + (f.name.split(".").pop() || "").toLowerCase();
      return acc.includes(ext);
    });
  }

  async function uploadNow(files) {
    if (!files.length || isUploading || disabled) return;
    try {
      setIsUploading(true);
      await onUpload?.(files);
    } catch (err) {
      console.error("Upload failed:", err);
      onError?.("Tải tệp thất bại. Vui lòng thử lại.");
    } finally {
      setIsUploading(false);
      resetState();
    }
  }

  async function handleIncoming(files) {
    if (!files.length || (autoUpload && isUploading) || disabled) return;

    // TODO(security): Client-side file size and count limits are removed per user request.
    // Server-side validation must be enforced in the backend (e.g., multer limits) to prevent DoS.
    const valid = filterByExt(files);
    if (!valid.length) {
      onError?.("Định dạng tệp không được hỗ trợ.");
      return;
    }

    if (autoUpload) {
      await uploadNow(valid);
    } else {
      // Manual mode: just send files to parent, no spinner
      onUpload?.(valid);
      resetState();
    }
  }

  const dzClasses = [
    "ufs-dropzone",
    isDragging ? "is-dragging" : "",
    autoUpload && isUploading ? "is-uploading" : "",
    disabled ? "is-disabled" : "",
  ]
    .join(" ")
    .trim();

  const handleRootClick = (e) => {
    if (disabled) {
      triggerAlternativeClick(e);
    } else {
      handleBrowseClick();
    }
  };

  const handleRootKeyDown = (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (disabled) {
      triggerAlternativeClick(e);
    } else {
      handleBrowseClick();
    }
  };

  const showLoadingOverlay = autoUpload && isUploading && !disabled;

  // Dev Space reads a corpus it does not own. Every upload path in the app —
  // chat, the upload modal, and both admin repository screens — renders this
  // component, so refusing here covers all of them from one place.
  //
  // This is the UX half only. The gateway's DEV_READONLY_CORPUS guard is what
  // actually protects the corpus, because a hidden button is bypassable and a
  // deleted document is not recoverable.
  if (READONLY_CORPUS) {
    return (
      <div className="ufs-dropzone is-readonly" role="note">
        <div className="ufs-drop-text">
          <div className="ufs-drop-title">Bản thử nghiệm chỉ đọc tài liệu</div>
          <div className="ufs-drop-caption">
            Dev Space không được phép tải tài liệu lên kho thật. Dùng{" "}
            <strong>“Chọn từ kho”</strong> để đưa tài liệu có sẵn vào hội thoại.
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Dropzone */}
      <div
        className={dzClasses}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={handleRootClick}
        role="button"
        tabIndex={0}
        aria-busy={showLoadingOverlay ? "true" : "false"}
        aria-disabled={disabled ? "true" : "false"}
        aria-label="Kéo thả hoặc nhấn để tải lên"
        onKeyDown={handleRootKeyDown}
      >
        {/* Loading overlay (only in autoUpload mode) */}
        {showLoadingOverlay && (
          <div className="ufs-loading-overlay" aria-hidden="true">
            <div className="ufs-spinner" />
            <div className="ufs-loading-text">Đang tải tài liệu...</div>
          </div>
        )}

        {!showLoadingOverlay && (
          <>
            <div className="ufs-drop-icon-wrap">
              <UploadFileIcon />
            </div>

            <div className="ufs-drop-text">
              <div className="ufs-drop-title">{dropTitle}</div>
              <div className="ufs-drop-caption">
                Hệ thống hỗ trợ file: {accepted.join(", ")}.
              </div>
            </div>

            <div className="ufs-outline-wrap">
              <button
                className="ufs-outline-btn"
                type="button"
                onClick={(e) => {
                  if (disabled) {
                    triggerAlternativeClick(e);
                  } else {
                    e.stopPropagation();
                    handleBrowseClick();
                  }
                }}
                disabled={autoUpload && isUploading}
              >
                <span className="ufs-outline-state">
                  <span className="ufs-outline-label">{buttonLabel}</span>
                </span>
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept={acceptAttr}
              multiple
              hidden
              onChange={onFileChange}
              disabled={disabled || (autoUpload && isUploading)}
            />
          </>
        )}
      </div>
    </>
  );
}
