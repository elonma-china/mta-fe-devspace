// src/features/admin/utils/userDeleteMessage.js
//
// Pure helper (story 108): build the confirmation message shown before deleting a
// user, warning about the related data that will be removed. Framework-free so it
// unit-tests without rendering.

/** Fallback confirm text when a user has no related data (or impact lookup fails). */
export const GENERIC_DELETE_MESSAGE = "Bạn chắc chắn muốn xoá tài khoản này?";

/**
 * @typedef {Object} DeleteImpact
 * @property {number} [documents]           files the user uploaded (will be deleted)
 * @property {number} [conversations]       personal conversations (cascade-deleted)
 * @property {string[]} [owns_repo_units]   units whose repository the user owns (kept)
 */

/**
 * Build the delete-confirmation message from a user's delete-impact summary.
 *
 * @param {DeleteImpact} [impact]
 * @returns {string}
 */
export function buildUserDeleteMessage(impact) {
  const documents = impact?.documents || 0;
  const conversations = impact?.conversations || 0;
  const units = impact?.owns_repo_units || [];

  const parts = [];
  if (documents > 0 || conversations > 0) {
    parts.push(
      `Tài khoản này có ${documents} tài liệu và ${conversations} hội thoại ` +
        `liên quan sẽ bị xoá vĩnh viễn để đảm bảo sạch dữ liệu.`
    );
  }
  if (units.length > 0) {
    parts.push(
      `Tài khoản đang đứng tên kho của đơn vị: ${units.join(", ")}. ` +
        `Kho sẽ được giữ (chuyển cho quản trị khác), chỉ tài liệu do tài khoản ` +
        `này tải lên bị xoá.`
    );
  }
  return parts.length ? parts.join(" ") : GENERIC_DELETE_MESSAGE;
}
