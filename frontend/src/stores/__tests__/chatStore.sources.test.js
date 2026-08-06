// src/stores/__tests__/chatStore.sources.test.js
//
// Regression: chat sources must resolve a page number from the canonical
// `metadata.page_number` field (written by all backend chunkers), not just
// the legacy `metadata.original_page_number` key that some chunkers never
// set — otherwise the page label silently goes blank for semantic/hybrid
// chunked documents even though the backend has the page number.
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

test("chatStore_send_sourceWithOnlyPageNumber_resolvesPage", async () => {
  parseSSE.mockReturnValue(
    fakeSSE([
      { chunk: "Trả lời", is_final: false },
      {
        chunk: "",
        is_final: true,
        sources: [
          {
            document_id: "d1",
            enriched_content: "nội dung nguồn",
            metadata: { page_number: 3 }, // semantic/hybrid chunker: no original_page_number
          },
        ],
      },
    ])
  );

  await useChatStore.getState().send("hỏi", {
    userId: "u1",
    conversationId: "c1",
    documentIds: ["d1"],
  });

  const s = useChatStore.getState();
  const last = s.messages[s.messages.length - 1];
  expect(last.sources).toHaveLength(1);
  expect(last.sources[0].metadata.page_number).toBe(3);
});

test("chatStore_send_sourceWithOnlyLegacyOriginalPageNumber_stillResolvesPage", async () => {
  parseSSE.mockReturnValue(
    fakeSSE([
      { chunk: "Trả lời", is_final: false },
      {
        chunk: "",
        is_final: true,
        sources: [
          {
            document_id: "d1",
            enriched_content: "nội dung nguồn",
            metadata: { original_page_number: 5 }, // sentence/recursive chunker legacy key
          },
        ],
      },
    ])
  );

  await useChatStore.getState().send("hỏi", {
    userId: "u1",
    conversationId: "c1",
    documentIds: ["d1"],
  });

  const s = useChatStore.getState();
  const last = s.messages[s.messages.length - 1];
  expect(last.sources).toHaveLength(1);
  expect(last.sources[0].metadata.page_number).toBe(5);
});

test("chatStore_send_sourceWithOnlyLegacyPageKey_stillResolvesPage", async () => {
  // Pre-migration semantic/hybrid chunked documents only carry `metadata.page`
  // (not page_number nor original_page_number) — must still resolve.
  parseSSE.mockReturnValue(
    fakeSSE([
      { chunk: "Trả lời", is_final: false },
      {
        chunk: "",
        is_final: true,
        sources: [
          {
            document_id: "d1",
            enriched_content: "nội dung nguồn",
            metadata: { page: 7 },
          },
        ],
      },
    ])
  );

  await useChatStore.getState().send("hỏi", {
    userId: "u1",
    conversationId: "c1",
    documentIds: ["d1"],
  });

  const s = useChatStore.getState();
  const last = s.messages[s.messages.length - 1];
  expect(last.sources).toHaveLength(1);
  expect(last.sources[0].metadata.page_number).toBe(7);
});

// Cross-page citation fix: a window-enriched source can span more than one
// page (context_metadata.page_segments), so the highlighted content isn't
// always fully contained on the single `metadata.page_number` page.
test("chatStore_send_sourceWithPageSegments_keepsContextMetadataPageSegments", async () => {
  parseSSE.mockReturnValue(
    fakeSSE([
      { chunk: "Trả lời", is_final: false },
      {
        chunk: "",
        is_final: true,
        sources: [
          {
            document_id: "d1",
            enriched_content: "nội dung nguồn",
            metadata: { page_number: 5 },
            context_metadata: {
              merged: true,
              merged_chunk_count: 2,
              page_segments: [
                { page_number: 5, text: "A" },
                { page_number: 6, text: "B" },
              ],
            },
          },
        ],
      },
    ])
  );

  await useChatStore.getState().send("hỏi", {
    userId: "u1",
    conversationId: "c1",
    documentIds: ["d1"],
  });

  const s = useChatStore.getState();
  const last = s.messages[s.messages.length - 1];
  // Narrowed to just page_segments — merged/merged_chunk_count/etc. dropped,
  // same "keep only what the UI needs" philosophy as the other fields here.
  expect(last.sources[0].context_metadata).toEqual({
    page_segments: [
      { page_number: 5, text: "A" },
      { page_number: 6, text: "B" },
    ],
  });
});

test("chatStore_send_sourceWithoutContextMetadata_omitsContextMetadataKey", async () => {
  parseSSE.mockReturnValue(
    fakeSSE([
      { chunk: "Trả lời", is_final: false },
      {
        chunk: "",
        is_final: true,
        sources: [
          {
            document_id: "d1",
            enriched_content: "nội dung nguồn",
            metadata: { page_number: 3 },
          },
        ],
      },
    ])
  );

  await useChatStore.getState().send("hỏi", {
    userId: "u1",
    conversationId: "c1",
    documentIds: ["d1"],
  });

  const s = useChatStore.getState();
  const last = s.messages[s.messages.length - 1];
  expect(last.sources[0].context_metadata).toBeUndefined();
});

test("chatStore_send_sourceWithEmptyPageSegmentsArray_omitsContextMetadataKey", async () => {
  parseSSE.mockReturnValue(
    fakeSSE([
      { chunk: "Trả lời", is_final: false },
      {
        chunk: "",
        is_final: true,
        sources: [
          {
            document_id: "d1",
            enriched_content: "nội dung nguồn",
            metadata: { page_number: 3 },
            context_metadata: { page_segments: [] },
          },
        ],
      },
    ])
  );

  await useChatStore.getState().send("hỏi", {
    userId: "u1",
    conversationId: "c1",
    documentIds: ["d1"],
  });

  const s = useChatStore.getState();
  const last = s.messages[s.messages.length - 1];
  expect(last.sources[0].context_metadata).toBeUndefined();
});

test("chatStore_send_sourceWithNonArrayPageSegments_omitsContextMetadataKey", async () => {
  parseSSE.mockReturnValue(
    fakeSSE([
      { chunk: "Trả lời", is_final: false },
      {
        chunk: "",
        is_final: true,
        sources: [
          {
            document_id: "d1",
            enriched_content: "nội dung nguồn",
            metadata: { page_number: 3 },
            context_metadata: { page_segments: "oops" },
          },
        ],
      },
    ])
  );

  await useChatStore.getState().send("hỏi", {
    userId: "u1",
    conversationId: "c1",
    documentIds: ["d1"],
  });

  const s = useChatStore.getState();
  const last = s.messages[s.messages.length - 1];
  expect(last.sources[0].context_metadata).toBeUndefined();
});
