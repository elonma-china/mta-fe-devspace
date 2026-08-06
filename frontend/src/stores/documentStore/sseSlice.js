// src/stores/documentStore/sseSlice.js
import { PROCESSING_STATUS } from "constants/status";
import { getDocumentEventsURL } from "features/documents/api";
import { updateDocumentStatus as apiUpdateStatus } from "features/documents/api";
import { toId } from "./helpers";

/**
 * Maximum consecutive reconnect attempts before falling back to polling.
 * @type {number}
 */
const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * Base delay (ms) for exponential backoff on reconnect.
 * @type {number}
 */
const RECONNECT_BASE_MS = 1000;

/**
 * SSE slice — manages a single EventSource connection per conversation
 * for real-time document status updates via Redis pub/sub on the backend.
 *
 * Replaces per-document polling with a persistent SSE stream that pushes
 * `snapshot` (initial) and `status` (real-time) events.
 *
 * Falls back to polling when SSE cannot connect or drops repeatedly.
 *
 * @param {Function} set — Zustand set
 * @param {Function} get — Zustand get
 * @returns {object} slice state + actions
 */
export const createSSESlice = (set, get) => ({
  // ── State ──
  _eventSource: null,
  _reconnectAttempts: 0,
  _reconnectTimer: null,
  sseConnected: false,
  sseFallback: false,

  // ── Actions ──

  /**
   * Open an SSE connection for the given conversation.
   *
   * Closes any existing connection first.  Processes `snapshot` events
   * (initial statuses from MongoDB) and `status` events (real-time
   * pub/sub messages).
   *
   * @param {string|number} userId
   * @param {string|number} conversationId
   * @param {string[]}      [docIds=[]] — IDs of processing docs for snapshot
   */
  connectSSE: (userId, conversationId, docIds = []) => {
    const state = get();

    // Close existing connection if switching conversations
    if (state._eventSource) {
      state.disconnectSSE();
    }

    if (!userId || !conversationId) return;

    const url = getDocumentEventsURL(userId, conversationId, docIds);
    const es = new EventSource(url);

    es.addEventListener("snapshot", (e) => {
      try {
        const docs = JSON.parse(e.data);
        if (!Array.isArray(docs)) return;

        docs.forEach(({ document_id, status }) => {
          if (document_id && status) {
            get().updateDocumentStatus(
              document_id,
              status.toUpperCase(),
            );
          }
        });
      } catch (err) {
        console.warn("[SSE] Failed to parse snapshot:", err);
      }
    });

    es.addEventListener("status", (e) => {
      try {
        const { document_id, status, error } = JSON.parse(e.data);
        if (!document_id || !status) return;

        const upper = status.toUpperCase();

        if (upper === "COMPLETED") {
          get().updateDocumentStatus(
            document_id,
            PROCESSING_STATUS.COMPLETED,
          );
          get().completePolling(document_id);

          // Persist final status to backend-fastapi DB
          const { conversationId: convId } = get();
          if (convId) {
            apiUpdateStatus(userId, convId, document_id, {
              status: PROCESSING_STATUS.COMPLETED,
              task_id: null,
            }).catch((err) =>
              console.warn("[SSE] Failed to persist completed status:", err),
            );
          }
        } else if (upper === "FAILED") {
          get().updateDocumentStatus(
            document_id,
            PROCESSING_STATUS.ERROR,
            { error: error || "Processing failed" },
          );
          get().completePolling(document_id);

          // Persist error status
          const { conversationId: convId } = get();
          if (convId) {
            apiUpdateStatus(userId, convId, document_id, {
              status: PROCESSING_STATUS.ERROR,
              task_id: null,
            }).catch((err) =>
              console.warn("[SSE] Failed to persist failed status:", err),
            );
          }
        }
        // PROCESSING status — just update the UI, keep listening
        else if (upper === "PROCESSING") {
          get().updateDocumentStatus(
            document_id,
            PROCESSING_STATUS.PROCESSING,
          );
        }
      } catch (err) {
        console.warn("[SSE] Failed to parse status event:", err);
      }
    });

    es.onopen = () => {
      set({ sseConnected: true, _reconnectAttempts: 0, sseFallback: false });
    };

    es.onerror = () => {
      // EventSource auto-reconnects on transient errors, but if it
      // enters CLOSED state we do manual reconnect with backoff.
      if (es.readyState === EventSource.CLOSED) {
        set({ sseConnected: false });
        const attempts = get()._reconnectAttempts + 1;
        set({ _reconnectAttempts: attempts });

        if (attempts > MAX_RECONNECT_ATTEMPTS) {
          console.warn(
            "[SSE] Max reconnect attempts reached — falling back to polling",
          );
          set({ sseFallback: true });
          return;
        }

        const delay = RECONNECT_BASE_MS * Math.pow(2, attempts - 1);
        const timer = setTimeout(() => {
          const s = get();
          if (s.conversationId === conversationId) {
            // Re-derive processing doc IDs for reconnect
            const processingIds = s.documents
              .filter((d) => {
                const st = d.status?.toUpperCase();
                return (
                  st === PROCESSING_STATUS.PROCESSING ||
                  st === PROCESSING_STATUS.PENDING
                );
              })
              .map((d) => toId(d.id));
            s.connectSSE(userId, conversationId, processingIds);
          }
        }, delay);
        set({ _reconnectTimer: timer });
      }
    };

    set({ _eventSource: es, sseConnected: false, sseFallback: false });
  },

  /**
   * Close the current SSE connection and clear reconnect timers.
   */
  disconnectSSE: () => {
    const { _eventSource, _reconnectTimer } = get();
    if (_eventSource) {
      _eventSource.close();
    }
    if (_reconnectTimer) {
      clearTimeout(_reconnectTimer);
    }
    set({
      _eventSource: null,
      _reconnectTimer: null,
      sseConnected: false,
      _reconnectAttempts: 0,
    });
  },
});
