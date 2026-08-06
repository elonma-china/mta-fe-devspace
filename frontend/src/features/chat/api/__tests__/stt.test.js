import { transcribeVoice, sttErrorMessage } from "../stt";
import { apiClient } from "lib/apiClient";
import { API_PREFIX } from "config";

jest.mock("lib/apiClient", () => ({
  apiClient: { post: jest.fn() },
}));

beforeEach(() => jest.clearAllMocks());

test("sends multipart with the .wav filename the AI service gates on", async () => {
  // tools/stt.py rejects on the extension before decoding any audio, so an
  // anonymous blob is a 415 no matter how valid the WAV inside it is.
  apiClient.post.mockResolvedValue({ text: "ok" });
  const blob = new Blob(["RIFF"], { type: "audio/wav" });

  await transcribeVoice(blob, "en");

  const [endpoint, form, options] = apiClient.post.mock.calls[0];
  expect(endpoint).toBe("/stt/transcribe");
  expect(form).toBeInstanceOf(FormData);
  expect(form.get("file").name).toBe("voice.wav");
  expect(form.get("language")).toBe("en");
  expect(options.prefix).toBe(API_PREFIX.LLM);
});

test("defaults to Vietnamese", async () => {
  apiClient.post.mockResolvedValue({ text: "ok" });
  await transcribeVoice(new Blob(["x"]));
  expect(apiClient.post.mock.calls[0][1].get("language")).toBe("vi");
});

describe("sttErrorMessage", () => {
  test.each([
    [403, /đang tắt/i],
    [413, /quá dài/i],
    [415, /không được hỗ trợ/i],
    [422, /không đọc được/i],
    [503, /chưa sẵn sàng/i],
  ])("maps %i to its own message", (status, pattern) => {
    expect(sttErrorMessage({ status })).toMatch(pattern);
  });

  test("falls back for an unmapped status", () => {
    expect(sttErrorMessage({ status: 500 })).toMatch(/thử lại/i);
    expect(sttErrorMessage(undefined)).toMatch(/thử lại/i);
  });

  test("403 and 503 do not collapse into the same message", () => {
    // The gateway forwards upstream statuses verbatim specifically so these
    // stay distinguishable: one is "switched off", one is "retry later".
    expect(sttErrorMessage({ status: 403 })).not.toBe(
      sttErrorMessage({ status: 503 })
    );
  });
});
