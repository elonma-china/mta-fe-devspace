// src/features/documents/components/viewer/viewerHighlight.js
//
// Story 110: pure helpers to highlight the cited content on the FOCUSED page of
// the digitized viewer. Scoped to ONE page's text (the caller passes only the
// target page) so it scales to large multi-page documents — no cross-page scan.
//
// A citation's provenance is page-level and its `enriched_content` may be the
// whole page (or span several pages), and can mismatch the digitized text where
// tables / non-contiguous structures OCR differently. Story 113: match at
// SENTENCE granularity (split on newlines + sentence punctuation, with tolerant
// normalization that strips table pipes / bullets / nbsp) and MARK the matching
// segments; there is no whole-page tint:
//   - "spans": ≥1 segment of the page matches the citation → mark those segments
//   - "none":  no reliable match, empty page, or no citation text
// Story 132: the viewer trusts the API `page_number` (document → page → text)
// and calls this on THAT page only — no whole-document page search.
//
// Keeping this framework-free makes it unit-testable without rendering (ADR-008).

const DEFAULTS = {
  minLen: 12, // a segment must be at least this long (normalized) to count
  // How many consecutive words a page segment and the answer must share before
  // the segment counts as one the answer actually drew on. Low enough that a
  // paraphrase still anchors (the model keeps phrases, not sentences), high
  // enough that a shared opening like "trong tháng 05/2026, đơn vị" does not
  // drag in the neighbouring paragraph.
  runLen: 5,
};

/**
 * Normalize for tolerant matching: lowercase, drop table pipes / bullet glyphs /
 * non-breaking spaces (which serialize differently across OCR/chunk pipelines),
 * then collapse whitespace. Length is NOT preserved — used only for comparison,
 * never to compute render offsets.
 */
