import useAudioOverviewStore, {
  classifyStatus,
  progressLabel,
  episodeKey,
  AUDIO_MODE,
  AUDIO_STATUS,
} from "../useAudioOverviewStore";
import {
  submitAudioOverview,
  cancelAudioOverview,
  deleteAudioOverview,
} from "features/analysis/api/audioOverview";

jest.mock("features/analysis/api/audioOverview", () => ({
  submitAudioOverview: jest.fn(),
  cancelAudioOverview: jest.fn(),
  deleteAudioOverview: jest.fn(),
}));

const reset = () =>
  useAudioOverviewStore.setState({ episodes: {}, openKey: null });

/** Episodes are keyed by conversation AND mode. */
const POD = episodeKey(7, AUDIO_MODE.PODCAST);
const NAR = episodeKey(7, AUDIO_MODE.NARRATION);
const POD_STORE = `im.audioOverview.${POD}`;

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  reset();
});

describe("classifyStatus — the two poll traps", () => {
  test("a finished episode has no status field and is still complete", () => {
    // This is the shape that makes passing `startTime` fatal: the gateway's
    // zombie check reads a status-less body as stuck.
    const done = { task_id: "t", object_key: "k", transcript: [] };
    expect(classifyStatus(done)).toEqual({
      state: AUDIO_STATUS.COMPLETED,
      result: done,
    });
  });

  test('"cancelled" is terminal, though useTaskPoller matches neither branch', () => {
    // useTaskPoller maps only SUCCESS/COMPLETED and FAILURE/FAILED/ERROR.
    // "cancelled" is neither and is not falsy, so without this it polls
    // forever.
    expect(classifyStatus({ status: "cancelled" })).toEqual({
      state: AUDIO_STATUS.CANCELLED,
    });
  });

  test("a processing payload keeps polling", () => {
    expect(
      classifyStatus({ status: "processing", progress: { note: "script" } })
    ).toBeNull();
  });

  test("a processing payload is not mistaken for a finished one", () => {
    // It is a non-empty object with no terminal state — exactly the shape
    // useTaskPoller would call complete. Requiring object_key is what stops
    // an in-flight episode rendering as a broken player.
    expect(classifyStatus({ task_id: "t", progress: null })).toBeNull();
  });

  test("explicit failures are terminal", () => {
    expect(classifyStatus({ status: "FAILURE" }).state).toBe(
      AUDIO_STATUS.ERROR
    );
  });

  test("junk does not crash the poller", () => {
    expect(classifyStatus(null)).toBeNull();
    expect(classifyStatus("nope")).toBeNull();
  });
});

describe("progressLabel", () => {
  test("prefers the service's own note", () => {
    expect(progressLabel({ note: "tts 7/23", done: 7, total: 23 })).toBe(
      "tts 7/23"
    );
  });

  test("falls back to counts", () => {
    expect(progressLabel({ done: 3, total: 9 })).toBe("3/9");
  });

  test("says nothing rather than showing 0/0", () => {
    // A 0/0 bar reads as stalled during the script phase, which is the
    // longest part of the run.
    expect(progressLabel(null)).toBeNull();
    expect(progressLabel({})).toBeNull();
    expect(progressLabel({ done: 0, total: 0 })).toBeNull();
  });
});

