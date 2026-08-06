// src/features/analysis/api/tools.js
import { apiClient } from "lib/apiClient";
import { UPSTREAM_STATUS } from "constants/status";
import { API_PREFIX } from "config";

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Sleep that rejects on abort signal.
 */
function sleepWithAbort(ms, signal) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const cleanup = () => {
      if (signal) signal.removeEventListener("abort", onAbort);
    };
    if (signal) {
      if (signal.aborted) {
        clearTimeout(id);
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }
  });
}

/**
 * Generic polling helper for async tool tasks.
 * Submits a request, then polls for status until `isDone` returns true.
 *
 * @param {Object} opts
 * @param {Function} opts.submit   - (payload, { signal }) => Promise<{ task_id }>
 * @param {Function} opts.getStatus - (taskId, startTime, { signal }) => Promise<status>
 * @param {Function} opts.isDone   - (status) => boolean
 * @param {AbortSignal} [opts.signal]
 * @param {Function}    [opts.onProgress]
 * @param {number}      [opts.intervalMs=5000]
 * @param {number}      [opts.maxWaitMs=1200000]
 * @param {Object}      ...rest - payload forwarded to submit
 */
async function pollTask({ submit, getStatus, isDone, signal, onProgress, intervalMs = 5000, maxWaitMs = 1200000, ...payload }) {
  const start = Date.now();

  const { task_id } = await submit({ ...payload }, { signal });

  for (;;) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const status = await getStatus(task_id, start, { signal });

    if (isDone(status)) return status;

    if (typeof onProgress === "function") {
      onProgress({
        current: Number(status?.current ?? 0),
        total: Number(status?.total ?? 100),
        phase: String(status?.status ?? UPSTREAM_STATUS.PENDING),
      });
    }

    if (Date.now() - start > maxWaitMs) throw new Error("Task timed out");
    await sleepWithAbort(intervalMs, signal);
  }
}

// ─── Summary ─────────────────────────────────────────────────

export const submitSummary = (payload, { signal } = {}) =>
  apiClient.post("/summary", payload, { prefix: API_PREFIX.TOOL, signal });

export const getSummaryStatus = (taskId, startTime, conversationId, { signal } = {}) =>
  apiClient.get(`/summary/status/${encodeURIComponent(taskId)}`, {
    prefix: API_PREFIX.TOOL,
    signal,
    params: { startTime, conversation_id: conversationId },
  });

export const callSummary = (opts) =>
  pollTask({
    ...opts,
    submit: submitSummary,
    getStatus: getSummaryStatus,
    isDone: (s) => s?.summary && (s?.status === UPSTREAM_STATUS.SUCCESS || !s?.status),
  });

// ─── Mindmap ─────────────────────────────────────────────────

export const submitMindmap = (payload, { signal } = {}) =>
  apiClient.post("/mindmap", payload, { prefix: API_PREFIX.TOOL, signal });

export const getMindmapStatus = (taskId, startTime, conversationId, { signal } = {}) =>
  apiClient.get(`/mindmap/status/${encodeURIComponent(taskId)}`, {
    prefix: API_PREFIX.TOOL,
    signal,
    params: { startTime, conversation_id: conversationId },
  });

export const callMindmap = (opts) =>
  pollTask({
    ...opts,
    submit: submitMindmap,
    getStatus: getMindmapStatus,
    isDone: (s) => {
      const mm = s?.mindmap;
      return (s?.status === UPSTREAM_STATUS.SUCCESS || !s?.status) &&
        (typeof mm === "string" || (mm && Object.keys(mm).length));
    },
  });

// ─── Draft (report / context synthesis) ──────────────────────

export const submitDraft = (payload, { signal } = {}) =>
  apiClient.post("/draft", payload, { prefix: API_PREFIX.TOOL, signal });

export const getDraftStatus = (taskId, startTime, conversationId, { signal } = {}) =>
  apiClient.get(`/draft/status/${encodeURIComponent(taskId)}`, {
    prefix: API_PREFIX.TOOL,
    signal,
    params: { startTime, conversation_id: conversationId },
  });

// Draft synthesis is a multi-tier LLM pipeline and can run far longer than
// summary/mindmap (observed ~45 min on a large doc), so it needs a much higher
// polling ceiling than pollTask's 20-minute default — and a gentler interval.
const DRAFT_POLL_INTERVAL_MS = 10000;   // 10s
const DRAFT_POLL_MAX_WAIT_MS = 5400000; // 90 min

/**
 * Convenience submit+poll wrapper, mirroring callSummary/callMindmap.
 * NOTE: production report polling does NOT use this — it polls via
 * useTaskPoller calling getDraftStatus(taskId, ts, conversationId) directly.
 * pollTask invokes getStatus as (taskId, start, { signal }), so this wrapper
 * does not thread conversation_id; do not rely on it for that.
 */
export const callDraft = (opts) =>
  pollTask({
    intervalMs: DRAFT_POLL_INTERVAL_MS,
    maxWaitMs: DRAFT_POLL_MAX_WAIT_MS,
    ...opts,
    submit: submitDraft,
    getStatus: getDraftStatus,
    isDone: (s) =>
      s?.draft_markdown && (s?.status === UPSTREAM_STATUS.SUCCESS || !s?.status),
  });

// ─── Draft DOCX export (synchronous binary) ──────────────────

export const exportDraftDocx = (payload, { signal } = {}) =>
  apiClient.postBlob("/draft/export", payload, { prefix: API_PREFIX.TOOL, signal });

// ─── Directive review (draft advisory) ───────────────────────

/**
 * Submit a draft resolution for advisory review.
 *
 * @param {FormData} formData — MUST contain:
 *   - `file`:    the draft .docx File
 *   - `payload`: JSON string {reference_document_ids: string[], options: object}
 * Passed to apiClient.post as-is: apiClient detects FormData and lets the
 * browser set the multipart boundary. Do not JSON.stringify it.
 */
export const submitDirectiveReview = (formData, { signal } = {}) =>
  apiClient.post("/directive-review", formData, { prefix: API_PREFIX.TOOL, signal });

/**
 * Poll a review task.
 *
 * Takes ONLY taskId — deliberately unlike getDraftStatus(taskId, startTime,
 * conversationId). The backend's _apply_zombie_check treats a response with no
 * `status` field as "stuck" and, past zombie_task_timeout_ms (10 min), rewrites
 * it to {status: "FAILURE"}. The AI service's COMPLETED directive-review
 * response has no `status` field, and reviews routinely run past 10 minutes —
 * so passing startTime would turn a successful report into a failure. Omitting
 * it takes the `if not start_time: return data` early-out.
 */
export const getDirectiveReviewStatus = (taskId, { signal } = {}) =>
  apiClient.get(`/directive-review/status/${encodeURIComponent(taskId)}`, {
    prefix: API_PREFIX.TOOL,
    signal,
  });

/** Export a finished advisory report to DOCX (synchronous binary). */
export const exportDirectiveReviewDocx = (payload, { signal } = {}) =>
  apiClient.postBlob("/directive-review/export", payload, {
    prefix: API_PREFIX.TOOL,
    signal,
  });