// src/features/documents/components/viewer/viewerHost.js
//
// Pure state helpers for the chat-side viewer host (story 15). On the chat
// screen the right column shows either "Bảng thông tin" (AnalysisSection) or
// the Document Viewer. This module owns that swap as plain data so it is unit
// testable without rendering Chat.js (ADR-008).

import { resolvePageNumber } from "utils/pageNumber";

/**
 * @typedef {{ id: string|number, name: string } | null} ViewerDoc
 */

/**
 * Open the viewer for a document.
 *
 * @param {ViewerDoc} _prev  previous viewer doc (ignored)
 * @param {{ id: string|number, name?: string }} doc
 * @returns {ViewerDoc}
 */
export function openViewer(_prev, doc) {
  if (!doc || doc.id == null) return null;
  return { id: doc.id, name: doc.name || "" };
}

/**
 * Close the viewer — restores "Bảng thông tin". AnalysisSection state lives in
 * its own global store, so closing here never resets analysis.
 *
 * @returns {null}
 */
export function closeViewer() {
  return null;
}

/**
 * Whether the viewer must auto-close when the chat context changes
 * (conversation switch, leaving the chat route, or a mobile tab change away
 * from the panel that hosts the viewer).
 *
 * @param {ViewerDoc} current
 * @param {{ conversationChanged?: boolean, leftChat?: boolean, mobileTabChanged?: boolean }} ctx
 * @returns {ViewerDoc} next viewer doc (null when it should close)
 */
export function reconcileViewerOnContext(current, ctx = {}) {
  if (!current) return null;
  if (ctx.conversationChanged || ctx.leftChat || ctx.mobileTabChanged) {
    return null;
  }
  return current;
}

/**
 * Is the viewer currently open (i.e. the right column shows the viewer, not
 * "Bảng thông tin")?
 *
 * @param {ViewerDoc} current
 * @returns {boolean}
 */
export function isViewerOpen(current) {
  return Boolean(current && current.id != null);
}

/**
 * Story 109: resolve a chat citation source into a paged viewer doc.
 *
 * A citation source carries `document_id` + `metadata.page_number`. The chat
 * sends the conversation's document ids to the AI, which echoes them back as
 * `document_id`, so a source id matches an entry in the conversation's document
 * list (`useDocumentStore.documents`). We resolve the display name + page from
 * that list so the viewer opens the RIGHT document at the RIGHT page.
 *
 * @param {{ document_id?: string|number, metadata?: object, content?: string, enriched_content?: string, char_start?: number, char_end?: number, context_metadata?: object }} source
 * @param {Array<{ id: string|number, name?: string }>} documents
 * @param {string} [answerText] the answer this citation belongs to — used only
 *   by the text-matching fallback, to narrow a highlight the offsets would have
 *   placed exactly.
 * @returns {{ id: string|number, name: string, page: number|undefined, highlight: string|undefined, charStart: number|undefined, charEnd: number|undefined, answer: string|undefined, segments: Array<{page_number:number, text:string}>|undefined } | null}
 *   null when the source has no id OR the cited doc is not part of this session
 *   (the caller then falls back to the SourceCard text popover).
 *
 *   `charStart`/`charEnd` locate the cited chunk in the document's source text;
 *   with the page's own span the viewer marks that range directly. `highlight`
 *   is the chunk's `content` — the passage itself — and is what the fallback
 *   matches against when either offset is missing. It is deliberately NOT
 *   `enriched_content`: that is the retrieval window (chunk + neighbours,
 *   routinely 3× as long and often wider than the page), so bounding a
 *   highlight by it marked far more than the citation covers.
 *
 *   `segments` (cross-page citation fix) carries the per-page breakdown of a
 *   window-enriched citation whose content spans more than one page —
 *   already-resolved `page_number`s, not re-run through `resolvePageNumber`
 *   (the backend already picked the final value).
 */
export function sourceViewerDoc(source, documents, answerText) {
  const docId = source?.document_id;
  if (docId == null || docId === "") return null;
  const list = Array.isArray(documents) ? documents : [];
  const match = list.find((d) => String(d.id) === String(docId));
  if (!match) return null;
  const page = resolvePageNumber(source?.metadata);
  const rawSegments = source?.context_metadata?.page_segments;
  const segments =
    Array.isArray(rawSegments) && rawSegments.length > 0
      ? rawSegments
      : undefined;
  const charStart = source?.char_start;
  const charEnd = source?.char_end;
  return {
    id: match.id,
    name: match.name || "",
    page: Number.isFinite(page) ? page : undefined,
    highlight: source?.content || source?.enriched_content || undefined,
    charStart: Number.isFinite(charStart) ? charStart : undefined,
    charEnd: Number.isFinite(charEnd) ? charEnd : undefined,
    answer: answerText || undefined,
    segments,
  };
}
