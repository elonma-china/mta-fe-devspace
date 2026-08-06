// src/features/analysis/components/TemplatePickerModal.js
import React, { useEffect, useRef, useCallback } from "react";
import "./TemplatePickerModal.css";
import "components/common/modals/share.css";
import { ReactComponent as ReportIcon } from "assets/images/report.svg";

/**
 * The draft/report templates exposed by mta-ai-intramind. There is no
 * template-list endpoint, so these mirror the AI service's templates/ dir.
 */
export const DRAFT_TEMPLATES = [
  { id: "opinion_consolidation", label: "Tổng hợp văn bản" },
  { id: "speech_draft", label: "Bài phát biểu" },
];

/**
 * TemplatePickerModal
 * Lets the user pick a report template before generation. `open` and
 * `onClose` are injected by the global ModalRenderer.
 *
 * Props:
 * - open: boolean
 * - onClose: () => void
 * - documentCount?: number   — shown in the X/max indicator (default 0)
 * - maxDocuments?: number    — default 50
 * - onPick: (templateId: string, templateLabel: string) => void
 */
export default function TemplatePickerModal({
  open,
  onClose,
  documentCount = 0,
  maxDocuments = 50,
  onPick,
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

  function handlePick(tpl) {
    onPick?.(tpl.id, tpl.label);
    onClose?.();
  }

  return (
    <div className="modal-backdrop" ref={backdropRef} onMouseDown={handleBackdropClick}>
      <section
        className="tp-modal"
        role="dialog"
        aria-label="Sinh văn bản"
        aria-modal="true"
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="tp-header">
          <h2 className="tp-title">Sinh văn bản</h2>
          <button type="button" className="tp-close" aria-label="Đóng" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="tp-limit">
          <span className="tp-limit-label">Giới hạn tài liệu</span>
          <span className="tp-limit-count">
            {documentCount}/{maxDocuments}
          </span>
        </div>

        <div className="tp-body">
          <div className="tp-section-label">Chọn loại văn bản</div>
          <div className="tp-cards">
            {DRAFT_TEMPLATES.map((tpl) => (
              <button
                type="button"
                key={tpl.id}
                className="tp-card"
                onClick={() => handlePick(tpl)}
              >
                <span className="tp-card-label">{tpl.label}</span>
                <span className="tp-card-icon">
                  <ReportIcon />
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
