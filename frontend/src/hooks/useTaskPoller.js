// src/hooks/useTaskPoller.js
import { useEffect, useRef } from "react";

const POLL_INTERVAL_MS = 3000;

/**
 * Generic task poller hook.
 * Polls each task in `tasks` at `interval` ms using `checkStatus`.
 *
 * @param {Record<string, {taskId: string, ...meta}>} tasks — map of active tasks (id → meta)
 * @param {object} opts
 * @param {Function} opts.checkStatus  — (taskId, meta) => Promise<statusResult>
 * @param {Function} opts.onComplete   — (id, statusResult) => void — called on success
 * @param {Function} opts.onError      — (id, statusResult) => void — called on failure
 * @param {Function} [opts.onPollError] — (id, err) => void — called on network/poll error
 * @param {number}   [opts.interval=3000]
 */
export function useTaskPoller(tasks, { checkStatus, onComplete, onError, onPollError, interval = POLL_INTERVAL_MS } = {}) {
  // Use refs for callbacks to avoid re-creating the interval on every render
  const checkStatusRef = useRef(checkStatus);
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);
  const onPollErrorRef = useRef(onPollError);

  checkStatusRef.current = checkStatus;
  onCompleteRef.current = onComplete;
  onErrorRef.current = onError;
  onPollErrorRef.current = onPollError;

  useEffect(() => {
    const ids = Object.keys(tasks || {});
    if (!ids.length) return;

    const poll = async () => {
      for (const id of ids) {
        const meta = tasks[id];
        if (!meta?.taskId) continue;

        try {
          const result = await checkStatusRef.current(meta.taskId, meta);

          const state = result?.status?.toUpperCase?.() || result?.state?.toUpperCase?.() || "";

          if (state === "SUCCESS" || state === "COMPLETED") {
            onCompleteRef.current?.(id, result);
          } else if (state === "FAILURE" || state === "FAILED" || state === "ERROR") {
            onErrorRef.current?.(id, result);
          } else if (
            !state &&
            result != null &&
            typeof result === "object" &&
            Object.keys(result).length > 0
          ) {
            // Backend returned a non-empty object with no status/state field
            // — treat as completed (e.g. summary/mindmap success responses)
            onCompleteRef.current?.(id, result);
          }
          // Otherwise keep polling (PENDING, STARTED, PROCESSING)
        } catch (err) {
          console.warn(`Task polling error for ${id}:`, err);
          onPollErrorRef.current?.(id, err);
        }
      }
    };

    // Poll immediately on mount, then at interval
    poll();
    const intervalId = setInterval(poll, interval);
    return () => clearInterval(intervalId);
  }, [tasks, interval]);
}