describe("submit", () => {
  test("sends the mode, voice and tone with the episode", async () => {
    submitAudioOverview.mockResolvedValue({ task_id: "t-1" });

    await useAudioOverviewStore.getState().submit({
      conversationId: 7,
      mode: AUDIO_MODE.PODCAST,
      documentIds: ["d1", "d2"],
      voiceGender: "male",
      tone: "soi_noi",
      length: "default",
      name: "Podcast",
    });

    expect(submitAudioOverview).toHaveBeenCalledWith({
      language: "vi",
      mode: "podcast",
      voice_gender: "male",
      tone: "soi_noi",
      length: "default",
      document_ids: ["d1", "d2"],
      conversation_id: "7",
    });
  });

  test("gửi conversation_id để tập thuộc đúng phiên chat", async () => {
    // Thiếu trường này thì tập rơi vào thư mục "no-session" trên MinIO và
    // trace không gom được theo hội thoại — đo được đúng vậy trên hệ thống
    // thật trước khi thêm. Gửi trong BODY vì gateway chỉ chuyển tiếp body.
    submitAudioOverview.mockResolvedValue({ task_id: "t-1" });

    await useAudioOverviewStore.getState().submit({
      conversationId: 42,
      mode: AUDIO_MODE.NARRATION,
      documentIds: ["d1"],
      voiceGender: "male",
      tone: "tu_nhien",
      length: "default",
      name: "Bản đọc",
    });

    expect(submitAudioOverview.mock.calls[0][0].conversation_id).toBe("42");
  });

  test("a podcast sends focus and never instruction", async () => {
    // Crossing them is a 400 on the service, not a silent no-op.
    submitAudioOverview.mockResolvedValue({ task_id: "t-1" });
    await useAudioOverviewStore.getState().submit({
      conversationId: 7,
      mode: AUDIO_MODE.PODCAST,
      documentIds: ["d1"],
      voiceGender: "female",
      tone: "tu_nhien",
      focus: "kết luận",
      instruction: "không nên gửi",
      length: "default",
      name: "Podcast",
    });
    const payload = submitAudioOverview.mock.calls[0][0];
    expect(payload.focus).toBe("kết luận");
    expect(payload.instruction).toBeUndefined();
  });

  test("a narration sends instruction and never focus", async () => {
    submitAudioOverview.mockResolvedValue({ task_id: "t-2" });
    await useAudioOverviewStore.getState().submit({
      conversationId: 7,
      mode: AUDIO_MODE.NARRATION,
      documentIds: ["d1"],
      voiceGender: "female",
      tone: "trang_trong",
      focus: "không nên gửi",
      instruction: "chỉ nói phần kiến nghị",
      length: "default",
      name: "Bản đọc",
    });
    const payload = submitAudioOverview.mock.calls[0][0];
    expect(payload.instruction).toBe("chỉ nói phần kiến nghị");
    expect(payload.focus).toBeUndefined();
  });

  test("records the episode under its mode key and persists it", async () => {
    submitAudioOverview.mockResolvedValue({ task_id: "t-1" });

    await useAudioOverviewStore.getState().submit({
      conversationId: 7,
      mode: AUDIO_MODE.PODCAST,
      documentIds: ["d1"],
      voiceGender: "male",
      tone: "tu_nhien",
      length: "default",
      name: "Podcast",
    });

    const episode = useAudioOverviewStore.getState().episodes[POD];
    expect(episode.taskId).toBe("t-1");
    expect(episode.status).toBe(AUDIO_STATUS.PROCESSING);
    expect(episode.mode).toBe("podcast");
    expect(JSON.parse(window.localStorage.getItem(POD_STORE)).taskId).toBe("t-1");
  });

  test("a podcast and a narration coexist in one conversation", async () => {
    // The point of keying by mode: the two answer different questions, so
    // making a reading force you to delete your podcast is an artificial limit.
    submitAudioOverview.mockResolvedValueOnce({ task_id: "pod" });
    submitAudioOverview.mockResolvedValueOnce({ task_id: "nar" });
    const base = {
      conversationId: 7,
      documentIds: ["d1"],
      voiceGender: "male",
      tone: "tu_nhien",
      length: "default",
      name: "x",
    };
    await useAudioOverviewStore.getState().submit({ ...base, mode: AUDIO_MODE.PODCAST });
    await useAudioOverviewStore.getState().submit({ ...base, mode: AUDIO_MODE.NARRATION });

    const { episodes } = useAudioOverviewStore.getState();
    expect(episodes[POD].taskId).toBe("pod");
    expect(episodes[NAR].taskId).toBe("nar");
  });
});

