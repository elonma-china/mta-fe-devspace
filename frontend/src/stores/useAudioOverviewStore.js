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

/** The two episode kinds. `podcast` = two hosts; `narration` = one reader. */
export const AUDIO_MODE = {
  PODCAST: "podcast",
  NARRATION: "narration",
};

export const AUDIO_MODES = [AUDIO_MODE.PODCAST, AUDIO_MODE.NARRATION];

/**
 * Store/localStorage key for one episode.
 *
 * Keyed by conversation AND mode, not by conversation alone: the two modes
 * answer different questions, so making a reading force you to delete your
 * podcast would be an artificial limit. One in-flight episode *per mode* is
 * still the rule — that is what keeps the poll loop a single task.
 *
 * @param {number|string} conversationId
 * @param {"podcast"|"narration"} [mode]
 */
export const episodeKey = (conversationId, mode = AUDIO_MODE.NARRATION) =>
  `${conversationId}:${mode}`;

/**
 * Episodes live in localStorage rather than the gateway's `info_table`.
 *
 * `orm.py`'s `info_table_type_check` only permits summary / mindmap / report
 * / directive_review, so persisting there needs a schema migration. Dev Space
 * should not force one on the FE team's merge, and an in-flight episode
 * survives a reload either way. Adding `migrate_011.sql` is the
 * productionisation step, not a prerequisite.
 */
const storageKey = (key) => `${STORAGE_PREFIX}${key}`;

/** Pre-mode key, when an episode was stored per conversation only. */
const legacyStorageKey = (conversationId) => `${STORAGE_PREFIX}${conversationId}`;

const persist = (key, episode) => {
  if (!key) return;
  try {
    if (episode) {
      window.localStorage.setItem(storageKey(key), JSON.stringify(episode));
    } else {
      window.localStorage.removeItem(storageKey(key));
    }
  } catch {
    // Private mode / quota. The episode still works for this session; losing
    // it on reload is not worth failing the whole action for.
  }
};

