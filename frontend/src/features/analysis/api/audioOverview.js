// src/features/analysis/api/audioOverview.js
import { apiClient } from "lib/apiClient";
import { API_PREFIX } from "config";

/**
 * Start rendering a podcast episode.
 *
 * @param {object} payload
 * @param {string} [payload.text] - Raw text to narrate.
 * @param {string[]} [payload.document_ids] - Source documents (max 5); one of
 *   these or `text` is required.
 * @param {string} [payload.conversation_id] - Chat session that owns the
 *   episode; drives the MinIO object key and trace grouping.
 * @param {"vi"} payload.language - Vietnamese only.
 * @param {"podcast"|"narration"} [payload.mode] - Two hosts, or one reader.
 * @param {"male"|"female"} [payload.voice_gender] - podcast: the host's voice
 *   (the guest takes the other); narration: the reader's voice.
 * @param {"trang_trong"|"tu_nhien"|"soi_noi"|"cham_rai"} [payload.tone]
 * @param {string} [payload.focus] - podcast ONLY, max 500 chars. Sending it on
 *   a narration is a 400, not a silent no-op.
 * @param {string} [payload.instruction] - narration ONLY, max 2000 chars.
 * @param {"short"|"default"|"long"} [payload.length] - Độ dài tương đối.
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{task_id: string, status: string, timestamp: string}>}
 */
/*
 * Submit goes through the gateway's explicit /tools/audio-overview route, not
 * the /tools/{tool} catch-all: the catch-all returns an upstream error body
 * with HTTP 200, which `ApiError` never sees, so a rejected mode/tone/voice
 * would look like a successful submit with an undefined task_id.
 */
export const submitAudioOverview = (payload, { signal } = {}) =>
  apiClient.post("/audio-overview", payload, {
    prefix: API_PREFIX.TOOL,
    signal,
  });

/**
 * Poll an episode's status.
 *
 * Takes ONLY taskId — deliberately, exactly like `getDirectiveReviewStatus`.
 * The gateway's `_apply_zombie_check` treats a response with no `status`
 * field as "stuck" and, past `zombie_task_timeout_ms`, rewrites it to
 * `{status: "FAILURE"}`. A COMPLETED AudioOverviewResponse has no `status`
 * field, so passing `startTime` would turn a finished episode into a
 * failure. Omitting it takes the `if not start_time: return data` early-out.
 *
 * The client-side ceiling that replaces the server's lives in
 * `AUDIO_OVERVIEW_MAX_WAIT_MS`.
 *
 * @param {string} taskId
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<object>} Processing, completed, or cancelled payload.
 */
export const getAudioOverviewStatus = (taskId, { signal } = {}) =>
  apiClient.get(`/audio-overview/status/${encodeURIComponent(taskId)}`, {
    prefix: API_PREFIX.TOOL,
    signal,
  });

/**
 * Ask the service to stop rendering. Cooperative: the status becomes
 * `cancelled` on a later poll, not immediately.
 */
export const cancelAudioOverview = (taskId, { signal } = {}) =>
  apiClient.post(
    `/audio-overview/${encodeURIComponent(taskId)}/cancel`,
    {},
    { prefix: API_PREFIX.TOOL, signal }
  );

/** Delete a finished episode and its audio. Returns 409 while still running. */
export const deleteAudioOverview = (taskId, { signal } = {}) =>
  apiClient.delete(`/audio-overview/${encodeURIComponent(taskId)}`, {
    prefix: API_PREFIX.TOOL,
    signal,
  });

/**
 * Fetch the episode audio as a Blob.
 *
 * Must go through `getBlob` rather than pointing `<audio src>` at the URL:
 * the browser cannot attach an Authorization header to a media element's
 * src, which is the same reason `requestBlob` exists at all.
 */
export const fetchAudioOverviewBlob = (taskId, { signal } = {}) =>
  apiClient.getBlob(`/audio-overview/${encodeURIComponent(taskId)}/file`, {
    prefix: API_PREFIX.TOOL,
    signal,
  });

/**
 * Ước tính thời lượng khả thi từ nguồn — gọi TRƯỚC khi tạo tập.
 *
 * Không tạo gì, không gọi LLM: chỉ đếm chữ của tài liệu đã chọn. Có nó thì
 * người dùng biết ngay "nguồn này đủ cho khoảng 5 phút" thay vì xin 30 phút,
 * chờ hơn 13 phút, rồi nhận một tập 10,7 phút (đo thật trên máy chủ).
 *
 * @param {{document_ids?: string[], text?: string, mode?: string}} payload
 * @returns {Promise<{source_words: number, feasible_minutes: number,
 *   max_minutes: number, documents: Array<{id: string, name: string, words: number}>}>}
 */
export const estimateAudioOverview = (payload, { signal } = {}) =>
  apiClient.post("/audio-overview/estimate", payload, {
    prefix: API_PREFIX.TOOL,
    signal,
  });
