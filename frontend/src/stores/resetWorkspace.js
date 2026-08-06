// src/stores/resetWorkspace.js
import useChatStore from "./useChatStore";
import useDocumentStore from "./useDocumentStore";
import useAnalysisStore from "./useAnalysisStore";
import useViewerCacheStore from "./useViewerCacheStore";

/**
 * Atomically reset chat, document, and analysis state.
 * Call this instead of clearing each store individually
 * to prevent desync during rapid navigation.
 */
export function resetWorkspace() {
  useChatStore.getState().clearSelection();
  useDocumentStore.getState().clearDocuments();
  useAnalysisStore.getState().clearAnalysis();
  useViewerCacheStore.getState().clearViewerCache();
}