const readPersisted = (key) => {
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

/**
 * Move a pre-mode entry onto the podcast key.
 *
 * Worth the ten lines: an episode can take 45 minutes, and its only handle is
 * this key. Renaming the key without moving the value would strand a running
 * job — the user would see nothing, be unable to cancel it, and it would keep
 * rendering.
 */
const migrateLegacy = (conversationId) => {
  try {
    const raw = window.localStorage.getItem(legacyStorageKey(conversationId));
    if (!raw) return null;
    const target = episodeKey(conversationId, AUDIO_MODE.PODCAST);
    if (!window.localStorage.getItem(storageKey(target))) {
      window.localStorage.setItem(storageKey(target), raw);
    }
    window.localStorage.removeItem(legacyStorageKey(conversationId));
    return JSON.parse(raw);
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
  /** episodeKey(conversationId, mode) -> episode */
  episodes: {},
  /** episodeKey whose panel is open, or null */
  openKey: null,

  /** Load every persisted episode for a conversation, migrating old keys. */
  hydrate: (conversationId) => {
    if (!conversationId) return;
    const legacy = migrateLegacy(conversationId);
    const loaded = {};
    AUDIO_MODES.forEach((mode) => {
      const key = episodeKey(conversationId, mode);
      if (get().episodes[key]) return;
      const stored =
        readPersisted(key) || (mode === AUDIO_MODE.PODCAST ? legacy : null);
      if (stored) loaded[key] = stored;
    });
    if (Object.keys(loaded).length) {
      set((s) => ({ episodes: { ...s.episodes, ...loaded } }));
    }
  },

  /** Replace one episode, persisting the result. */
  setEpisode: (key, episode) => {
    persist(key, episode);
    set((s) => {
      const episodes = { ...s.episodes };
      if (episode) episodes[key] = episode;
      else delete episodes[key];
      return { episodes };
    });
  },

  open: (key) => set({ openKey: key }),
  close: () => set({ openKey: null }),

  /**
   * Submit a new episode.
   *
   * `focus` and `instruction` are mutually exclusive by mode and the service
   * returns 400 if they are crossed, so only the one belonging to this mode is
   * ever sent.
   *
   * @param {object} params
   * @param {number|string} params.conversationId
   * @param {"podcast"|"narration"} params.mode
   * @param {string[]} [params.documentIds]
   * @param {string} [params.text]
   * @param {"male"|"female"} params.voiceGender - podcast: the host's voice
   *   (the guest takes the other); narration: the reader's voice.
   * @param {string} params.tone - Named preset id.
   * @param {string} [params.focus] - podcast only, max 500 chars.
   * @param {string} [params.instruction] - narration only, max 2000 chars.
   * @param {"short"|"default"|"long"} params.length - Độ dài tương đối;
   *   server suy số phút từ chính nguồn (xem AudioOverviewModal).
   * @param {string} params.name - Display name for the list row.
   * @returns {Promise<string>} The task id.
   */
  submit: async ({
    conversationId,
    mode = AUDIO_MODE.NARRATION,
    documentIds,
    text,
    voiceGender,
    tone,
    focus,
    instruction,
    length,
    name,
  }) => {
    const payload = {
      language: "vi",
      mode,
      voice_gender: voiceGender,
      tone,
      // Gửi MỨC, không gửi phút: server biết nguồn dài bao nhiêu, người dùng
      // thì không. Xem chú thích AUDIO_LENGTHS trong AudioOverviewModal.
      length,
      // Phiên chat sở hữu tập này. Thiếu trường này thì tập rơi vào thư mục
      // "no-session" trên MinIO và trace không gom được theo hội thoại — đo
      // được đúng như vậy: `object_key` của mọi tập đều là
      // "audio-overviews/no-session/...". Gửi trong BODY vì gateway của FE chỉ
      // chuyển tiếp body, query param rụng ở đó.
      conversation_id: conversationId == null ? undefined : String(conversationId),
    };
    if (mode === AUDIO_MODE.NARRATION) {
      if (instruction) payload.instruction = instruction;
    } else if (focus) {
      payload.focus = focus;
    }
    if (text) payload.text = text;
    if (documentIds?.length) payload.document_ids = documentIds;

    const res = await submitAudioOverview(payload);
    const episode = {
      taskId: res?.task_id,
      status: AUDIO_STATUS.PROCESSING,
      submittedAt: Date.now(),
      language: "vi",
      mode,
      voiceGender,
      tone,
      name,
      progress: null,
      result: null,
      error: null,
    };
    get().setEpisode(episodeKey(conversationId, mode), episode);
    return episode.taskId;
  },

  /** Record a progress tick without changing the terminal state. */
  markProgress: (key, progress) => {
    const current = get().episodes[key];
    if (!current || current.status !== AUDIO_STATUS.PROCESSING) return;
    get().setEpisode(key, { ...current, progress });
  },

  markComplete: (key, result) => {
    const current = get().episodes[key];
    if (!current) return;
    get().setEpisode(key, {
      ...current,
      status: AUDIO_STATUS.COMPLETED,
      progress: null,
      result,
    });
  },

  markCancelled: (key) => {
    const current = get().episodes[key];
    if (!current) return;
    get().setEpisode(key, {
      ...current,
      status: AUDIO_STATUS.CANCELLED,
      progress: null,
    });
  },

  markError: (key, message) => {
    const current = get().episodes[key];
    if (!current) return;
    get().setEpisode(key, {
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
  cancel: async (key) => {
    const current = get().episodes[key];
    if (!current?.taskId) return;
    await cancelAudioOverview(current.taskId);
  },

  /**
   * Delete an episode server-side, then locally.
   *
   * Order matters: a 409 (still running) must leave the local row alone, or
   * the user loses their only handle on a task that is still burning GPU.
   */
  remove: async (key) => {
    const current = get().episodes[key];
    if (!current) return;
    if (current.taskId && current.status !== AUDIO_STATUS.ERROR) {
      await deleteAudioOverview(current.taskId);
    }
    get().setEpisode(key, null);
    if (get().openKey === key) set({ openKey: null });
  },
}));

export default useAudioOverviewStore;
