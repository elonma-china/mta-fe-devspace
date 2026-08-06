// src/stores/useAnalysisStore.js
import { create } from "zustand";
import {
  getConversationInfo,
  addConversationInfo,
  deleteConversationInfo,
  submitSummary,
  submitMindmap,
  submitDraft,
  submitDirectiveReview,
} from "features/analysis/api";
import { PROCESSING_STATUS } from "constants/status";

/**
 * useAnalysisStore
 * Centralized state for analysis items (summaries, mindmaps, reports),
 * their polling tasks, and the detail panel selection.
 * Replaces AnalysisSection local state + useAnalysisPolling hook.
 */
const useAnalysisStore = create((set, get) => ({
  // ── State ──────────────────────────────────────────────
  items: [],              // Array<InfoItem> — persisted analysis items
  conversationId: null,   // Tracks which conversation the current items belong to
  pending: [],            // Array<{id, type, name, ...}> — local placeholders
  selectedInfo: null,     // InfoItem | null — drives InfoPanel
  loading: false,
  pollingTasks: {},       // Record<itemId, { taskId, type, dateCreated }>

  // ── Fetch items ────────────────────────────────────────

  fetchItems: async (userId, conversationId) => {
    // If the conversation changed, immediately clear old items to prevent UI flash
    if (get().conversationId !== conversationId) {
      set({ items: [], conversationId, loading: true });
    } else {
      set({ loading: true });
    }

    if (!userId || !conversationId) {
      set({ loading: false });
      return;
    }
    try {
      const resp = await getConversationInfo(userId, conversationId);
      
      if (get().conversationId !== conversationId) return;

      const list = Array.isArray(resp?.info_tables) ? resp.info_tables : [];
      
      // Sync polling tasks from fetched items
      const newPollingTasks = {};
      list.forEach((it) => {
        const status = it.status?.toUpperCase?.() || "";
        if (
          (status === PROCESSING_STATUS.PROCESSING ||
            status === PROCESSING_STATUS.PENDING) &&
          it.task_id
        ) {
          newPollingTasks[String(it.id)] = {
            taskId: it.task_id,
            type: it.type,
            dateCreated: it.date_created,
          };
        }
      });

      set({
        items: list,
        loading: false,
        pollingTasks:
          Object.keys(newPollingTasks).length > 0 ? newPollingTasks : {},
      });
    } catch (e) {
      console.error("getConversationInfo failed:", e);
      if (get().conversationId === conversationId) {
        set({ items: [], loading: false });
      }
    }
  },

  // ── Generate (summary / mindmap / report) ──────────────

  generate: async (
    type,
    { userId, conversationId, docId, docName, documentIds, templateId, templateLabel, draftFile }
  ) => {
    const localId = `pending-${Date.now()}`;
    const typeLabels = {
      summary: "Tóm tắt",
      mindmap: "Bản đồ tư duy",
      report: "Văn bản",
      directive_review: "Rà soát dự thảo",
    };
    const label = typeLabels[type] || type;

    // Add a local pending placeholder
    set((s) => ({
      pending: [
        {
          id: localId,
          type,
          name: `Đang tạo ${label.toLowerCase()}...`,
          date_created: new Date().toISOString(),
          _pending: true,
        },
        ...s.pending,
      ],
    }));

    try {
      // Submit to backend (draft and directive_review use different shapes)
      let task_id;
      let infoName;
      if (type === "directive_review") {
        // Multipart: the draft .docx is transient and never indexed, so it goes
        // up as a file rather than a document_id. apiClient passes FormData
        // through untouched so the browser sets the multipart boundary.
        const form = new FormData();
        form.append("file", draftFile);
        form.append(
          "payload",
          JSON.stringify({ reference_document_ids: documentIds, options: {} })
        );
        ({ task_id } = await submitDirectiveReview(form));
        infoName = draftFile?.name ? `${label} - ${draftFile.name}` : label;
      } else if (type === "report") {
        ({ task_id } = await submitDraft({
          document_ids: documentIds,
          template_id: templateId,
          options: {},
        }));
        // Story 136: the result name is just the document type
        // ("Bài phát biểu" / "Tổng hợp văn bản") — the "Văn bản - " prefix was
        // dropped. Falls back to the generic label only when no template label.
        infoName = templateLabel || label;
      } else {
        const submitFn = type === "summary" ? submitSummary : submitMindmap;
        ({ task_id } = await submitFn({
          document_id: docId,
          conversation_id: conversationId,
        }));
        infoName = `${label} cho ${docName}`;
      }

      // Persist info record
      const resp = await addConversationInfo(userId, conversationId, {
        type,
        name: infoName,
        content: "",
        selected:
          type === "directive_review"
            ? {
                // The File itself is not serializable — persist its name only.
                reference_document_ids: documentIds,
                draft_filename: draftFile?.name || "",
              }
            : type === "report"
            ? { document_ids: documentIds, template_id: templateId }
            : documentIds,
        status: PROCESSING_STATUS.PROCESSING,
        task_id,
      });

      // Move from pending → items and start polling
      set((s) => {
        const newPending = s.pending.filter((p) => p.id !== localId);
        const info = resp?.info;
        if (info) {
          return {
            pending: newPending,
            items: [info, ...s.items],
            pollingTasks: {
              ...s.pollingTasks,
              [String(info.id)]: {
                taskId: task_id,
                type,
                dateCreated: info.date_created,
              },
            },
          };
        }
        return { pending: newPending };
      });

      return resp?.info;
    } catch (e) {
      // Remove failed pending item
      set((s) => ({
        pending: s.pending.filter((p) => p.id !== localId),
      }));
      throw e;
    }
  },

  // ── Delete ─────────────────────────────────────────────

  deleteItem: async (userId, conversationId, itemId) => {
    try {
      await deleteConversationInfo(userId, conversationId, itemId);
      set((s) => ({
        items: s.items.filter((it) => String(it.id) !== String(itemId)),
      }));
    } catch (e) {
      console.error("Delete failed:", e);
      throw e;
    }
  },

  // ── Selection (InfoPanel) ──────────────────────────────

  selectInfo: (item) => set({ selectedInfo: item }),
  clearSelection: () => set({ selectedInfo: null }),

  // ── Polling management ─────────────────────────────────

  startPolling: (itemId, taskId, type, dateCreated) => {
    set((s) => ({
      pollingTasks: {
        ...s.pollingTasks,
        [String(itemId)]: { taskId, type, dateCreated },
      },
    }));
  },

  completePolling: (itemId) => {
    set((s) => {
      const next = { ...s.pollingTasks };
      delete next[String(itemId)];
      return { pollingTasks: next };
    });
  },

  updateItemContent: (itemId, content, status) => {
    set((s) => ({
      items: s.items.map((it) =>
        String(it.id) === String(itemId)
          ? { ...it, content, status, task_id: null }
          : it
      ),
      selectedInfo:
        s.selectedInfo && String(s.selectedInfo.id) === String(itemId)
          ? { ...s.selectedInfo, content, status, task_id: null }
          : s.selectedInfo,
    }));
  },

  updateItem: (itemId, patch) => {
    set((s) => ({
      items: s.items.map((it) =>
        String(it.id) === String(itemId) ? { ...it, ...patch, task_id: null } : it
      ),
      selectedInfo:
        s.selectedInfo && String(s.selectedInfo.id) === String(itemId)
          ? { ...s.selectedInfo, ...patch, task_id: null }
          : s.selectedInfo,
    }));
  },

  // ── Reset ──────────────────────────────────────────────

  clearAnalysis: () =>
    set((s) => ({
      items: [],
      conversationId: null,
      pending: [],
      selectedInfo: null,
      loading: false,
      pollingTasks: {},
    })),
}));

export default useAnalysisStore;
