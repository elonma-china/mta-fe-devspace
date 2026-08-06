// src/features/auth/api/authFlow.js
import { login, getMe } from "./auth";

/**
 * Log in, persist the token, then load the FULL session user from `/me`.
 *
 * Story 67: the login response user omits `permissions` (only `/me` carries
 * them), so gating the kho/document domain on the login user left the commander
 * role without its UI until a reload. Resolving the user from `/me` makes the
 * permission set present immediately and keeps `/me` the single source of truth.
 *
 * If `/me` fails after the token is stored, the token is cleared and the error
 * rethrown so the caller treats it as a failed login (no half-authenticated
 * session missing capabilities).
 *
 * @param {string} username
 * @param {string} password
 * @returns {Promise<object>} the `/me` user (id, username, is_admin, unit_id,
 *   unit_name, permissions).
 */
export async function loginAndLoadUser(username, password) {
  const data = await login(username, password);
  localStorage.setItem("token", data.token);
  try {
    return await getMe();
  } catch (err) {
    localStorage.removeItem("token");
    throw err;
  }
}
