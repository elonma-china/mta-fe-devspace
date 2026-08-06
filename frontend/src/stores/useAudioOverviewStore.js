// src/stores/useAudioOverviewStore.js
import { create } from "zustand";
import {
  submitAudioOverview,
  cancelAudioOverview,
  deleteAudioOverview,
} from "features/analysis/api/audioOverview";

/**
 * Client-side poll ceiling.
 *
 * We omit `startTime` when polling (see `api/audioOverview.js` for why), which
 * means the gateway applies no stuck-task ceiling at all. This is the
 * replacement. Same reasoning and same shape as
 * `DIRECTIVE_REVIEW_MAX_WAIT_MS`, sized for a 30-minute episode cap plus
 * script generation.
 */
export const AUDIO_OVERVIEW_MAX_WAIT_MS = 45 * 60 * 1000;

export const AUDIO_STATUS = {
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  ERROR: "ERROR",
};

const STORAGE_PREFIX = "im.audioOverview.";

/**
 * Episodes live in localStorage rather than the gateway's `info_table`.
 *
 * `orm.py`'s `info_table_type_check` only permits summary / mindmap / report
 * / directive_review, so persisting there needs a schema migration. Dev Space
 * should not force one on the FE team's merge, and an in-flight episode
 * survives a reload either way. Adding `migrate_011.sql` is the
 * productionisation step, not a prerequisite.
 */
const storageKey = (conversationId) => `${STORAGE_PREFIX}${conversationId}`;

const persist = (conversationId, episode) => {
  if (!conversationId) return;
  try {
    if (episode) {
      window.localStorage.setItem(
        storageKey(conversationId),
        JSON.stringify(episode)
      );
    } else {
      window.localStorage.removeItem(storageKey(conversationId));
    }
  } catch {
    // Private mode / quota. The episode still works for this session; losing
    // it on reload is not worth failing the whole action for.
  }
};

