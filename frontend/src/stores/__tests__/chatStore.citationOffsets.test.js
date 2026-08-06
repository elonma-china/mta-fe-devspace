// src/stores/__tests__/chatStore.citationOffsets.test.js
//
// The store rebuilds each streamed source into the shape the UI keeps, and its
// rebuild kept only `enriched_content`. Two things were dropped that the viewer
// needs to highlight accurately:
//
//   - `content` — the retrieved chunk. `enriched_content` is that chunk plus its
//     neighbours, so bounding the highlight by the window marks far more of the
//     page than the citation covers.
//   - `char_start`/`char_end` — where the chunk sits in the document's source
//     text. With them the viewer marks an exact range; without them it is back
//     to matching text against the digitized page.
//
// The AI already streams all three (verified against the live final frame), so
// this is purely about not discarding them on the way in.

import useChatStore from "stores/useChatStore";
import { streamQuery } from "features/chat/api/llm";
import { appendConversationMessage } from "features/chat/api";
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

function fakeSSE(events) {
  return (async function* () {
    for (const e of events) yield e;
  })();
}

async function sendWithSource(source) {
  parseSSE.mockReturnValue(
    fakeSSE([
      { chunk: "Trả lời", is_final: false },
      { chunk: "", is_final: true, sources: [source] },
    ])
  );
  await useChatStore.getState().send("hỏi", {
    userId: "u1",
    conversationId: "c1",
    documentIds: ["d1"],
  });
  const s = useChatStore.getState();
  return s.messages[s.messages.length - 1].sources[0];
}

beforeEach(() => {
  jest.clearAllMocks();
  streamQuery.mockResolvedValue({});
  useChatStore.setState({ messages: [], isStreaming: false, error: null });
});

test("chatStore_send_sourceWithContentAndOffsets_keepsThem", async () => {
  const kept = await sendWithSource({
    document_id: "d1",
    content: "Điều 5. Nguyên tắc áp dụng.",
    enriched_content: "…trước… Điều 5. Nguyên tắc áp dụng. …sau…",
    char_start: 1200,
    char_end: 1227,
    metadata: { page_number: 3 },
  });

  expect(kept.content).toBe("Điều 5. Nguyên tắc áp dụng.");
  expect(kept.char_start).toBe(1200);
  expect(kept.char_end).toBe(1227);
  // The window is still kept — it drives the source-card preview.
  expect(kept.enriched_content).toBe("…trước… Điều 5. Nguyên tắc áp dụng. …sau…");
});

test("chatStore_send_sourceWithContentAndOffsets_persistsThem", async () => {
  await sendWithSource({
    document_id: "d1",
    content: "đoạn được trích",
    enriched_content: "cửa sổ quanh đoạn được trích",
    char_start: 10,
    char_end: 25,
    metadata: { page_number: 1 },
  });

  const [, , body] = appendConversationMessage.mock.calls[0];
  expect(body.sources[0]).toMatchObject({
    content: "đoạn được trích",
    char_start: 10,
    char_end: 25,
  });
});

test("chatStore_send_sourceWithoutOffsets_omitsTheKeys", async () => {
  const kept = await sendWithSource({
    document_id: "d1",
    enriched_content: "nội dung nguồn",
    metadata: { page_number: 3 },
  });

  expect(kept.char_start).toBeUndefined();
  expect(kept.char_end).toBeUndefined();
  expect(kept.enriched_content).toBe("nội dung nguồn");
});

test("chatStore_send_sourceWithZeroCharStart_keepsIt", async () => {
  // A chunk at the very start of the document — 0 is a real offset, not absent.
  const kept = await sendWithSource({
    document_id: "d1",
    content: "mở đầu",
    enriched_content: "mở đầu và phần tiếp theo",
    char_start: 0,
    char_end: 6,
    metadata: { page_number: 1 },
  });

  expect(kept.char_start).toBe(0);
  expect(kept.char_end).toBe(6);
});
