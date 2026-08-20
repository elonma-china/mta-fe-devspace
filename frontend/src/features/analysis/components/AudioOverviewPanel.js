// src/features/analysis/components/AudioOverviewPanel.js
import React, { useEffect, useRef, useState } from "react";
import "./AudioOverviewPanel.css";
import { fetchAudioOverviewBlob } from "../api/audioOverview";

/** Seconds -> m:ss. */
const formatDuration = (seconds) => {
  if (!seconds && seconds !== 0) return "—";
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** Bytes -> MB, one decimal. */
const formatSize = (bytes) =>
  bytes ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : "—";

const SPEAKER_LABELS = {
  host: "Người dẫn",
  guest: "Khách mời",
  narrator: "Người đọc",
};

/** Voice + tone, for telling two episodes of the same notebook apart. */
const VOICE_LABELS = { male: "giọng nam", female: "giọng nữ" };

/**
 * Play a finished episode and show its transcript.
 *
 * @param {object} props
 * @param {object} props.episode - The completed episode from the store.
 * @param {() => void} props.onClose
 * @param {() => void} props.onDelete
 */
export default function AudioOverviewPanel({ episode, onClose, onDelete }) {
  const [audioUrl, setAudioUrl] = useState(null);
  const [error, setError] = useState(null);
  // Tăng lên để chạy lại effect tải tệp. Một lần hỏng KHÔNG được là vĩnh viễn:
  // tệp nằm trên MinIO qua hai chặng mạng, và bản thân tập vẫn còn nguyên —
  // bắt người dùng xoá đi tạo lại một tập 3 phút chỉ vì một cú fetch trượt là
  // mất cả công chờ.
  const [attempt, setAttempt] = useState(0);
  const urlRef = useRef(null);

  const taskId = episode?.taskId;
  const result = episode?.result || {};

  useEffect(() => {
    if (!taskId) return undefined;

    let cancelled = false;
    const controller = new AbortController();

    // The audio cannot be loaded by pointing <audio src> at the endpoint:
    // browsers do not send an Authorization header for media elements. Fetch
    // it with auth, then hand the element an object URL.
    (async () => {
      try {
        const blob = await fetchAudioOverviewBlob(taskId, {
          signal: controller.signal,
        });
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setAudioUrl(url);
      } catch (err) {
        if (!cancelled && err?.name !== "AbortError") {
          // Nói ra MÃ LỖI: 404 (tệp đã bị dọn), 401 (token hết hạn — bấm thử
          // lại vô ích, phải đăng nhập lại), 404-do-proxy (từng xảy ra thật khi
          // tiền tố /tools bị cắt). Một câu "Không tải được" chung chung khiến
          // ba nguyên nhân rất khác nhau trông giống hệt nhau.
          const status = err?.status;
          if (status === 404) setError("Tệp âm thanh không còn trên máy chủ.");
          else if (status === 401 || status === 403)
            setError("Phiên đăng nhập đã hết hạn — hãy đăng nhập lại.");
          else
            setError(
              `Không tải được tệp âm thanh${status ? ` (lỗi ${status})` : ""}.`
            );
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      // Object URLs are held by the document until revoked; without this,
      // reopening the panel a few times leaks tens of MB per episode.
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [taskId, attempt]);

  if (!episode) return null;

  // `mode` is absent on episodes persisted before the two-mode split, so an
  // old localStorage entry must still render rather than crash.
  const turns = result.transcript || [];
  const isNarration =
    (episode.mode || result?.metadata?.mode) === "narration" ||
    (turns.length > 0 && turns.every((t) => t.speaker === "narrator"));
  const voiceLabel =
    VOICE_LABELS[episode.voiceGender || result?.metadata?.voice_gender];
  const toneLabel = result?.metadata?.tone_label;
  // Tài liệu dài bị nén để vừa ngữ cảnh LLM. Nén là hành vi hợp lý, nhưng phải
  // NHÌN THẤY ĐƯỢC: bản trước cắt cụt nguồn và chỉ ghi một cờ `truncated` vào
  // metadata mà không nơi nào ở giao diện đọc, nên người dùng nhận một bản tóm
  // tắt thiếu tài liệu mà không hề biết.
  const compacted = result?.metadata?.sources?.compacted || [];
  // Tập XUỐNG CẤP nhưng vẫn thành công: giọng chất lượng cao 503 nên cả tập
  // đọc bằng giọng dự phòng, máy chủ thiếu ffmpeg nên lưu WAV, hoặc thời lượng
  // lệch xa yêu cầu. Không có mã lỗi nào cho ba thứ này — người dùng nhận một
  // tệp mp3 trông bình thường. Backend nay đính chúng vào metadata.warnings và
  // đây là chỗ duy nhất người dùng nhìn thấy.
  const warnings = result?.metadata?.warnings || [];

  return (
    <section className="ao-panel" aria-label="Tổng quan âm thanh">
      <header className="ao-panel-head">
        {/* Nút quay lại tường minh, KHÔNG phải dấu ✕: panel này thay thế TOÀN BỘ
            lưới công cụ (tóm tắt/mindmap/soạn thảo), nên khi nó mở thì không còn
            lối nào khác trở về. Một dấu ✕ nhỏ ở góc phải đọc như "đóng thông
            báo", không đọc như "trở lại danh sách công cụ". */}
        <button
          type="button"
          className="ao-panel-back"
          onClick={onClose}
          aria-label="Quay lại danh sách công cụ"
        >
          <span aria-hidden="true">←</span> Quay lại
        </button>
        <div className="ao-panel-titles">
          <h2 className="ao-panel-title">{episode.name || "Tổng quan âm thanh"}</h2>
          <div className="ao-panel-meta">
            <span>{formatDuration(result.duration_sec)}</span>
            <span className="ao-panel-dot">·</span>
            <span>{formatSize(result.size_bytes)}</span>
            {result.audio_format && (
              <>
                <span className="ao-panel-dot">·</span>
                <span className="ao-panel-badge">
                  {String(result.audio_format).toUpperCase()}
                </span>
              </>
            )}
            {voiceLabel && (
              <>
                <span className="ao-panel-dot">·</span>
                <span>{voiceLabel}</span>
              </>
            )}
            {toneLabel && (
              <>
                <span className="ao-panel-dot">·</span>
                <span>{toneLabel}</span>
              </>
            )}
          </div>
        </div>
        <div className="ao-panel-tools">
          <button type="button" className="ao-panel-btn" onClick={onDelete}>
            Xoá tập
          </button>
        </div>
      </header>

      {warnings.length > 0 && (
        <ul className="ao-panel-warnings" role="status">
          {warnings.map((w) => (
            <li key={w.code || w.message} className="ao-panel-warning">
              <span aria-hidden="true">⚠</span> {w.message}
            </li>
          ))}
        </ul>
      )}

      {compacted.length > 0 && (
        <p className="ao-panel-note">
          Đã nén {compacted.length} tài liệu dài để vừa ngữ cảnh:{" "}
          {compacted.map((c) => c.name).filter(Boolean).join(", ")}.
        </p>
      )}

      {/* Chiều cao cố định cho cả ba trạng thái: tải xong thì trình phát hiện
          ra đúng chỗ đang chờ, lời thoại bên dưới không nhảy. */}
      <div className="ao-player-slot">
        {error ? (
          <div className="ao-panel-error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              className="ao-panel-btn"
              onClick={() => {
                setError(null);
                setAudioUrl(null);
                setAttempt((n) => n + 1);
              }}
            >
              Thử lại
            </button>
          </div>
        ) : audioUrl ? (
          <audio className="ao-player" controls preload="metadata" src={audioUrl}>
            Trình duyệt không hỗ trợ phát âm thanh.
          </audio>
        ) : (
          <p className="ao-panel-loading">Đang tải tệp âm thanh…</p>
        )}
      </div>

      <div className="ao-transcript">
        <h3 className="ao-transcript-title">
          {isNarration ? "Nội dung" : "Lời thoại"}
        </h3>
        {(result.transcript || []).map((turn, i) => (
          <div
            className={`ao-turn ao-turn--${turn.speaker || "host"}`}
            key={`turn-${i}`}
          >
            {/* A single-voice reading gets no speaker chips: a column of
                identical "Người đọc" labels is noise, not information. */}
            {!isNarration && (
              <span className="ao-turn-speaker">
                {SPEAKER_LABELS[turn.speaker] || turn.speaker}
              </span>
            )}
            <p className="ao-turn-text">{turn.text}</p>
          </div>
        ))}
        {!(result.transcript || []).length && (
          <p className="ao-panel-loading">Không có lời thoại.</p>
        )}
      </div>
    </section>
  );
}
