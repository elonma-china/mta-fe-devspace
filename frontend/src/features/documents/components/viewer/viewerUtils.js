// src/features/documents/components/viewer/viewerUtils.js
//
// Pure helpers for the Document Viewer (story 15). Kept framework-free so they
// unit-test without rendering (ADR-008: CRA5 Jest can't render the component
// tree through the `components` barrel).

export const VIEWER_TABS = {
  ORIGINAL: "original", // "File gốc"
  DIGITIZED: "digitized", // "Nội dung đã số hóa"
};

// Min fraction each pane keeps when dragging the resize handle, so neither the
// document list nor the viewer can be collapsed to nothing.
export const MIN_SPLIT_RATIO = 0.2;
export const MAX_SPLIT_RATIO = 0.8;
export const DEFAULT_SPLIT_RATIO = 0.42;

/**
 * Clamp a list/viewer split ratio to the allowed range.
 *
 * @param {number} ratio  desired list-pane fraction (0..1)
 * @returns {number} clamped ratio
 */
export function clampSplitRatio(ratio) {
  if (!Number.isFinite(ratio)) return DEFAULT_SPLIT_RATIO;
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
}

/**
 * Compute the new split ratio from a pointer x position within a container.
 *
 * @param {number} pointerX     clientX of the drag
 * @param {number} containerLeft container left offset
 * @param {number} containerWidth container width
 * @returns {number} clamped ratio
 */
export function ratioFromPointer(pointerX, containerLeft, containerWidth) {
  if (!containerWidth) return DEFAULT_SPLIT_RATIO;
  return clampSplitRatio((pointerX - containerLeft) / containerWidth);
}

/**
 * Clamp a 1-based page number into [1, pageCount].
 *
 * @param {number} page
 * @param {number} pageCount
 * @returns {number}
 */
export function clampPage(page, pageCount) {
  if (!pageCount || pageCount < 1) return 1;
  return Math.min(pageCount, Math.max(1, page));
}

/**
 * Find a given 1-based page's entry in a pages array.
 *
 * Callers that highlight by offset need the whole entry, not just its text:
 * `char_start`/`char_end` say where the page sits in the document's source
 * text, which is the coordinate system a citation's offsets use.
 *
 * @param {Array<{page_number:number, content:string, char_start?:number, char_end?:number}>} pages
 * @param {number} pageNo
 * @returns {object|undefined} the page entry, or undefined when missing
 */
export function pageEntryFor(pages, pageNo) {
  if (!Array.isArray(pages)) return undefined;
  return pages.find((p) => Number(p.page_number) === Number(pageNo));
}

/**
 * Find the text content of a given 1-based page from a pages array.
 *
 * @param {Array<{page_number:number, content:string}>} pages
 * @param {number} pageNo
 * @returns {string} content, or "" when missing
 */
export function pageTextFor(pages, pageNo) {
  return pageEntryFor(pages, pageNo)?.content || "";
}

/**
 * A short text snippet for a page (story 29) — the thumbnail fallback when the
 * page image is unavailable (404 / not rendered). Trims + truncates the page's
 * digitized content so a thumbnail is never blank, just a number, or useless.
 *
 * @param {Array<{page_number:number, content:string}>} pages
 * @param {number} pageNo
 * @param {number} [len=80]
 * @returns {string} snippet ("" when the page has no content)
 */
export function pageSnippet(pages, pageNo, len = 80) {
  const text = pageTextFor(pages, pageNo).trim();
  if (!text) return "";
  return text.length > len ? `${text.slice(0, len).trimEnd()}…` : text;
}

/**
 * Pick the 1-based page currently in view inside the digitized scroll column
 * (story 133). Replaces the old IntersectionObserver "topmost still-intersecting
 * section" pick, which lagged one page behind the page actually filling the
 * viewport (reading page 10 showed "9/10").
 *
 * A page becomes "current" once its top has scrolled past a reading line a
 * little below the viewport top (`lineRatio`); the LAST such page wins. A
 * bottom-guard makes a short LAST page read as N/N when scrolled to the end
 * (it would otherwise stay N-1/N because the taller previous page still fills
 * most of the viewport). When the content is not scrollable, page 1 is current.
 *
 * Pure/geometry-only so it unit-tests without a DOM (ADR-008).
 *
 * @param {Array<{page:number, top:number}>} sections
 *   Each digitized page section's `top` = its offset (px) within the scroll
 *   container. Order-independent (sorted internally).
 * @param {number} scrollTop     container.scrollTop
 * @param {number} clientHeight  container.clientHeight (viewport height)
 * @param {number} scrollHeight  container.scrollHeight (total content height)
 * @param {{lineRatio?:number, bottomEps?:number}} [opts]
 * @returns {number|null} the current 1-based page, or null for empty input
 */
