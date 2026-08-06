// src/features/analysis/api/audioOverview.js
import { apiClient } from "lib/apiClient";
import { API_PREFIX } from "config";

/**
 * Start rendering a podcast episode.
 *
 * @param {object} payload
 * @param {string} [payload.text] - Raw text to narrate.
 * @param {string[]} [payload.document_ids] - Source documents; one of these
 *   or `text` is required.
 * @param {"vi"|"en"} payload.language
 * @param {string} [payload.focus] - Optional steer, max 500 chars.
 * @param {number} [payload.target_minutes] - 1..30.
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{task_id: string, status: string, timestamp: string}>}
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
