// src/features/chat/components/MicButton.js
import React, { useCallback, useRef, useState } from "react";
import "./MicButton.css";
import {
  useVoiceRecorder,
  RECORDER_STATE,
  MAX_SECONDS,
} from "hooks/useVoiceRecorder";
import { transcribeVoice, sttErrorMessage } from "../api/stt";
import VoiceWaveform from "./VoiceWaveform";

/** mm:ss for the recording timer. */
const formatElapsed = (seconds) => {
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
};

/**
 * Record a voice query, transcribe it, and hand the text to the caller.
 *
 * The transcript is never sent on its own — STT is imperfect, and a wrong
 * question silently asked is worse than one the user corrects first. This
 * fills the input; the user presses Enter.
 *
 * @param {object} props
 * @param {(text: string) => void} props.onTranscribed - Receives the text.
 * @param {() => void} [props.onRecordStart] - Fired when recording starts, so
 *   the caller can clear the previous result. Nói lại lần hai mà bản đọc cũ
 *   còn nằm trong ô nhập thì hai lần dính vào nhau — đó là lý do prop này tồn
 *   tại, không phải để trang trí.
 * @param {boolean} [props.disabled] - Mirrors the send button's disabled state.
 * @param {"vi"|"en"} [props.language] - STT engine to use.
 */
export default function MicButton({
  onTranscribed,
  onRecordStart,
  disabled = false,
  language = "vi",
}) {
  const [isTranscribing, setTranscribing] = useState(false);
  const [apiError, setApiError] = useState(null);
  const abortRef = useRef(null);

  const handleBlob = useCallback(
    async (blob) => {
      setApiError(null);
      setTranscribing(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const result = await transcribeVoice(blob, language, {
          signal: controller.signal,
        });
        const text = (result?.text || "").trim();
        if (text) {
          onTranscribed(text);
        } else {
          setApiError("Không nghe được nội dung nào. Thử nói rõ hơn.");
        }
      } catch (err) {
        if (err?.name !== "AbortError") setApiError(sttErrorMessage(err));
      } finally {
        abortRef.current = null;
        setTranscribing(false);
      }
    },
    [language, onTranscribed]
  );

  const {
    state,
    elapsedSeconds,
    error,
    analyserRef,
    isSupported,
    start,
    stop,
    reset,
  } = useVoiceRecorder({ onComplete: handleBlob });

  const isRecording = state === RECORDER_STATE.RECORDING;
  const isBusy =
    isTranscribing ||
    state === RECORDER_STATE.ENCODING ||
    state === RECORDER_STATE.REQUESTING;
  const message = apiError || error;

  const onClick = () => {
    if (message) {
      setApiError(null);
      reset();
      return;
    }
    if (isRecording) {
      stop();
      return;
    }
    // Xoá kết quả cũ NGAY khi bắt đầu ghi, không đợi tới lúc có bản đọc mới:
    // người dùng thấy ô nhập trống là biết lần này ghi đè, và nếu lượt ghi bị
    // huỷ giữa chừng thì cũng không còn bản đọc cũ gây hiểu nhầm.
    onRecordStart?.();
    start();
  };

  // An unsupported context is a fact about the page, not a transient error:
  // say so on the button itself rather than letting it look merely broken.
  const title = !isSupported
    ? "Micro cần HTTPS hoặc localhost"
    : isRecording
      ? `Dừng ghi (tối đa ${MAX_SECONDS}s)`
      : "Ghi âm câu hỏi";

  return (
    <div className="ci-mic-wrap">
      <button
        type="button"
        className={`ci-mic ${isRecording ? "is-recording" : ""} ${
          message ? "is-error" : ""
        }`}
        onClick={onClick}
        disabled={disabled || isBusy || !isSupported}
        aria-label={title}
        aria-pressed={isRecording}
        title={title}
      >
        {isBusy ? (
          <span className="ci-mic-spinner" aria-hidden="true" />
        ) : isRecording ? (
          <span className="ci-mic-dot" aria-hidden="true" />
        ) : (
          <MicGlyph />
        )}
      </button>

      {isRecording && (
        <>
          {/* Phổ âm thanh: phản hồi duy nhất cho câu hỏi "máy có nghe thấy
              tôi không". Đặt cạnh đồng hồ vì hai thông tin này luôn được đọc
              cùng nhau — còn bao lâu, và có đang thu được tiếng. */}
          <span className="ci-mic-wave">
            <VoiceWaveform analyserRef={analyserRef} active={isRecording} />
          </span>
          <span className="ci-mic-timer" role="timer">
            {formatElapsed(elapsedSeconds)}
          </span>
        </>
      )}
      {message && (
        <span className="ci-mic-error" role="alert">
          {message}
        </span>
      )}
    </div>
  );
}

/** Inline so the button carries no asset dependency. */
function MicGlyph() {
  return (
    <svg
      className="ci-mic-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  );
}
