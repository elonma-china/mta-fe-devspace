// src/features/chat/components/chatSendGuard.js
//
// Pure decision helpers for the chat send guard (story 134). Kept
// framework-free so they unit-test without rendering ChatInterface (ADR-008:
// the component imports the `features/documents/components` barrel, which CRA5
// Jest cannot render).
//
// Product rule: the AI may only answer from EXPLICITLY selected documents. When
// a conversation has documents but none are selected, asking is blocked — the
// old behavior silently fell back to ALL documents, so unchecking everything
// had no effect and the model still answered from unchecked docs.

/**
 * Whether the ask must be blocked because a selection is required but empty.
 *
 * True only when the conversation HAS documents yet none are selected. A
 * conversation with zero documents (general chat) is never blocked here.
 *
 * @param {number} numDocuments   total documents in the conversation
 * @param {number} selectedCount  number of currently selected documents
 * @returns {boolean}
 */
export function isSelectionRequired(numDocuments, selectedCount) {
  return numDocuments > 0 && selectedCount === 0;
}

/**
 * Resolve the document IDs to send with a chat query.
 *
 * An explicit, non-empty `override` (analysis / im-compose flows) wins;
 * otherwise the user's current selection is sent EXACTLY — story 134 removed
 * the old fallback that replaced an empty selection with every completed doc.
 *
 * @param {string[]|null|undefined} override     explicit ids, or null
 * @param {string[]}                selectedIds  current selection
 * @returns {string[]}
 */
export function resolveSendDocIds(override, selectedIds) {
  if (Array.isArray(override) && override.length > 0) return override;
  return selectedIds;
}