const readPersisted = (conversationId) => {
  if (!conversationId) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(conversationId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

/**
 * Classify a poll response into a terminal state or "keep going".
 *
 * Two shapes `useTaskPoller` cannot classify on its own are handled here:
 *
 * 1. A finished episode has NO `status` field at all — the poller's
 *    "non-empty object with no state" branch does treat that as complete,
 *    but only if it really is finished, so we confirm on `object_key`.
 * 2. `{"status": "cancelled"}` matches neither the poller's success branch
 *    (SUCCESS/COMPLETED) nor its failure branch (FAILURE/FAILED/ERROR), and
 *    is not falsy — so without this mapping it polls forever.
 *
 * @param {object|null} result - Raw status payload.
 * @returns {{state: string, result?: object}|null} Terminal state, or null to
 *   keep polling.
 */
export function classifyStatus(result) {
  if (!result || typeof result !== "object") return null;

  const state = String(result.status || "").toUpperCase();

  if (state === "CANCELLED") return { state: AUDIO_STATUS.CANCELLED };
  if (state === "FAILURE" || state === "FAILED" || state === "ERROR") {
    return { state: AUDIO_STATUS.ERROR, result };
  }
  if (result.object_key) {
    return { state: AUDIO_STATUS.COMPLETED, result };
  }
  return null;
}

/**
 * Human-readable progress for one poll.
 *
 * `TaskProgress` is `{done, total, note}` — counts, deliberately not a
 * percentage — and is ABSENT until the task reports something. Never render
 * a 0/0 bar: it reads as "stalled" during the script phase, which is the
 * longest part of the run.
 *
 * @param {object|null} progress
 * @returns {string|null} Label, or null when there is nothing to say yet.
 */
export function progressLabel(progress) {
  if (!progress) return null;
  if (progress.note) return String(progress.note);
  if (progress.total) return `${progress.done ?? 0}/${progress.total}`;
  return null;
}

const useAudioOverviewStore = create((set, get) => ({
  /** conversationId -> episode */
  episodes: {},
  /** conversationId whose panel is open, or null */
  openConvId: null,

  /** Load a persisted episode for a conversation, if any. */
  hydrate: (conversationId) => {
    if (!conversationId || get().episodes[conversationId]) return;
    const stored = readPersisted(conversationId);
    if (stored) {
      set((s) => ({
        episodes: { ...s.episodes, [conversationId]: stored },
      }));
    }
  },

  /** Replace one conversation's episode, persisting the result. */
  setEpisode: (conversationId, episode) => {
    persist(conversationId, episode);
    set((s) => {
      const episodes = { ...s.episodes };
      if (episode) episodes[conversationId] = episode;
      else delete episodes[conversationId];
      return { episodes };
    });
  },

  open: (conversationId) => set({ openConvId: conversationId }),
  close: () => set({ openConvId: null }),

  /**
   * Submit a new episode.
   *
   * @param {object} params
   * @param {number|string} params.conversationId
   * @param {string[]} [params.documentIds]
   * @param {string} [params.text]
   * @param {"vi"|"en"} params.language
   * @param {string} [params.focus]
   * @param {number} params.targetMinutes
   * @param {string} params.name - Display name for the list row.
   * @returns {Promise<string>} The task id.
   */
  submit: async ({
    conversationId,
    documentIds,
    text,
    language,
    focus,
    targetMinutes,
    name,
  }) => {
    const payload = { language, target_minutes: targetMinutes };
    if (focus) payload.focus = focus;
    if (text) payload.text = text;
    if (documentIds?.length) payload.document_ids = documentIds;

    const res = await submitAudioOverview(payload);
    const episode = {
      taskId: res?.task_id,
      status: AUDIO_STATUS.PROCESSING,
      submittedAt: Date.now(),
      language,
      name,
      progress: null,
      result: null,
      error: null,
    };
    get().setEpisode(conversationId, episode);
    return episode.taskId;
  },

  /** Record a progress tick without changing the terminal state. */
  markProgress: (conversationId, progress) => {
    const current = get().episodes[conversationId];
    if (!current || current.status !== AUDIO_STATUS.PROCESSING) return;
    get().setEpisode(conversationId, { ...current, progress });
  },

  markComplete: (conversationId, result) => {
    const current = get().episodes[conversationId];
    if (!current) return;
    get().setEpisode(conversationId, {
      ...current,
      status: AUDIO_STATUS.COMPLETED,
      progress: null,
      result,
    });
  },

  markCancelled: (conversationId) => {
    const current = get().episodes[conversationId];
    if (!current) return;
    get().setEpisode(conversationId, {
      ...current,
      status: AUDIO_STATUS.CANCELLED,
      progress: null,
    });
  },

  markError: (conversationId, message) => {
    const current = get().episodes[conversationId];
    if (!current) return;
    get().setEpisode(conversationId, {
      ...current,
      status: AUDIO_STATUS.ERROR,
      progress: null,
      error: message,
    });
  },

  /**
   * Request cancellation.
   *
   * The local state is NOT flipped to cancelled here: cancellation is
   * cooperative, and claiming it happened before the service confirms would
   * leave a still-running task invisible. The poll reports the truth.
   */
  cancel: async (conversationId) => {
    const current = get().episodes[conversationId];
    if (!current?.taskId) return;
    await cancelAudioOverview(current.taskId);
  },

  /**
   * Delete an episode server-side, then locally.
   *
   * Order matters: a 409 (still running) must leave the local row alone, or
   * the user loses their only handle on a task that is still burning GPU.
   */
  remove: async (conversationId) => {
    const current = get().episodes[conversationId];
    if (!current) return;
    if (current.taskId && current.status !== AUDIO_STATUS.ERROR) {
      await deleteAudioOverview(current.taskId);
    }
    get().setEpisode(conversationId, null);
    if (get().openConvId === conversationId) set({ openConvId: null });
  },
}));

export default useAudioOverviewStore;
