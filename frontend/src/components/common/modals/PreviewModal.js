// src/components/common/modals/PreviewModal.js
import React, { useState, useEffect, useRef, useCallback } from "react";
import { ReactComponent as X } from "assets/images/x.svg";
import { previewDocument } from "features/documents/api";
import "./PreviewModal.css";
import "./share.css";

export default function PreviewModal({
  open,
  onClose,
  documentId,
  documentName,
  userId,
  conversationId,
}) {
  const backdropRef = useRef(null);
  const dialogRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

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

  useEffect(() => {
    if (!open || !documentId || !userId || !conversationId) return;

    let active = true;
    setLoading(true);
    setError(null);
    setData(null);

    previewDocument(userId, conversationId, documentId)
      .then((res) => {
        if (active) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err.message || "Không thể tải bản xem trước tài liệu.");
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [open, documentId, userId, conversationId]);

  if (!open) return null;

  const handleBackdropClick = (e) => {
    if (e.target === backdropRef.current) onClose?.();
  };

  const displayName = data?.name || documentName;

  return (
    <div className="modal-backdrop" ref={backdropRef} onMouseDown={handleBackdropClick}>
      <section 
        className="modal-shell preview-modal-shell" 
        role="dialog" 
        ref={dialogRef} 
        tabIndex={-1}
      >
        <div className="preview-modal-header">
          <h2 className="modal-title" title={displayName}>
            Xem tài liệu: {displayName}
          </h2>
          <button
            type="button"
            className="preview-close-btn"
            onClick={onClose}
            aria-label="Đóng"
          >
            <X />
          </button>
        </div>

        <div className="preview-modal-body">
          {loading && (
            <div className="preview-loading-container">
              <span className="ds-spinner" />
              <p className="preview-loading-text">Đang phân tích tài liệu và tạo bản xem trước...</p>
            </div>
          )}

          {error && (
            <div className="preview-error-container">
              <p className="preview-error-text">{error}</p>
            </div>
          )}

          {!loading && !error && data && (
            <div className="preview-content scrollable-y">
              {/* Document metadata info */}
              <div className="preview-meta-info">
                <span className="preview-meta-label">Tổng số trang:</span>
                <span className="preview-meta-val">{data.page_count || 0} trang</span>
              </div>

              {data.summary && (
                <div className="preview-section">
                  <h3 className="preview-section-title">Tóm tắt tài liệu</h3>
                  <div className="preview-section-box">
                    <p className="preview-summary-text">{data.summary}</p>
                  </div>
                </div>
              )}

              {data.first_5_pages && data.first_5_pages.length > 0 && (
                <div className="preview-section">
                  <h3 className="preview-section-title">Xem trước nội dung (Tối đa 5 trang đầu)</h3>
                  <div className="preview-pages-list">
                    {data.first_5_pages.map((page, idx) => (
                      <div className="preview-page-item" key={idx}>
                        <div className="preview-page-header">
                          <span className="preview-page-title">Trang #{page.page_number}</span>
                        </div>
                        <pre className="preview-page-text">{page.content || "Không có nội dung văn bản."}</pre>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!data.summary && (!data.first_5_pages || data.first_5_pages.length === 0) && (
                <p className="preview-no-data">Không có nội dung tóm tắt hoặc xem trước.</p>
              )}
            </div>
          )}
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
