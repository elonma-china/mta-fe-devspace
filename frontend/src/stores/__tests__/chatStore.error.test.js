// src/stores/__tests__/chatStore.error.test.js
//
// Story 36 (B): when the AI stream ends with an error event (e.g. the summary
// tool returns {type:"error", message:"... 503 Loading model", is_final:true}),
// the chat must SHOW the error instead of silently rendering nothing ("thinking
// then blank"). Normal answers must still render (regression).
import useChatStore from "stores/useChatStore";
import { streamQuery } from "features/chat/api/llm";
import { parseSSE } from "utils/sse";

jest.mock("features/chat/api/llm", () => ({ streamQuery: jest.fn() }));
jest.mock("features/chat/api", () => ({
  getConversation: jest.fn(),
  appendConversationMessage: jest.fn().mockResolvedValue({}),
  listConversations: jest.fn(),
  createConversation: jest.fn(),
  deleteConversation: jest.fn(),
  renameConversation: jest.fn(),
}));
jest.mock("utils/sse", () => ({ parseSSE: jest.fn() }));

// parseSSE is an async generator over the response; fake it from an array.
function fakeSSE(events) {
  return (async function* () {
    for (const e of events) yield e;
  })();
}

beforeEach(() => {
  jest.clearAllMocks();
  streamQuery.mockResolvedValue({});
  useChatStore.setState({ messages: [], isStreaming: false, error: null });
});

test("chatStore_send_errorEvent_showsErrorNotInBlank", async () => {
  parseSSE.mockReturnValue(
    fakeSSE([
      { type: "progress", message: "Đang phân tích...", is_final: false },
      {
        type: "error",
        message: "Lỗi khi tóm tắt: Error code: 503 - Loading model",
        is_final: true,
      },
    ])
  );

  await useChatStore.getState().send("tóm tắt tài liệu", {
    userId: "u1",
    conversationId: "c1",
    documentIds: [],
  });

  const s = useChatStore.getState();
  const last = s.messages[s.messages.length - 1];
  // The AI error message must be surfaced to the user (not a silent blank).
  expect(last.content).toBeTruthy();
  expect(last.content).toContain("503");
  expect(s.isStreaming).toBe(false);
});

test("chatStore_send_normalChunks_rendersContent_noRegression", async () => {
  parseSSE.mockReturnValue(
    fakeSSE([
      { chunk: "Xin", is_final: false },
      { chunk: " chào", is_final: false },
      { chunk: "", is_final: true, sources: [] },
    ])
  );

  await useChatStore.getState().send("chào", {
    userId: "u1",
    conversationId: "c1",
    documentIds: [],
  });

  const s = useChatStore.getState();
  const last = s.messages[s.messages.length - 1];
  expect(last.content).toBe("Xin chào");
  expect(s.isStreaming).toBe(false);
});

test("chatStore_send_emptyStreamNoFinal_showsNotice", async () => {
  // Stream ends with only progress, no content/sources/error → still not blank.
  parseSSE.mockReturnValue(
    fakeSSE([{ type: "progress", message: "Đang tìm kiếm...", is_final: false }])
  );

  await useChatStore.getState().send("hỏi gì đó", {
    userId: "u1",
    conversationId: "c1",
    documentIds: [],
  });

  const s = useChatStore.getState();
  const last = s.messages[s.messages.length - 1];
  expect(last.content).toBeTruthy();
  expect(s.isStreaming).toBe(false);
});
