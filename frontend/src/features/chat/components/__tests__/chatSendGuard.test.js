import {
  isSelectionRequired,
  resolveSendDocIds,
} from "features/chat/components/chatSendGuard";

// Story 134: unchecking every document must block the ask — the AI may only
// answer from explicitly selected documents. These pure helpers hold the
// decision so it unit-tests without rendering ChatInterface (ADR-008: the
// component pulls the `features/documents/components` barrel, unrenderable
// under CRA5 Jest).
describe("chatSendGuard", () => {
  describe("isSelectionRequired", () => {
    test("docsPresent_noneSelected_true", () => {
      // The conversation has documents but the user picked none → block.
      expect(isSelectionRequired(2, 0)).toBe(true);
    });

    test("docsPresent_someSelected_false", () => {
      expect(isSelectionRequired(2, 1)).toBe(false);
      expect(isSelectionRequired(2, 2)).toBe(false);
    });

    test("noDocsAtAll_false_generalChatAllowed", () => {
      // A conversation with zero documents (general chat) is not blocked.
      expect(isSelectionRequired(0, 0)).toBe(false);
    });
  });

  describe("resolveSendDocIds", () => {
    test("noOverride_returnsSelectionExactly_noFallbackToAll", () => {
      // The old fallback replaced an empty selection with ALL docs — removed.
      expect(resolveSendDocIds(null, ["d1", "d2"])).toEqual(["d1", "d2"]);
      expect(resolveSendDocIds(null, [])).toEqual([]);
    });

    test("override_wins_forAnalysisAndComposeFlows", () => {
      // An explicit override (im-compose / analysis) bypasses the selection.
      expect(resolveSendDocIds(["x"], ["d1"])).toEqual(["x"]);
      expect(resolveSendDocIds(["x"], [])).toEqual(["x"]);
    });

    test("emptyOverride_treatedAsNoOverride", () => {
      // An empty-array override is not a real override → fall back to selection.
      expect(resolveSendDocIds([], ["d1"])).toEqual(["d1"]);
    });
  });
});
