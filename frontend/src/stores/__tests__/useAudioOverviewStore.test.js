import useAudioOverviewStore, {
  classifyStatus,
  progressLabel,
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
  useAudioOverviewStore.setState({ episodes: {}, openConvId: null });

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
  test("sends only the fields that were provided", async () => {
    submitAudioOverview.mockResolvedValue({ task_id: "t-1" });

    await useAudioOverviewStore.getState().submit({
      conversationId: 7,
      documentIds: ["d1", "d2"],
      language: "vi",
      targetMinutes: 3,
      name: "Podcast",
    });

    expect(submitAudioOverview).toHaveBeenCalledWith({
      language: "vi",
      target_minutes: 3,
      document_ids: ["d1", "d2"],
    });
  });

  test("records the episode as processing and persists it", async () => {
    submitAudioOverview.mockResolvedValue({ task_id: "t-1" });

    await useAudioOverviewStore.getState().submit({
      conversationId: 7,
      documentIds: ["d1"],
      language: "vi",
      focus: "kết luận",
      targetMinutes: 5,
      name: "Podcast",
    });

    const episode = useAudioOverviewStore.getState().episodes[7];
    expect(episode.taskId).toBe("t-1");
    expect(episode.status).toBe(AUDIO_STATUS.PROCESSING);
    expect(submitAudioOverview.mock.calls[0][0].focus).toBe("kết luận");
    expect(
      JSON.parse(window.localStorage.getItem("im.audioOverview.7")).taskId
    ).toBe("t-1");
  });
});

describe("hydrate", () => {
  test("restores an in-flight task after a reload", async () => {
    window.localStorage.setItem(
      "im.audioOverview.7",
      JSON.stringify({ taskId: "t-1", status: AUDIO_STATUS.PROCESSING })
    );
    useAudioOverviewStore.getState().hydrate(7);
    expect(useAudioOverviewStore.getState().episodes[7].taskId).toBe("t-1");
  });

  test("never clobbers live state with a stale snapshot", async () => {
    useAudioOverviewStore.setState({
      episodes: { 7: { taskId: "live", status: AUDIO_STATUS.COMPLETED } },
    });
    window.localStorage.setItem(
      "im.audioOverview.7",
      JSON.stringify({ taskId: "stale" })
    );
    useAudioOverviewStore.getState().hydrate(7);
    expect(useAudioOverviewStore.getState().episodes[7].taskId).toBe("live");
  });

  test("survives corrupt storage", () => {
    window.localStorage.setItem("im.audioOverview.7", "{not json");
    expect(() => useAudioOverviewStore.getState().hydrate(7)).not.toThrow();
  });
});

describe("cancel", () => {
  test("does not claim cancellation the service has not confirmed", async () => {
    // Cancellation is cooperative. Flipping local state here would hide a
    // task that is still running.
    cancelAudioOverview.mockResolvedValue({ status: "cancel_requested" });
    useAudioOverviewStore.setState({
      episodes: { 7: { taskId: "t-1", status: AUDIO_STATUS.PROCESSING } },
    });

    await useAudioOverviewStore.getState().cancel(7);

    expect(cancelAudioOverview).toHaveBeenCalledWith("t-1");
    expect(useAudioOverviewStore.getState().episodes[7].status).toBe(
      AUDIO_STATUS.PROCESSING
    );
  });
});

describe("remove", () => {
  test("clears the episode and its storage after a successful delete", async () => {
    deleteAudioOverview.mockResolvedValue({ deleted: true });
    useAudioOverviewStore.setState({
      episodes: { 7: { taskId: "t-1", status: AUDIO_STATUS.COMPLETED } },
      openConvId: 7,
    });

    await useAudioOverviewStore.getState().remove(7);

    expect(useAudioOverviewStore.getState().episodes[7]).toBeUndefined();
    expect(useAudioOverviewStore.getState().openConvId).toBeNull();
    expect(window.localStorage.getItem("im.audioOverview.7")).toBeNull();
  });

  test("a 409 leaves the episode alone", async () => {
    // Dropping the row on a refused delete would lose the user's only handle
    // on a task that is still consuming GPU.
    const err = new Error("running");
    err.status = 409;
    deleteAudioOverview.mockRejectedValue(err);
    useAudioOverviewStore.setState({
      episodes: { 7: { taskId: "t-1", status: AUDIO_STATUS.PROCESSING } },
    });

    await expect(useAudioOverviewStore.getState().remove(7)).rejects.toThrow();
    expect(useAudioOverviewStore.getState().episodes[7]).toBeDefined();
  });

  test("a failed episode is dropped without calling the service", async () => {
    useAudioOverviewStore.setState({
      episodes: { 7: { taskId: "t-1", status: AUDIO_STATUS.ERROR } },
    });
    await useAudioOverviewStore.getState().remove(7);
    expect(deleteAudioOverview).not.toHaveBeenCalled();
    expect(useAudioOverviewStore.getState().episodes[7]).toBeUndefined();
  });
});

describe("markProgress", () => {
  test("ignores ticks arriving after a terminal state", () => {
    useAudioOverviewStore.setState({
      episodes: { 7: { taskId: "t-1", status: AUDIO_STATUS.COMPLETED } },
    });
    useAudioOverviewStore.getState().markProgress(7, { note: "tts 1/9" });
    expect(useAudioOverviewStore.getState().episodes[7].progress).toBeUndefined();
  });
});
