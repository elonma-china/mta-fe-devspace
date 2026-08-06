// src/stores/useChatStore.js
import { create } from "zustand";
import { streamQuery } from "features/chat/api/llm";
import { 
  getConversation, 
  appendConversationMessage,
  listConversations,
  createConversation,
  deleteConversation,
  renameConversation
} from "features/chat/api";
import { parseSSE } from "utils/sse";
import { defaultConversationName } from "utils/helpers";
import { resolvePageNumber } from "utils/pageNumber";

/**
 * useChatStore
 * Centralized state for chat messages, conversations, and streaming.
 * Replaces useConversationStore and the old hybrid chat/ai hooks.
 */
const useChatStore = create((set, get) => ({
  // ── Conversation State ────────────────────────────────
  conversations: [],
  selectedConvId: null,
  convLoading: false,
  convLoaded: false,

  // ── Chat State ────────────────────────────────────────
  messages: [],           // Array<{ title, content, sources, thinkingHistory: [] }>
  hydratedConvId: null,   // Tracks which conversation the messages belong to
  isStreaming: false,
  error: null,

  // Internal — not consumed by UI
  _abortController: null,

  // ── Conversation Actions ──────────────────────────────

  fetchConversations: async (userId) => {
    if (!userId) return;
    set({ convLoading: true });
    try {
      const rows = await listConversations(userId);
      set({ conversations: rows || [], convLoading: false, convLoaded: true });
    } catch (err) {
      console.error("listConversations failed:", err);
      set({ conversations: [], convLoading: false, convLoaded: true });
    }
  },

  createConversation: async (userId, name = defaultConversationName()) => {
    const newConv = await createConversation(userId, { name });
    set((s) => ({ conversations: [newConv, ...s.conversations] }));
    return newConv;
  },

  deleteConversation: async (userId, convId) => {
    await deleteConversation(userId, convId);
    set((s) => ({
      conversations: s.conversations.filter(
        (c) => String(c.id) !== String(convId)
      ),
    }));
  },

  renameConversation: async (userId, convId, newName) => {
    await renameConversation(userId, convId, newName);
    set((s) => ({
      conversations: s.conversations.map((c) =>
        String(c.id) === String(convId) ? { ...c, name: newName } : c
      ),
    }));
  },

  pushConversation: (conv) => {
    set((s) => {
      if (s.conversations.some((c) => String(c.id) === String(conv.id))) {
        return s;
      }
      return { conversations: [conv, ...s.conversations] };
    });
  },

  switchConversation: (id) => set({ selectedConvId: id }),

  setSelectedConvId: (id) => set({ selectedConvId: id }),

  clearSelection: () => set({ selectedConvId: null }),

  // ── Chat Actions ──────────────────────────────────────

  /**
   * Hydrate messages from a persisted conversation.
   */
  hydrateMessages: async (userId, conversationId) => {
    // If the conversation changed, immediately clear old messages to prevent UI flash
    if (get().hydratedConvId !== conversationId) {
      set({ messages: [], hydratedConvId: conversationId, error: null });
    }

    if (!userId || !conversationId) {
      return;
    }

    try {
      const row = await getConversation(userId, conversationId);
      
      // Discard result if user navigated away
      if (get().hydratedConvId !== conversationId) return;

      const ds = (() => {
        try {
          if (!row?.data_source) return { messages: [] };
          return typeof row.data_source === "object"
            ? row.data_source
            : JSON.parse(row.data_source);
        } catch {
          return { messages: [] };
        }
      })();

      const rawMsgs = Array.isArray(ds?.messages) ? ds.messages : [];
      const hydrated = rawMsgs
        .map((m) => {
          if (Array.isArray(m) && m.length === 2) {
            const [q, a] = m;
            return { title: q, content: a, sources: [], thinkingHistory: [] };
          }
          if (m && typeof m === "object") {
            return {
              title: m.q,
              content: m.a,
              sources: Array.isArray(m.sources) ? m.sources : [],
              thinkingHistory: [], // In-memory history for this session only
            };
          }
          return null;
        })
        .filter(Boolean);

      set({ messages: hydrated, error: null });
    } catch (e) {
      console.error("Hydration failed:", e);
      if (get().hydratedConvId === conversationId) {
        set({ messages: [], error: "Failed to load message history" });
      }
    }
  },

  /**
   * Send a message and stream the AI response.
   */
  send: async (text, { userId, conversationId, documentIds } = {}) => {
    const state = get();
    if (!text?.trim() || state.isStreaming) return;

    const query = text.trim();
    const newIndex = state.messages.length;

    // Add user message placeholder
    set((s) => ({
      messages: [
        ...s.messages, 
        { title: query, content: "", sources: [], thinkingHistory: [] }
      ],
      isStreaming: true,
      error: null,
    }));

    const abortController = new AbortController();
    set({ _abortController: abortController });

    // Progress step deduplication prefixes
    const PROGRESS_PREFIXES = [
      "Đang nén ngữ cảnh:",
      "Đang viết lại câu hỏi:",
      "Đang phân tích:",
      "Đang tìm kiếm tài liệu",
    ];

    let collected = "";
    let finalResult = null;

    try {
      const response = await streamQuery(
        { query },
        { userId, conversationId, documentIds, signal: abortController.signal }
      );

      for await (const evt of parseSSE(response)) {
        if (abortController.signal.aborted) break;

        // ── Progress events ──
        if (evt.type === "progress" && evt.message) {
          let msg = evt.message;
          if (msg.startsWith("Đang tóm tắt phần") || msg.startsWith("Đang tóm tắt tài liệu")) {
            msg = "Đang tóm tắt...";
          }
          set((s) => {
            const msgs = [...s.messages];
            const currentMsg = msgs[newIndex];
            if (!currentMsg) return s;

            const prev = currentMsg.thinkingHistory || [];
            const lastStep = prev[prev.length - 1];
            const isContinuation =
              lastStep &&
              PROGRESS_PREFIXES.some(
                (p) => msg.startsWith(p) && lastStep.startsWith(p)
              );

            if (isContinuation) {
              const next = [...prev];
              next[next.length - 1] = msg;
              msgs[newIndex] = { ...currentMsg, thinkingHistory: next };
            } else {
              msgs[newIndex] = { 
                ...currentMsg, 
                thinkingHistory: lastStep === msg ? prev : [...prev, msg] 
              };
            }
            return { messages: msgs };
          });
          continue;
        }

        // ── Token/chunk events ──
        if (typeof evt.chunk === "string" && !evt.is_final) {
          collected += evt.chunk || "";
          set((s) => {
            const msgs = [...s.messages];
            if (msgs[newIndex]) {
              msgs[newIndex] = {
                ...msgs[newIndex],
                content: (msgs[newIndex].content || "") + (evt.chunk || ""),
              };
            }
            return { messages: msgs };
          });
          continue;
        }

        // ── Final event ──
        if (evt.is_final) {
          finalResult = evt;
          break;
        }

        // ── Error event ──
        // Story 36: the AI may signal failure as {error: ...} OR
        // {type: "error", message: ...} (e.g. the summary tool's 503). Catch
        // both so it is surfaced below instead of being silently dropped.
        if (evt.error || evt.type === "error") {
          finalResult = evt;
          break;
        }
      }

      // Process sources from final result
      if (collected.trim() || finalResult?.sources) {
        const sourceObjs = (
          Array.isArray(finalResult?.sources) ? finalResult.sources : []
        )
          .map((s) => {
            const enriched =
              s?.enriched_content?.trim() || s?.content?.trim() || "";
            const document_id = s?.document_id || s?.id || "";
            if (!enriched) return null;
            const page = resolvePageNumber(s?.metadata);
            // Cross-page citation fix: a window-enriched source can span more
            // than one page (Story: page_segments), so `metadata.page_number`
            // alone isn't always enough to place the whole highlighted text.
            const pageSegments = s?.context_metadata?.page_segments;
            const hasPageSegments =
              Array.isArray(pageSegments) && pageSegments.length > 0;
            // The chunk itself and where it sits in the document's source
            // text. `enriched` is the retrieval window around it — too wide to
            // bound a highlight with; these let the viewer mark the exact
            // cited range instead of matching text against the page.
            const content = s?.content?.trim() || "";
            const charStart = s?.char_start;
            const charEnd = s?.char_end;
            return {
              enriched_content: enriched,
              document_id,
              metadata: Number.isFinite(page) ? { page_number: page } : {},
              ...(content ? { content } : {}),
              ...(Number.isFinite(charStart) ? { char_start: charStart } : {}),
              ...(Number.isFinite(charEnd) ? { char_end: charEnd } : {}),
              ...(hasPageSegments
                ? { context_metadata: { page_segments: pageSegments } }
                : {}),
            };
          })
          .filter(Boolean);

        // Update sources on the message
        set((s) => {
          const msgs = [...s.messages];
          if (msgs[newIndex]) {
            msgs[newIndex] = { ...msgs[newIndex], sources: sourceObjs };
          }
          return { messages: msgs };
        });

        // Persist to backend
        try {
          await appendConversationMessage(userId, conversationId, {
            question: query,
            answer: collected,
            sources: sourceObjs,
            selected: documentIds,
          });
        } catch (e) {
          console.error("Failed to persist message:", e);
        }
      } else if (!abortController.signal.aborted) {
        // Story 36: the stream finished with NO answer text and NO sources —
        // e.g. the AI returned an error event ({type:"error"} / {error}, like
        // the summary tool's 503) or simply produced nothing. Surface a clear
        // message instead of leaving the bubble silently blank ("thinking then
        // nothing"). Aborts (user pressed Stop) are intentionally left as-is.
        const aiErr =
          (finalResult &&
            (finalResult.type === "error" || finalResult.error) &&
            (finalResult.message || finalResult.error)) ||
          null;
        const notice = aiErr
          ? `⚠️ ${aiErr}\n\nVui lòng thử lại.`
          : "⚠️ AI chưa trả về phản hồi cho yêu cầu này. Vui lòng thử lại.";
        set((s) => {
          const msgs = [...s.messages];
          if (msgs[newIndex]) {
            msgs[newIndex] = { ...msgs[newIndex], content: notice };
          }
          return { messages: msgs, error: aiErr || "Empty response" };
        });
      }
    } catch (e) {
      if (e?.name !== "AbortError") {
        console.error("Stream error:", e);
        set({ error: "Generation failed" });
      }
    } finally {
      set({
        isStreaming: false,
        _abortController: null,
      });
    }
  },

  /**
   * Abort the current stream.
   */
  stop: () => {
    const { _abortController } = get();
    if (_abortController) _abortController.abort();
    set({
      isStreaming: false,
      _abortController: null,
    });
  },

  /**
   * Clear all messages (e.g. on conversation switch before hydration).
   */
  clearMessages: () =>
    set({
      messages: [],
      hydratedConvId: null,
      isStreaming: false,
      error: null,
    }),
}));

export default useChatStore;
