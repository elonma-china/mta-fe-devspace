import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import MicButton from "../MicButton";
import { RECORDER_STATE } from "hooks/useVoiceRecorder";
import { transcribeVoice } from "../../api/stt";

jest.mock("hooks/useVoiceRecorder", () => {
  const actual = jest.requireActual("hooks/useVoiceRecorder");
  return { ...actual, useVoiceRecorder: jest.fn() };
});
jest.mock("../../api/stt", () => ({
  ...jest.requireActual("../../api/stt"),
  transcribeVoice: jest.fn(),
}));

const { useVoiceRecorder } = require("hooks/useVoiceRecorder");

/** Drive the component's recorder without touching real audio APIs. */
function mockRecorder(overrides = {}) {
  const api = {
    state: RECORDER_STATE.IDLE,
    elapsedSeconds: 0,
    error: null,
    isSupported: true,
    start: jest.fn(),
    stop: jest.fn(),
    cancel: jest.fn(),
    reset: jest.fn(),
    ...overrides,
  };
  useVoiceRecorder.mockImplementation(({ onComplete } = {}) => {
    api.onComplete = onComplete;
    return api;
  });
  return api;
}

beforeEach(() => {
  jest.clearAllMocks();
});

/** Deliver a finished recording the way the hook would, inside act(). */
const deliverRecording = (recorder) =>
  act(async () => {
    await recorder.onComplete(new Blob(["x"], { type: "audio/wav" }));
  });

test("clicking the idle button starts recording", async () => {
  const recorder = mockRecorder();
  render(<MicButton onTranscribed={jest.fn()} />);

  await userEvent.click(screen.getByRole("button", { name: /ghi âm/i }));
  expect(recorder.start).toHaveBeenCalled();
});

test("clicking while recording stops, and the timer is shown", async () => {
  const recorder = mockRecorder({
    state: RECORDER_STATE.RECORDING,
    elapsedSeconds: 65,
  });
  render(<MicButton onTranscribed={jest.fn()} />);

  expect(screen.getByRole("timer")).toHaveTextContent("01:05");
  const button = screen.getByRole("button");
  expect(button).toHaveAttribute("aria-pressed", "true");

  await userEvent.click(button);
  expect(recorder.stop).toHaveBeenCalled();
});

test("a completed recording is transcribed and handed over as text", async () => {
  const recorder = mockRecorder();
  const onTranscribed = jest.fn();
  transcribeVoice.mockResolvedValue({ text: "  xin chào  " });

  render(<MicButton onTranscribed={onTranscribed} />);
  await deliverRecording(recorder);

  await waitFor(() => expect(onTranscribed).toHaveBeenCalledWith("xin chào"));
});

test("never calls back when the transcript is empty", async () => {
  const recorder = mockRecorder();
  const onTranscribed = jest.fn();
  transcribeVoice.mockResolvedValue({ text: "   " });

  render(<MicButton onTranscribed={onTranscribed} />);
  await deliverRecording(recorder);

  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(/không nghe được/i)
  );
  expect(onTranscribed).not.toHaveBeenCalled();
});

test("an upstream 503 becomes a specific message, not a generic failure", async () => {
  const recorder = mockRecorder();
  const err = new Error("HTTP 503");
  err.status = 503;
  transcribeVoice.mockRejectedValue(err);

  render(<MicButton onTranscribed={jest.fn()} />);
  await deliverRecording(recorder);

  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      /chưa sẵn sàng/i
    )
  );
});

test("an insecure context disables the button and says why", () => {
  // The Dev Space is reached over plain HTTP by default, so this is the
  // first thing most users will hit — it must not look like a dead button.
  mockRecorder({
    isSupported: false,
    state: RECORDER_STATE.ERROR,
    error: "Trình duyệt chỉ cho dùng micro trên HTTPS hoặc localhost.",
  });
  render(<MicButton onTranscribed={jest.fn()} />);

  const button = screen.getByRole("button");
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("title", expect.stringMatching(/HTTPS/));
  expect(screen.getByRole("alert")).toHaveTextContent(/HTTPS|localhost/);
});

test("is disabled while the chat is disabled", () => {
  mockRecorder();
  render(<MicButton onTranscribed={jest.fn()} disabled />);
  expect(screen.getByRole("button")).toBeDisabled();
});
