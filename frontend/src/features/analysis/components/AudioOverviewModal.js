// src/features/analysis/components/AudioOverviewModal.js
import React, { useCallback, useEffect, useRef, useState } from "react";
import "./AudioOverviewModal.css";
import "components/common/modals/share.css";

/**
 * The only mode offered: summarise the selected documents, then read the
 * summary aloud with one voice.
 *
 * The service still supports a two-host dialogue (`mode: "podcast"`) and its
 * prompt is the one three eval rounds tuned — it is kept on the API on
 * purpose. It is simply not offered here: one clear flow beats a mode picker
 * users have to reason about, and a single reader is what was asked for.
 */
const EPISODE_MODE = "narration";

/**
 * Voices. Vietnamese only, and exactly two — those are the only offline Piper
 * voices that exist for Vietnamese, so the list is a product decision rather
 * than something to discover at runtime from GET /api/v1/voices.
 */
export const AUDIO_VOICES = [
  { id: "male", label: "Giọng nam" },
  { id: "female", label: "Giọng nữ" },
];

/** Tone presets; ids must match tools/audio_overview_utils/tone.py. */
export const AUDIO_TONES = [
  { id: "trang_trong", label: "Trang trọng" },
  { id: "tu_nhien", label: "Tự nhiên" },
  { id: "soi_noi", label: "Sôi nổi" },
  { id: "cham_rai", label: "Chậm rãi" },
];

/** Matches the AI service's target_minutes bounds (1..30). */
export const MIN_MINUTES = 1;
export const MAX_MINUTES = 30;

/** The service's `focus` field is capped at 500 characters. */
export const MAX_FOCUS_CHARS = 500;

/** The service's `instruction` field is capped at 2000 characters. */
export const MAX_INSTRUCTION_CHARS = 2000;

/**
 * Phản chiếu `AudioOverviewRequest.document_ids.max_length` phía server.
 *
 * FE không có endpoint nào để đọc cấu hình server, nên con số này buộc phải
 * nhân bản và giữ đồng bộ bằng tay. Đổi ở đây thì phải đổi cả
 * `mta-ai-intramind/api/models.py`, nếu không giao diện sẽ cho chọn thứ mà
 * server từ chối bằng 422.
 */
export const MAX_AUDIO_DOCS = 5;

/**
 * Collect the options for an episode.
 *
 * `open` and `onClose` are injected by the global ModalRenderer, same as
 * TemplatePickerModal.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {number} [props.documentCount] - How many documents are selected.
 * @param {(opts: {mode: string, voiceGender: string, tone: string,
 *   focus: string, instruction: string, targetMinutes: number}) => void}
 *   props.onSubmit - `mode` is always "narration"; `focus` always "".
 */
export default function AudioOverviewModal({
  open,
  onClose,
  documentCount = 0,
  onSubmit,
}) {
  const backdropRef = useRef(null);
  const dialogRef = useRef(null);

  const [voiceGender, setVoiceGender] = useState("male");
  const [tone, setTone] = useState("tu_nhien");
  const [instruction, setInstruction] = useState("");
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
    // `focus` is never sent: it belongs to the podcast mode, and the service
    // returns 400 rather than silently ignoring a field from the wrong mode.
    onSubmit?.({
      mode: EPISODE_MODE,
      voiceGender,
      tone,
      focus: "",
      instruction: instruction.trim(),
      targetMinutes: Number(targetMinutes),
    });
    onClose?.();
  };

  const renderChoices = (items, value, onPick, ariaLabel) => (
    <div className="ao-choices" role="group" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          type="button"
          key={item.id}
          className={`ao-choice ${value === item.id ? "is-active" : ""}`}
          aria-pressed={value === item.id}
          onClick={() => onPick(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );

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
            <span className="ao-field-label">Giọng đọc</span>
            {renderChoices(
              AUDIO_VOICES,
              voiceGender,
              setVoiceGender,
              "Giọng đọc"
            )}
          </label>

          <label className="ao-field">
            <span className="ao-field-label">Tông giọng</span>
            {renderChoices(AUDIO_TONES, tone, setTone, "Tông giọng")}
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
                {instruction.length}/{MAX_INSTRUCTION_CHARS}
              </span>
            </span>
            <textarea
              className="ao-focus"
              rows={4}
              maxLength={MAX_INSTRUCTION_CHARS}
              placeholder={
                "Bạn muốn tóm tắt theo hướng nào, podcast ra kiểu gì?\n" +
                "Ví dụ: chỉ tập trung phần kết luận và kiến nghị, nói ngắn gọn theo từng gạch đầu dòng.\n" +
                "Ví dụ: giải thích cho người mới, tránh thuật ngữ, nhấn vào các con số quan trọng."
              }
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
            <span className="ao-hint">
              Đây là phần lái nội dung: tóm tắt theo hướng nào, và podcast trình
              bày ra kiểu gì. Để trống thì tóm tắt toàn bộ tài liệu đã chọn.
            </span>
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
              Tạo podcast
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
