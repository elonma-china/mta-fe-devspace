// src/features/chat/components/resizeTextarea.js
//
// Story 114: auto-grow the chat input textarea up to a max height, then allow
// scrolling. Toggling overflowY is what keeps the vertical scrollbar — and its
// native up/down arrow buttons (▲▼) on Windows/Chromium — hidden while the
// content fits, matching a clean single-field input. When content exceeds the
// max height, scrolling turns on; the scrollbar itself is styled thin and
// arrow-less in ChatInterface.css (::-webkit-scrollbar-button / scrollbar-width).

/** Max height (px) the chat input grows to before it starts scrolling. */
export const CHAT_INPUT_MAX_HEIGHT = 160;

/**
 * Resize a textarea to fit its content, capped at maxHeight, and toggle its
 * vertical scrollbar so it only appears once the content overflows the cap.
 *
 * @param {HTMLTextAreaElement | null} el - the textarea to resize (no-op if null)
 * @param {number} [maxHeight=CHAT_INPUT_MAX_HEIGHT] - height cap in px
 */
export function resizeTextarea(el, maxHeight = CHAT_INPUT_MAX_HEIGHT) {
  if (!el) return;
  // Reset first so scrollHeight reflects the true content height (not the
  // previously-set height).
  el.style.height = "auto";
  const contentHeight = el.scrollHeight;
  el.style.height = Math.min(contentHeight, maxHeight) + "px";
  el.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
}