export function pageAtScroll(
  sections,
  scrollTop,
  clientHeight,
  scrollHeight,
  opts = {}
) {
  if (!Array.isArray(sections) || sections.length === 0) return null;
  const sorted = [...sections].sort((a, b) => a.top - b.top);
  // Nothing to scroll → always on the first page.
  if (!(scrollHeight > clientHeight)) return sorted[0].page;
  // Scrolled to the bottom → the last (often short) page is what's being read.
  const bottomEps = opts.bottomEps ?? 4;
  if (scrollTop + clientHeight >= scrollHeight - bottomEps) {
    return sorted[sorted.length - 1].page;
  }
  // Reading line a little below the viewport top; the last page whose top has
  // passed it is the one the user is reading.
  const line = scrollTop + clientHeight * (opts.lineRatio ?? 0.25);
  let current = sorted[0].page;
  for (const s of sorted) {
    if (s.top <= line) current = s.page;
    else break;
  }
  return current;
}

// ── Story 23: multi-format "File gốc" rendering ──────────────────────────────
//
// The "File gốc" tab used to embed every file in an <iframe>, which only the
// browser's PDF/image viewer can render — docx/xlsx/txt got DOWNLOADED instead.
// We now pick a renderer per file kind. ``fileKindFor`` is the pure classifier.

// Map of viewer "kinds" to the extensions that resolve to them. Anything not
// listed falls back to ``"unsupported"`` (a download prompt, no silent download).
export const FILE_KIND_EXT = {
  pdf: [".pdf"],
  image: [".png", ".jpg", ".jpeg", ".gif", ".webp"],
  docx: [".docx"],
  sheet: [".xlsx", ".csv"],
  text: [".txt", ".md", ".markdown"],
};

// Content-type substrings used as a fallback when the file name has no usable
// extension (e.g. the blob carries a real content-type but the name doesn't).
const FILE_KIND_CONTENT_TYPE = [
  ["pdf", ["application/pdf"]],
  ["image", ["image/"]],
  [
    "docx",
    ["application/vnd.openxmlformats-officedocument.wordprocessingml"],
  ],
  [
    "sheet",
    [
      "application/vnd.openxmlformats-officedocument.spreadsheetml",
      "application/vnd.ms-excel",
      "text/csv",
    ],
  ],
  ["text", ["text/plain", "text/markdown"]],
];

// Kinds we can render inline; the rest fall back to a download prompt.
export const RENDERABLE_KINDS = ["pdf", "image", "docx", "sheet", "text"];

/**
 * Classify a document's original file by name (preferred) then content-type.
 *
 * @param {string} [name]        the document/file name (extension wins)
 * @param {string} [contentType] the blob/response content-type (fallback)
 * @returns {"pdf"|"image"|"docx"|"sheet"|"text"|"unsupported"}
 */
export function fileKindFor(name, contentType) {
  const lowerName = String(name || "").toLowerCase();
  for (const [kind, exts] of Object.entries(FILE_KIND_EXT)) {
    if (exts.some((ext) => lowerName.endsWith(ext))) return kind;
  }
  const ct = String(contentType || "").toLowerCase();
  if (ct) {
    for (const [kind, needles] of FILE_KIND_CONTENT_TYPE) {
      if (needles.some((n) => ct.includes(n))) return kind;
    }
  }
  return "unsupported";
}

/**
 * Whether the document is a PDF (story 51). PDFs render through the PDF.js
 * library viewer (native thumbnail sidebar + fit-to-width) and keep the
 * "Nội dung đã số hóa" tab; every other kind shows only its original content.
 *
 * @param {string} [name]
 * @param {string} [contentType]
 * @returns {boolean}
 */
export function isPdf(name, contentType) {
  return fileKindFor(name, contentType) === "pdf";
}

/**
 * Whether the viewer should show the "đang chờ xử lý" (not-yet-processed) state.
 *
 * A repo document that has not been processed yet has no digitized pages AND no
 * original file (the BE proxy 404s) — we treat that combo as "waiting", which is
 * a clearer message than the old separate "no pages" / "file unavailable" texts.
 * Real load errors (network/permission) are handled separately by the caller.
 *
 * @param {{pageCount?: number, fileFailed?: boolean}} state
 * @returns {boolean}
 */
export function isUnprocessed({ pageCount, fileFailed } = {}) {
  return !pageCount && Boolean(fileFailed);
}