function norm(s) {
  return String(s || "")
    .replace(/ /g, " ") // nbsp → space
    .toLowerCase()
    .replace(/[|•·●▪◦*]/g, " ") // table pipes + bullet glyphs
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split text into candidate segments, each as a `[start,end]` offset pair into
 * the ORIGINAL text (already trimmed of leading/trailing whitespace). Segments
 * break on newlines and on sentence punctuation FOLLOWED BY whitespace — so
 * dotted numbers like "1.560.000" (no trailing space) are never split.
 *
 * @param {string} text
 * @returns {Array<[number,number]>}
 */
function candidateRanges(text) {
  const out = [];
  const boundary = /[.;!?]\s|\n/g;
  let segStart = 0;
  let m;
  const push = (s, e) => {
    const raw = text.slice(s, e);
    const lead = raw.length - raw.trimStart().length;
    const trail = raw.length - raw.trimEnd().length;
    const start = s + lead;
    const end = e - trail;
    if (end > start) out.push([start, end]);
  };
  while ((m = boundary.exec(text)) !== null) {
    push(segStart, m.index); // segment BEFORE the delimiter (delimiter excluded)
    segStart = m.index + m[0].length; // skip the delimiter (punct+space or \n)
  }
  push(segStart, text.length);
  return out;
}

/** Normalized words of `s`, or `[]`. */
function words(s) {
  const n = norm(s);
  return n ? n.split(" ") : [];
}

/** Every run of `len` consecutive words in `list`, as joined strings. */
function runs(list, len) {
  const out = new Set();
  for (let i = 0; i + len <= list.length; i += 1) {
    out.add(list.slice(i, i + len).join(" "));
  }
  return out;
}

/**
 * Keep only the segments the answer actually drew on.
 *
 * `enriched_content` is window-enriched, so for a short document it is the whole
 * document and "which part of this page does the citation cover" answers "all of
 * it" — the viewer marked ~93% of the page for an answer that used two
 * sentences. The citation says which chunk was retrieved; the answer is the only
 * thing that says which part of it was used.
 *
 * A segment survives when it shares a run of `runLen` consecutive words with the
 * answer. The model paraphrases rather than quotes, so whole-sentence matching
 * finds nothing, but it keeps phrases ("chi phí hoạt động tăng 2,1% lên").
 *
 * Returns `ranges` untouched when the answer anchors nothing: a heavily
 * reworded answer would otherwise blank the highlight entirely, and showing the
 * evidence that was retrieved beats showing none of it.
 */
function narrowToAnswer(text, ranges, answerText, runLen) {
  const answerRuns = runs(words(answerText), runLen);
  if (answerRuns.size === 0) return ranges;

  const kept = ranges.filter(([s, e]) => {
    const w = words(text.slice(s, e));
    for (let i = 0; i + runLen <= w.length; i += 1) {
      if (answerRuns.has(w.slice(i, i + runLen).join(" "))) return true;
    }
    return false;
  });
  return kept.length > 0 ? kept : ranges;
}

/**
 * Decide the highlight for one page.
 *
 * @param {string} pageText  the target page's digitized text
 * @param {string} citeText  the citation's enriched_content
 * @param {{minLen?:number, runLen?:number, answerText?:string}} [opts]
 *   `answerText` — the answer this citation belongs to. When given, the marks are
 *   narrowed to the part of the citation the answer used; the citation still
 *   bounds them, so nothing outside it is ever marked.
 * @returns {{mode:"spans", ranges:Array<[number,number]>} | {mode:"none"}}
 */
export function computePageHighlight(pageText, citeText, opts = {}) {
  const { minLen, runLen, answerText } = { ...DEFAULTS, ...opts };
  const text = String(pageText || "");
  if (!text.trim()) return { mode: "none" };
  const nc = norm(citeText);
  if (!nc) return { mode: "none" };

  let ranges = [];
  for (const [s, e] of candidateRanges(text)) {
    const ns = norm(text.slice(s, e));
    if (ns.length < minLen) continue;
    if (nc.includes(ns)) ranges.push([s, e]);
  }
  if (ranges.length === 0) return { mode: "none" };

  if (answerText) ranges = narrowToAnswer(text, ranges, answerText, runLen);

  // Merge adjacent/overlapping ranges (gap ≤ 1 char).
  const merged = [];
  for (const r of ranges.sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return { mode: "spans", ranges: merged };
}

/**
 * Decide the highlight for one page from character offsets — no text matching.
 *
 * A citation carries `char_start`/`char_end` in the document's source text, and
 * a page carries its own span in that same text, so the range to mark is a
 * subtraction. That removes every failure mode of {@link computePageHighlight}:
 * OCR and markdown differences cannot break a comparison that never happens,
 * and the marked range is the cited passage exactly — not the sentences that
 * happened to normalize equal, and not the whole retrieval window around it.
 *
 * Offsets are only as good as the data behind them, so when `citeText` is given
 * the computed range must corroborate it: one of the two must contain the
 * other, once normalized. That holds for a correct offset even when the chunk
 * is clipped by the page boundary or carries a borrowed overlap prefix (the
 * slice is then part of the citation), and fails for a stale offset pointing
 * elsewhere on the page — which would otherwise mark the wrong passage with
 * full confidence, strictly worse than the matching it replaced.
 *
 * Returns "none" whenever the range cannot be trusted (either side missing, no
 * overlap with this page, empty or inverted, uncorroborated) so the caller
 * falls back to matching rather than marking a span it cannot justify.
 *
 * @param {{content?:string, char_start?:number, char_end?:number}} page
 * @param {number} charStart  citation start, in the document's source text
 * @param {number} charEnd    citation end, exclusive
 * @param {string} [citeText] the citation's own text, to corroborate against
 * @returns {{mode:"spans", ranges:Array<[number,number]>} | {mode:"none"}}
 */
export function rangeFromCharSpan(page, charStart, charEnd, citeText) {
  const pageStart = page?.char_start;
  const pageEnd = page?.char_end;
  if (
    !Number.isFinite(pageStart) ||
    !Number.isFinite(pageEnd) ||
    !Number.isFinite(charStart) ||
    !Number.isFinite(charEnd) ||
    charEnd <= charStart
  ) {
    return { mode: "none" };
  }
  // Clip the citation to this page, then rebase onto the page's own text. The
  // page text can be shorter than its span (a truncated preview upstream), so
  // clamp to what will actually be sliced.
  const len = String(page?.content || "").length;
  const start = Math.max(0, Math.min(charStart, charEnd) - pageStart);
  const end = Math.min(len, pageEnd - pageStart, charEnd - pageStart);
  if (end <= start || start >= len) return { mode: "none" };

  if (citeText) {
    const slice = String(page.content).slice(start, end);
    // Too little text to be evidence of anything — a handful of characters
    // matches by chance, so treat it as uncorroborated.
    if (norm(slice).length < DEFAULTS.minLen) return { mode: "none" };
    if (!corroborates(slice, citeText)) return { mode: "none" };
  }
  return { mode: "spans", ranges: [[start, end]] };
}

/**
 * Do these two texts describe the same passage?
 *
 * Compared by shared words rather than containment, because the digitized page
 * and the citation legitimately differ in punctuation and spacing (OCR, markdown,
 * an em-dash for a period) — a strict containment test would reject a correct
 * offset over a single character. Measured in BOTH directions so it holds
 * whether the slice is part of the citation (a chunk clipped by the page
 * boundary, or one carrying a borrowed overlap prefix) or the citation is part
 * of the slice.
 */
function corroborates(sliceText, citeText, minShare = 0.6) {
  const sw = words(sliceText);
  const cw = words(citeText);
  if (sw.length === 0 || cw.length === 0) return false;
  const sSet = new Set(sw);
  const cSet = new Set(cw);
  const inCite = sw.filter((w) => cSet.has(w)).length / sw.length;
  const inSlice = cw.filter((w) => sSet.has(w)).length / cw.length;
  return Math.max(inCite, inSlice) >= minShare;
}

// Story 132: `bestPageForText` / `resolveFocusPage` were removed. The viewer now
// trusts the API's `page_number` (document → page → text priority) and never
// scans the whole document to guess a page — the caller focuses the given page
// and highlights the citation on THAT page only (via `computePageHighlight`).

/**
 * Split text into `{text, marked}` segments given sorted, non-overlapping ranges
 * (as returned by {@link computePageHighlight}). Ranges are clamped to bounds.
 *
 * @param {string} text
 * @param {Array<[number,number]>} ranges
 * @returns {Array<{text:string, marked:boolean}>}
 */
export function segmentByRanges(text, ranges) {
  const t = String(text || "");
  if (!Array.isArray(ranges) || ranges.length === 0) {
    return [{ text: t, marked: false }];
  }
  const segs = [];
  let cur = 0;
  for (const [rs, re] of ranges) {
    const s = Math.max(cur, Math.min(rs, t.length));
    const e = Math.max(s, Math.min(re, t.length));
    if (s > cur) segs.push({ text: t.slice(cur, s), marked: false });
    if (e > s) segs.push({ text: t.slice(s, e), marked: true });
    cur = e;
  }
  if (cur < t.length) segs.push({ text: t.slice(cur), marked: false });
  return segs;
}
