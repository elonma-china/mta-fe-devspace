// src/features/chat/api/stt.js
import { apiClient } from "lib/apiClient";
import { API_PREFIX } from "config";

/**
 * Transcribe a recorded clip.
 *
 * The blob is named `voice.wav` on purpose, not for tidiness: the AI service
 * gates uploads on the filename extension, and an anonymous blob is rejected
 * with a 415 before any audio is decoded.
 *
 * `apiClient.request` detects FormData and leaves the Content-Type unset so
 * the browser can add the multipart boundary.
 *
 * @param {Blob} blob - 16 kHz mono WAV from `useVoiceRecorder`.
 * @param {"vi"|"en"} [language] - Which STT engine to use.
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{text: string, language: string, duration_ms: number,
 *   segments: Array<{start_ms: number, end_ms: number, text: string}>}>}
 */
export const transcribeVoice = (blob, language = "vi", { signal } = {}) => {
  const form = new FormData();
  form.append("file", blob, "voice.wav");
  form.append("language", language);
  return apiClient.post("/stt/transcribe", form, {
    prefix: API_PREFIX.LLM,
    signal,
  });
};

/**
 * Turn an STT failure into something a user can act on.
 *
 * The gateway forwards the AI service's status verbatim precisely so this
 * mapping is possible — 403 (feature off) and 503 (engine not loaded) are
 * both "no transcript", but only one of them is worth retrying.
 *
 * @param {Error & {status?: number}} error - Error from `transcribeVoice`.
 * @returns {string} Vietnamese message.
 */
export const sttErrorMessage = (error) => {
  // Ưu tiên `detail` của server khi nó là một câu tiếng Việt hoàn chỉnh: 422
  // gộp nhiều nguyên nhân rất khác nhau — file rác, đoạn ghi quá ngắn, không
  // nghe ra nội dung — và mỗi nguyên nhân cần người dùng làm một việc khác.
  // Một câu "Không đọc được đoạn ghi âm" chung chung không nói cho họ biết là
  // phải bấm giữ lâu hơn hay nói to hơn.
  const detail = typeof error?.detail === "string" ? error.detail.trim() : "";
  if (detail && detail.length <= 200 && /[a-zà-ỹ]/i.test(detail)) return detail;

  switch (error?.status) {
    case 403:
      return "Tính năng nhận dạng giọng nói đang tắt trên máy chủ.";
    case 413:
      return "Đoạn ghi âm quá dài.";
    case 415:
      return "Định dạng âm thanh không được hỗ trợ.";
    case 422:
      return "Không đọc được đoạn ghi âm. Thử ghi lại.";
    case 503:
      return "Dịch vụ nhận dạng giọng nói chưa sẵn sàng.";
    default:
      return "Không chuyển được giọng nói thành văn bản. Thử lại.";
  }
};