// ── Citation highlight (directive review) ────────────────────────────────────

// Prefix length used when the full quote does not match (OCR drift between the
// chunker's text and the page text). 80 chars is long enough to be unambiguous
// and short enough to survive tail drift.
const QUOTE_PREFIX_LEN = 80;

/**
 * Normalize text for quote matching: collapse all whitespace runs to single
 * spaces. Returns the normalized string AND a map from each normalized index
 * to its raw-string index, so a match can be projected back onto the raw text.
 */
function normalizeWithMap(raw) {
  const chars = [];
  const map = [];
  let lastWasSpace = true; // leading whitespace is dropped
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (/\s/.test(ch)) {
      if (!lastWasSpace) {
        chars.push(" ");
        map.push(i);
        lastWasSpace = true;
      }
    } else {
      chars.push(ch);
      map.push(i);
      lastWasSpace = false;
    }
  }
  // Trailing collapsed space is harmless for indexOf purposes.
  return { text: chars.join(""), map };
}

/**
 * Locate `quote` inside `text`, tolerant of whitespace differences.
 *
 * @param {string} text  the raw page/content text
 * @param {string} quote the cited passage (~280 chars from the AI service)
 * @returns {{start:number, end:number}|null} raw-text indices, or null
 *
 * Strategy: exact match on whitespace-normalized text first, then a
 * QUOTE_PREFIX_LEN-prefix fallback; null when neither matches.
 */
export function findQuoteRange(text, quote) {
  const rawQuote = String(quote || "").trim();
  const rawText = String(text || "");
  if (!rawQuote || !rawText) return null;

  const { text: nText, map } = normalizeWithMap(rawText);
  const nQuote = normalizeWithMap(rawQuote).text;
  if (!nQuote) return null;

  const tryFind = (needle) => {
    if (!needle) return null;
    const at = nText.indexOf(needle);
    if (at < 0) return null;
    const start = map[at];
    const lastNorm = at + needle.length - 1;
    // map has one entry per normalized char; the end is exclusive on raw.
    const end = map[lastNorm] + 1;
    return { start, end };
  };

  return (
    tryFind(nQuote) ||
    (nQuote.length > QUOTE_PREFIX_LEN
      ? tryFind(nQuote.slice(0, QUOTE_PREFIX_LEN).trimEnd())
      : null)
  );
}

/**
 * Build the PDF iframe src fragment. The base `#zoom=page-width&pagemode=none`
 * is today's story-57/58 fragment and must be preserved verbatim; a cited page
 * is PREPENDED as `page=N`. Called exactly once per object URL — the result
 * must never be mutated afterwards (story 57: a changed src reloads the PDF).
 *
 * @param {string} objectUrl
 * @param {number|null|undefined} page 1-based cited page
 * @returns {string}
 */
export function mergePdfFragment(objectUrl, page) {
  const base = "zoom=page-width&pagemode=none";
  const frag = page && page > 0 ? `page=${page}&${base}` : base;
  return `${objectUrl}#${frag}`;
}

/**
 * Project a cited quote onto pdfjs text items (story: PDF.js citation
 * highlight). Joins the items' strings into one page string — items with
 * `hasEOL` get a "\n" appended so line breaks survive as whitespace for
 * {@link findQuoteRange}'s normalization — locates the quote, then maps the
 * match back to per-item LOCAL ranges.
 *
 * @param {Array<{str?: string, hasEOL?: boolean}>} textItems
 *   `page.getTextContent().items` from pdfjs.
 * @param {string} quote the cited passage
 * @returns {Map<number, {start: number, end: number}>|null}
 *   itemIndex → local {start, end} (end exclusive) for every item the match
 *   overlaps, or null when the quote is not found.
 */
export function mapQuoteToItemRanges(textItems, quote) {
  if (!Array.isArray(textItems) || textItems.length === 0) return null;

  let joined = "";
  const bounds = [];
  for (const it of textItems) {
    const str = typeof it?.str === "string" ? it.str : "";
    bounds.push({ start: joined.length, end: joined.length + str.length });
    joined += str;
    if (it?.hasEOL) joined += "\n";
  }

  const range = findQuoteRange(joined, quote);
  if (!range) return null;

  const out = new Map();
  for (let i = 0; i < bounds.length; i++) {
    const b = bounds[i];
    const s = Math.max(range.start, b.start);
    const e = Math.min(range.end, b.end);
    if (s < e) out.set(i, { start: s - b.start, end: e - b.start });
  }
  return out.size > 0 ? out : null;
}