describe("hydrate", () => {
  test("restores an in-flight task after a reload", async () => {
    window.localStorage.setItem(
      POD_STORE,
      JSON.stringify({ taskId: "t-1", status: AUDIO_STATUS.PROCESSING })
    );
    useAudioOverviewStore.getState().hydrate(7);
    expect(useAudioOverviewStore.getState().episodes[POD].taskId).toBe("t-1");
  });

  test("restores both modes independently", async () => {
    window.localStorage.setItem(
      POD_STORE,
      JSON.stringify({ taskId: "pod", status: AUDIO_STATUS.COMPLETED })
    );
    window.localStorage.setItem(
      `im.audioOverview.${NAR}`,
      JSON.stringify({ taskId: "nar", status: AUDIO_STATUS.PROCESSING })
    );
    useAudioOverviewStore.getState().hydrate(7);
    const { episodes } = useAudioOverviewStore.getState();
    expect(episodes[POD].taskId).toBe("pod");
    expect(episodes[NAR].taskId).toBe("nar");
  });

  test("migrates a pre-mode key onto the podcast slot", () => {
    // An episode can take 45 minutes and this key is its only handle. Renaming
    // the key without moving the value would strand a running job: invisible,
    // uncancellable, still rendering.
    window.localStorage.setItem(
      "im.audioOverview.7",
      JSON.stringify({ taskId: "legacy", status: AUDIO_STATUS.PROCESSING })
    );
    useAudioOverviewStore.getState().hydrate(7);

    expect(useAudioOverviewStore.getState().episodes[POD].taskId).toBe("legacy");
    expect(JSON.parse(window.localStorage.getItem(POD_STORE)).taskId).toBe("legacy");
    expect(window.localStorage.getItem("im.audioOverview.7")).toBeNull();
  });

  test("migration never overwrites an episode already on the new key", () => {
    window.localStorage.setItem(POD_STORE, JSON.stringify({ taskId: "new" }));
    window.localStorage.setItem(
      "im.audioOverview.7",
      JSON.stringify({ taskId: "legacy" })
    );
    useAudioOverviewStore.getState().hydrate(7);
    expect(useAudioOverviewStore.getState().episodes[POD].taskId).toBe("new");
  });

  test("never clobbers live state with a stale snapshot", async () => {
    useAudioOverviewStore.setState({
      episodes: { [POD]: { taskId: "live", status: AUDIO_STATUS.COMPLETED } },
    });
    window.localStorage.setItem(POD_STORE, JSON.stringify({ taskId: "stale" }));
    useAudioOverviewStore.getState().hydrate(7);
    expect(useAudioOverviewStore.getState().episodes[POD].taskId).toBe("live");
  });

  test("survives corrupt storage", () => {
    window.localStorage.setItem(POD_STORE, "{not json");
    expect(() => useAudioOverviewStore.getState().hydrate(7)).not.toThrow();
  });
});

describe("cancel", () => {
  test("does not claim cancellation the service has not confirmed", async () => {
    // Cancellation is cooperative. Flipping local state here would hide a
    // task that is still running.
    cancelAudioOverview.mockResolvedValue({ status: "cancel_requested" });
    useAudioOverviewStore.setState({
      episodes: { [POD]: { taskId: "t-1", status: AUDIO_STATUS.PROCESSING } },
    });

    await useAudioOverviewStore.getState().cancel(POD);

    expect(cancelAudioOverview).toHaveBeenCalledWith("t-1");
    expect(useAudioOverviewStore.getState().episodes[POD].status).toBe(
      AUDIO_STATUS.PROCESSING
    );
  });
});

describe("remove", () => {
  test("clears the episode and its storage after a successful delete", async () => {
    deleteAudioOverview.mockResolvedValue({ deleted: true });
    useAudioOverviewStore.setState({
      episodes: { [POD]: { taskId: "t-1", status: AUDIO_STATUS.COMPLETED } },
      openKey: POD,
    });

    await useAudioOverviewStore.getState().remove(POD);

    expect(useAudioOverviewStore.getState().episodes[POD]).toBeUndefined();
    expect(useAudioOverviewStore.getState().openKey).toBeNull();
    expect(window.localStorage.getItem(POD_STORE)).toBeNull();
  });

  test("a 409 leaves the episode alone", async () => {
    // Dropping the row on a refused delete would lose the user's only handle
    // on a task that is still consuming GPU.
    const err = new Error("running");
    err.status = 409;
    deleteAudioOverview.mockRejectedValue(err);
    useAudioOverviewStore.setState({
      episodes: { [POD]: { taskId: "t-1", status: AUDIO_STATUS.PROCESSING } },
    });

    await expect(
      useAudioOverviewStore.getState().remove(POD)
    ).rejects.toThrow();
    expect(useAudioOverviewStore.getState().episodes[POD]).toBeDefined();
  });

  test("a failed episode is dropped without calling the service", async () => {
    useAudioOverviewStore.setState({
      episodes: { [POD]: { taskId: "t-1", status: AUDIO_STATUS.ERROR } },
    });
    await useAudioOverviewStore.getState().remove(POD);
    expect(deleteAudioOverview).not.toHaveBeenCalled();
    expect(useAudioOverviewStore.getState().episodes[POD]).toBeUndefined();
  });
});

describe("markProgress", () => {
  test("ignores ticks arriving after a terminal state", () => {
    useAudioOverviewStore.setState({
      episodes: { [POD]: { taskId: "t-1", status: AUDIO_STATUS.COMPLETED } },
    });
    useAudioOverviewStore.getState().markProgress(POD, { note: "tts 1/9" });
    expect(
      useAudioOverviewStore.getState().episodes[POD].progress
    ).toBeUndefined();
  });
});
