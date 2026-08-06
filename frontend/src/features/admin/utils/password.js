// src/features/admin/utils/password.js

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Generate a random alphanumeric password.
 *
 * @param {number} [length=12] - desired password length.
 * @returns {string} A random [A-Za-z0-9] string of the given length.
 */
export function generatePassword(length = 12) {
  const cryptoObj =
    typeof window !== "undefined" ? window.crypto || window.msCrypto : null;
  let out = "";
  if (cryptoObj && cryptoObj.getRandomValues) {
    const values = new Uint32Array(length);
    cryptoObj.getRandomValues(values);
    for (let i = 0; i < length; i += 1) {
      out += ALPHABET[values[i] % ALPHABET.length];
    }
    return out;
  }
  // Fallback when Web Crypto is unavailable (non-security-critical contexts).
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}
