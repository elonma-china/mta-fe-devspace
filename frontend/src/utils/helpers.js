// src/utils/helpers.js

export function defaultConversationName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  const dd = pad(now.getDate());
  const MM = pad(now.getMonth() + 1);
  const yyyy = now.getFullYear();
  return `Chưa đặt tên - ${hh}:${mm}:${ss} ${dd}/${MM}/${yyyy}`;
}

/**
 * Absolute Vietnamese timestamp "HH:mm:ss DD/MM/YYYY" (story 136).
 *
 * Used for the generated-document list where a relative time ("1 phút trước")
 * cannot tell apart several results created within the same minute. Matches the
 * `defaultConversationName` format for a consistent look.
 *
 * @param {string|number|Date} input
 * @returns {string} formatted stamp, or "" for an invalid/empty input
 */
export function formatTimestampVi(input) {
  if (input == null || input === "") return "";
  const d = new Date(input);
  if (isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  const dd = pad(d.getDate());
  const MM = pad(d.getMonth() + 1);
  const yyyy = d.getFullYear();
  return `${hh}:${mm}:${ss} ${dd}/${MM}/${yyyy}`;
}

/**
 * Copy plain text to the clipboard, including on insecure origins (story 137).
 *
 * Browsers only expose `navigator.clipboard` in a secure context (https:// or
 * localhost). This app is also served over plain HTTP on a LAN IP, where the
 * object is simply absent — the previous direct call threw
 * "Cannot read properties of undefined (reading 'writeText')" and the copy
 * button appeared dead. So: try the modern API, and fall back to the legacy
 * `execCommand` path, which still works on http://.
 *
 * Never throws — the caller gets a boolean and decides what to show the user.
 * Failures are always logged, never swallowed silently.
 *
 * @param {string} text text to place on the clipboard
 * @returns {Promise<boolean>} true when the text reached the clipboard
 */
export async function copyTextToClipboard(text) {
  if (typeof text !== "string" || text === "") return false;

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      // Denied permission or a transient failure — recoverable, so try the
      // legacy path before telling the user it failed.
      console.warn("Clipboard API write failed, trying fallback:", err);
    }
  }

  return legacyCopy(text);
}

/**
 * Pre-`navigator.clipboard` copy: select a throwaway textarea and let the
 * browser's own "copy" command take it. Deprecated but still the only thing
 * that works outside a secure context.
 *
 * @param {string} text
 * @returns {boolean} true when the command reported success
 */
function legacyCopy(text) {
  if (typeof document === "undefined" || !document.body) return false;
  if (typeof document.execCommand !== "function") return false;

  const previouslyFocused = document.activeElement;
  const scratch = document.createElement("textarea");
  scratch.value = text;
  scratch.setAttribute("readonly", "");
  scratch.setAttribute("aria-hidden", "true");
  scratch.setAttribute("tabindex", "-1");
  // Must stay rendered and selectable — `display:none` makes the copy a no-op.
  // Dynamic positioning of a transient node, so inline styles are the only
  // option here (no static rule to put in a stylesheet).
  scratch.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:none;" +
    "outline:none;box-shadow:none;background:transparent;opacity:0;";

  document.body.appendChild(scratch);
  try {
    scratch.focus({ preventScroll: true });
    scratch.select();
    const ok = document.execCommand("copy");
    if (!ok) console.error("Legacy clipboard copy returned false");
    return ok === true;
  } catch (err) {
    console.error("Legacy clipboard copy failed:", err);
    return false;
  } finally {
    scratch.remove();
    // Give the caret back so copying never disturbs what the user was doing.
    if (previouslyFocused && typeof previouslyFocused.focus === "function") {
      previouslyFocused.focus({ preventScroll: true });
    }
  }
}

export function timeAgoVi(input) {
  const d = new Date(input);
  if (isNaN(d.getTime())) return "";

  const now = new Date();
  let sec = Math.floor((now - d) / 1000);
  if (sec < 0) sec = 0;

  const minute = 60;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;

  let n, unit;
  if (sec < minute) {
    n = 1; unit = "phút";
  } else if (sec < hour) {
    n = Math.floor(sec / minute); unit = "phút";
  } else if (sec < day) {
    n = Math.floor(sec / hour); unit = "giờ";
  } else if (sec < week) {
    n = Math.floor(sec / day); unit = "ngày";
  } else if (sec < month) {
    n = Math.floor(sec / week); unit = "tuần";
  } else if (sec < year) {
    n = Math.floor(sec / month); unit = "tháng";
  } else {
    n = Math.floor(sec / year); unit = "năm";
  }

  return `${n} ${unit} trước`;
}

// A run of adjacent bare markers — `[1]`, `[1][2]` — that is not an array index
// (no word char, `)` or `]` in front) and not markdown link syntax (no `(` or `:`
// behind). Written without a lookbehind on purpose: that is ES2018, and a regex
// the browser cannot parse takes the whole bundle down rather than degrading.
const BARE_MARKER_RUN_RE = /(^|[^\w)\]])((?:\[\d+\])+)(?![(:])/g;

/**
 * Turn citation markers into `#source-N` links for the chat renderer.
 *
 * `sourceCount` (the length of the message's `sources[]`) enables the bare-`[N]`
 * form. Models drift off `[Nguồn N]` when they answer from reference-dense text
 * and start copying that text's own bracket style — conversation 72 emitted 18
 * bare markers with correct ids. The AI service normalizes new answers, but ones
 * already persisted still arrive raw, so they are rescued here.
 *
 * The bound is what makes that safe: a bare bracket is a citation only if it
 * addresses a source that exists, which is what tells the answer's own `[1]`
 * apart from the cited paper's `[64]`. Without a count, bare markers stay text.
 */
export function toSourceLinks(txt, sourceCount) {
  const s = typeof txt === "string" ? txt : String(txt ?? "");

  const labelled = s.replace(/\[([^\]]*(?:Nguồn|Source)[^\]]*)\]/gi, (whole, content) => {
    const idx = content.search(/Nguồn|Source/i);
    if (idx === -1) return whole;
    const sub = content.slice(idx);
    const matches = [...sub.matchAll(/(\d+)(?:\s*-\s*([\w-]+))?/g)];
    if (!matches.length) return whole;
    // Story 132: index the source by the DISPLAY number only. The click handler
    // does `parseInt(target) - 1` to index `sources[]`, so a non-numeric id (e.g.
    // "1-<uuid>") produced NaN → wrong/ignored source. Always use `num`.
    const links = matches.map(([, num]) => {
      return `[${num}](#source-${num})`;
    });
    return links.join(", ");
  });

  const max = Number(sourceCount);
  if (!Number.isFinite(max) || max < 1) return labelled;

  return labelled.replace(BARE_MARKER_RUN_RE, (whole, prefix, run) => {
    const nums = [...run.matchAll(/\d+/g)].map(([n]) => parseInt(n, 10));
    // All-or-nothing: rewriting only the resolvable half of `[1][64]` would drop
    // what the model actually cited without telling anyone.
    if (!nums.every((n) => n >= 1 && n <= max)) return whole;
    return prefix + nums.map((n) => `[${n}](#source-${n})`).join("");
  });
}

export const preprocessLaTeX = (content) => {
  if (typeof content !== 'string') return "";
  return content
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, inner) => `$$${inner}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, inner) => `$${inner}$`);
};

export function formatSize(size) {
  if (size == null || isNaN(size)) return "";
  const kb = size / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}