// src/features/admin/utils/text.js

/**
 * Normalize a string for accent- and case-insensitive matching.
 *
 * Lowercases and strips Vietnamese diacritics (via NFD decomposition), so that
 * e.g. "Tuấn" and "tuan" compare equal. Also folds đ/Đ to d.
 *
 * @param {string} [value] - input string (nullish treated as empty).
 * @returns {string} normalized comparison key.
 */
export function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .trim();
}
