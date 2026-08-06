// src/stores/useViewerCacheStore.js
import { create } from "zustand";

/**
 * useViewerCacheStore
 * Per-document cache for the document viewer's expensive fetches: the original
 * file Blob ("File gốc") and the digitized pages response. Both are immutable
 * once a document is processed, so reopening a document (or opening a citation
 * card onto it) must not refetch — a reload costs seconds through the AI-service
 * proxy and fails outright when the upstream is unreachable.
 *
 * Bounded LRU (MAX_CACHED_DOCS most recently used documents; file+pages count
 * as one entry). In-flight loads are deduped so concurrent callers share one
 * request; failures are never cached (a retry loads again).
 */

export const MAX_CACHED_DOCS = 10;

// In-flight promise dedupe, keyed `${kind}:${docId}`. Module-local: promises
// are not state (nothing renders from them), so they stay out of the store.
const inflight = new Map();

const useViewerCacheStore = create((set, get) => ({
  files: {}, // docId -> Blob
  pages: {}, // docId -> pages response ({pages, page_count})
  order: [], // LRU order, most recently used last (file+pages share the key)

  /** Move docId to the LRU tail, evicting the oldest entries beyond the cap. */
  _touch: (docId) => {
    set((s) => {
      const order = [...s.order.filter((id) => id !== docId), docId];
      const files = { ...s.files };
      const pages = { ...s.pages };
      while (order.length > MAX_CACHED_DOCS) {
        const evicted = order.shift();
        delete files[evicted];
        delete pages[evicted];
      }
      return { order, files, pages };
    });
  },

  _getCached: async (kind, docId, loader) => {
    const cached = get()[kind][docId];
    if (cached !== undefined) {
      get()._touch(docId);
      return cached;
    }
    const key = `${kind}:${docId}`;
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      try {
        const value = await loader();
        set((s) => ({ [kind]: { ...s[kind], [docId]: value } }));
        get()._touch(docId);
        return value;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  },

  /**
   * The original file Blob for a document, loading it via `loader` on a miss.
   * @param {string} docId
   * @param {() => Promise<Blob>} loader
   * @returns {Promise<Blob>}
   */
  getFile: (docId, loader) => get()._getCached("files", docId, loader),

  /**
   * The digitized pages response for a document, loading on a miss.
   * @param {string} docId
   * @param {() => Promise<object>} loader
   * @returns {Promise<object>}
   */
  getPages: (docId, loader) => get()._getCached("pages", docId, loader),

  /** Drop everything (logout / workspace reset). */
  clearViewerCache: () => {
    inflight.clear();
    set({ files: {}, pages: {}, order: [] });
  },
}));

export default useViewerCacheStore;
