// src/features/analysis/components/AudioOverviewModal.js
import React, { useCallback, useEffect, useRef, useState } from "react";
import "./AudioOverviewModal.css";
import "components/common/modals/share.css";

/** The AI service validates `language` against ^(vi|en)$. */
export const AUDIO_LANGUAGES = [
  { id: "vi", label: "Tiếng Việt" },
  { id: "en", label: "English" },
];

/** Matches the AI service's target_minutes bounds (1..30). */
export const MIN_MINUTES = 1;
export const MAX_MINUTES = 30;

/** The service's `focus` field is capped at 500 characters. */
export const MAX_FOCUS_CHARS = 500;

/** The submit payload caps document_ids; mirrors MAX_REFERENCE_DOCS. */
export const MAX_AUDIO_DOCS = 10;

/**
 * Collect the options for a podcast episode.
 *
 * `open` and `onClose` are injected by the global ModalRenderer, same as
 * TemplatePickerModal.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {number} [props.documentCount] - How many documents are selected.
 * @param {(opts: {language: string, focus: string, targetMinutes: number}) => void}
 *   props.onSubmit
 */
export default function AudioOverviewModal({
  open,
  onClose,
  documentCount = 0,
  onSubmit,
}) {
  const backdropRef = useRef(null);
  const dialogRef = useRef(null);

  const [language, setLanguage] = useState("vi");
  const [focus, setFocus] = useState("");
  // 3 minutes, not the service's 10: a Dev Space run should come back while
  // the person who started it is still watching.
  const [targetMinutes, setMinutes] = useState(3);

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

  const tooManyDocs = documentCount > MAX_AUDIO_DOCS;
  const noDocs = documentCount === 0;
  const canSubmit = !tooManyDocs && !noDocs;

  const handleBackdropClick = (e) => {
    if (e.target === backdropRef.current) onClose?.();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit?.({
      language,
      focus: focus.trim(),
      targetMinutes: Number(targetMinutes),
    });
    onClose?.();
  };

  return (
    <div
      className="modal-backdrop"
      ref={backdropRef}
      onMouseDown={handleBackdropClick}
    >
      <section
        className="ao-modal"
        role="dialog"
        aria-label="Tổng quan âm thanh"
        aria-modal="true"
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="ao-header">
          <h2 className="ao-title">Tổng quan âm thanh</h2>
          <button
            type="button"
            className="ao-close"
            aria-label="Đóng"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="ao-limit">
          <span className="ao-limit-label">Tài liệu đã chọn</span>
          <span className={`ao-limit-count ${tooManyDocs ? "is-over" : ""}`}>
            {documentCount}/{MAX_AUDIO_DOCS}
          </span>
        </div>

        <form className="ao-body" onSubmit={handleSubmit}>
          <label className="ao-field">
            <span className="ao-field-label">Ngôn ngữ</span>
            <div className="ao-langs">
              {AUDIO_LANGUAGES.map((lang) => (
                <button
                  type="button"
                  key={lang.id}
                  className={`ao-lang ${language === lang.id ? "is-active" : ""}`}
                  aria-pressed={language === lang.id}
                  onClick={() => setLanguage(lang.id)}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          </label>

          <label className="ao-field">
            <span className="ao-field-label">
              Độ dài mong muốn: <strong>{targetMinutes} phút</strong>
            </span>
            <input
              type="range"
              className="ao-range"
              min={MIN_MINUTES}
              max={MAX_MINUTES}
              value={targetMinutes}
              aria-label="Độ dài mong muốn (phút)"
              onChange={(e) => setMinutes(e.target.value)}
            />
          </label>

          <label className="ao-field">
            <span className="ao-field-label">
              Trọng tâm (tuỳ chọn)
              <span className="ao-counter">
                {focus.length}/{MAX_FOCUS_CHARS}
              </span>
            </span>
            <textarea
              className="ao-focus"
              rows={3}
              maxLength={MAX_FOCUS_CHARS}
              placeholder="Ví dụ: tập trung vào phần kết luận và kiến nghị"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
            />
          </label>

          {noDocs && (
            <p className="ao-hint is-error" role="alert">
              Chọn ít nhất 1 tài liệu để tạo tổng quan âm thanh.
            </p>
          )}
          {tooManyDocs && (
            <p className="ao-hint is-error" role="alert">
              Chỉ hỗ trợ tối đa {MAX_AUDIO_DOCS} tài liệu mỗi tập.
            </p>
          )}

          <div className="ao-actions">
            <button type="button" className="ao-btn" onClick={onClose}>
              Huỷ
            </button>
            <button
              type="submit"
              className="ao-btn is-primary"
              disabled={!canSubmit}
            >
              Tạo tập podcast
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
