// src/features/admin/utils/docRepoFocus.js

/**
 * Persistence for the super-admin "focus unit" on the document-repository
 * screen. Kept in sessionStorage so the choice survives a page refresh (F5)
 * within the login session, is scoped to the tab, and is NOT sent with requests
 * (unlike a cookie). Cleared on logout.
 *
 * Single source of truth for the storage key — no scattered string literals.
 */
export const FOCUS_STORAGE_KEY = "docRepoFocusUnit";

/**
 * Read the persisted focus unit.
 * @returns {{ id: number, name: string } | null}
 */
export function readFocus() {
  try {
    const raw = sessionStorage.getItem(FOCUS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.id != null) {
      return { id: parsed.id, name: parsed.name || "" };
    }
    return null;
  } catch {
    // Malformed/unavailable storage → behave as "no focus".
    return null;
  }
}

/**
 * Persist the focus unit (or clear it when id is null).
 * @param {number|null} id
 * @param {string} [name]
 */
export function writeFocus(id, name = "") {
  try {
    if (id == null) {
      sessionStorage.removeItem(FOCUS_STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(FOCUS_STORAGE_KEY, JSON.stringify({ id, name }));
  } catch {
    // Storage unavailable — non-fatal; focus simply won't persist.
  }
}

/** Clear the persisted focus unit (on logout). */
export function clearFocus() {
  try {
    sessionStorage.removeItem(FOCUS_STORAGE_KEY);
  } catch {
    // ignore
  }
}
