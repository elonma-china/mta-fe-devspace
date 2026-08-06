// src/stores/useDocumentStore.js
import { create } from "zustand";
import { createSelectionSlice } from "./documentStore/selectionSlice";
import { createPollingSlice } from "./documentStore/pollingSlice";
import { createDocumentSlice } from "./documentStore/documentSlice";
import { createUploadSlice } from "./documentStore/uploadSlice";
import { createSSESlice } from "./documentStore/sseSlice";

/**
 * useDocumentStore
 * Centralized state for the document list, selection, and polling tasks.
 * Replaces DocumentSelect local state + useDocumentPolling hook.
 *
 * selectedDocumentIds moved here from useConversationStore.
 *
 * Upload policy: a conversation must exist before uploading.
 * uploadFiles() will reject early if conversationId is null, matching
 * the same invariant as useAnalysisStore.generate().
 *
 * Composed from five focused slices:
 *   - selectionSlice  — selectedDocumentIds, selectionInitialized
 *   - pollingSlice    — pollingTasks, updateDocumentStatus
 *   - documentSlice   — documents[], fetch, CRUD, clearDocuments
 *   - uploadSlice     — uploadFiles, processDocuments
 *   - sseSlice        — EventSource lifecycle (connectSSE, disconnectSSE)
 */
const useDocumentStore = create((...args) => ({
  ...createSelectionSlice(...args),
  ...createPollingSlice(...args),
  ...createDocumentSlice(...args),
  ...createUploadSlice(...args),
  ...createSSESlice(...args),
}));

export default useDocumentStore;

