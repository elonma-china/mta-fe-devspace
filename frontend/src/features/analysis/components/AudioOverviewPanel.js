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
          setError(
            err?.status === 404
              ? "Tệp âm thanh không còn trên máy chủ."
              : "Không tải được tệp âm thanh."
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
  }, [taskId]);

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

  return (
    <section className="ao-panel" aria-label="Tổng quan âm thanh">
      <header className="ao-panel-head">
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
            Xoá
          </button>
          <button
            type="button"
            className="ao-panel-btn"
            onClick={onClose}
            aria-label="Đóng"
          >
            ✕
          </button>
        </div>
      </header>

      {compacted.length > 0 && (
        <p className="ao-panel-note">
          Đã nén {compacted.length} tài liệu dài để vừa ngữ cảnh:{" "}
          {compacted.map((c) => c.name).filter(Boolean).join(", ")}.
        </p>
      )}

      {error ? (
        <p className="ao-panel-error" role="alert">
          {error}
        </p>
      ) : audioUrl ? (
        <audio className="ao-player" controls src={audioUrl}>
          Trình duyệt không hỗ trợ phát âm thanh.
        </audio>
      ) : (
        <p className="ao-panel-loading">Đang tải tệp âm thanh…</p>
      )}

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
