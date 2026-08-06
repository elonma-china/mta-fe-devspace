// src/features/analysis/utils/directiveCitations.js
//
// Directive-review citations: persistence shape + [n]-marker chip links.
//
// Unlike the report type (whose citations arrive separately and get folded
// into the markdown by appendCitations), a directive review's markdown ALREADY
// carries its own "### Nguồn trích dẫn" appendix with matching [n] markers —
// the AI service renumbers verdicts[].citations[].marker globally against the
// same objects the report is rendered from, so markdown and structured data
// always agree. These helpers only (1) persist a slim lookup table and
// (2) turn the existing [n] text into clickable chip links.

export const DR_CITATION_PREFIX = "#dr-citation-";

/**
 * Flatten verdicts[].citations into a slim, marker-deduped, marker-sorted
 * list for persistence in `selected.citations`. First occurrence of a marker
 * wins (all occurrences of a marker describe the same source by construction).
 *
 * @param {Array<{citations?: Array}>} verdicts
 * @returns {Array<{marker:number, doc_id:string, doc_name:string, page:number|null, quote:string}>}
 */
export function flattenDirectiveCitations(verdicts) {
  const byMarker = new Map();
  for (const v of verdicts || []) {
    for (const c of v?.citations || []) {
      if (c?.marker == null || byMarker.has(c.marker)) continue;
      byMarker.set(c.marker, {
        marker: c.marker,
        doc_id: c.doc_id,
        doc_name: c.doc_name,
        page: c.page ?? null,
        quote: c.quote || "",
      });
    }
  }
  return [...byMarker.values()].sort((a, b) => a.marker - b.marker);
}

/**
 * Marker → citation lookup from a persisted info item.
 *
 * @param {object|null} item info_table item
 * @returns {Map<number, object>} empty when nothing was persisted
 */
export function directiveCitationsFromItem(item) {
  const cites = item?.selected?.citations;
  const map = new Map();
  if (Array.isArray(cites)) {
    for (const c of cites) {
      if (c?.marker != null) map.set(Number(c.marker), c);
    }
  }
  return map;
}

// [n] where n is 1-3 digits and NOT followed by "(" (which would make it a
// markdown link label we already authored).
const MARKER_RE = /\[(\d{1,3})\](?!\()/g;

/**
 * Rewrite bare [n] markers into chip links for markers we actually have.
 * Idempotent: in an already-rewritten `[[n]](#dr-citation-n)` the INNER `[n]`
 * is followed by `](` (rejected by the lookahead) and the OUTER match is
 * preceded by `[` (rejected by the offset guard), so nothing double-applies.
 *
 * @param {string} markdown
 * @param {Map<number, object>} markers known citation markers
 * @returns {string}
 */
export function toDirectiveCitationLinks(markdown, markers) {
  const base = markdown || "";
  if (!markers || markers.size === 0) return base;
  return base.replace(MARKER_RE, (match, num, offset) => {
    if (offset > 0 && base[offset - 1] === "[") return match; // inside [[n]](…)
    const n = Number(num);
    if (!markers.has(n)) return match;
    return `[[${n}]](${DR_CITATION_PREFIX}${n})`;
  });
}
