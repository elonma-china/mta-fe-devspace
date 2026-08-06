// src/features/analysis/utils/citations.js
// Build a structured "Nguồn trích dẫn" (sources) section from the backend's
// structured `citations[]` and append it to a report draft.
//
// The AI service returns, alongside `draft_markdown`, a deduped+numbered list:
//   { marker, doc_id, doc_name, page, chunk_id, chunk_index, quote, ... }
// The draft body still carries inline "[Tên VB, tr.X]" text (additive phase),
// so this appends a clean, de-duplicated sources list at the end. It is folded
// into the persisted `content` markdown, so it survives a reload and renders
// through the existing ReactMarkdown pipeline without extra wiring.

import { selectedDocumentIds } from "./reportExport";

const HEADING = "### Nguồn trích dẫn";
const REPORT_SOURCE_PREFIX = "#report-source-";
// Quotes run to ~760 chars and a report carries 12-18 of them; printed whole,
// the sources list reads as a wall of raw digitised text. The full quote stays
// one click away in the SourceCard, so nothing verifiable is lost here.
const QUOTE_PREVIEW_CHARS = 140;
const UNSUPPORTED_MARKER_RE = /[ \t]*\[\?\]/g;

/**
 * Drop the `[?]` marker from a stored report.
 *
 * The backend no longer emits it, but reports generated earlier still carry it
 * in their persisted content and the UI does not accept it in a document.
 */
export function stripUnsupportedMarkers(markdown) {
  return (markdown || "").replace(UNSUPPORTED_MARKER_RE, "");
}

/** Trim a quote to a readable preview, cutting on a word boundary. */
function quotePreview(quote) {
  const text = String(quote).trim();
  if (text.length <= QUOTE_PREVIEW_CHARS) return text;
  const cut = text.slice(0, QUOTE_PREVIEW_CHARS - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function citationLocation(c) {
  if (c.page != null) return `tr.${c.page}`;
  if (c.chunk_index != null) return `đoạn ${c.chunk_index}`;
  return "";
}

/** Structured citations[] from a report info item (if persisted). */
export function reportCitationsFromItem(item) {
  const cites = item?.selected?.citations;
  return Array.isArray(cites) ? cites : [];
}

/**
 * Convert synthesis citations into SourceCard-compatible source objects.
 */
export function reportCitationSources(item) {
  return reportCitationsFromItem(item).map((c) => ({
    document_id: c.doc_id,
    chunk_id: c.chunk_id,
    enriched_content: c.quote || "",
    metadata: {
      page_number: c.page ?? undefined,
      chunk_index: c.chunk_index,
    },
    marker: c.marker,
    doc_name: c.doc_name,
  }));
}

/**
 * Merge report completion metadata into the existing selected JSON payload.
 */
export function mergeReportSelected(existingSelected, { documentIds, templateId, citations }) {
  const base =
    existingSelected && typeof existingSelected === "object" && !Array.isArray(existingSelected)
      ? { ...existingSelected }
      : { document_ids: selectedDocumentIds(existingSelected) };
  if (documentIds) base.document_ids = documentIds;
  if (templateId) base.template_id = templateId;
  if (Array.isArray(citations)) base.citations = citations;
  return base;
}

/**
 * Render the citations list as a markdown block (leading separator + heading).
 * Footer markers are markdown links so they stay clickable after reload.
 */
export function buildCitationsMarkdown(citations) {
  if (!Array.isArray(citations) || citations.length === 0) return "";

  const lines = citations.map((c) => {
    const loc = citationLocation(c);
    const name = c.doc_name || c.doc_id || "(không rõ nguồn)";
    const marker = c.marker;
    const theme = c.theme_hint ? ` — *${String(c.theme_hint).trim()}*` : "";
    const head = marker
      ? `**[${marker}](${REPORT_SOURCE_PREFIX}${marker})** ${name}${loc ? ` — ${loc}` : ""}${theme}`
      : `**${name}**${loc ? ` — ${loc}` : ""}${theme}`;
    const quote = c.quote ? `  \n   _"${quotePreview(c.quote)}"_` : "";
    return `${head}${quote}`;
  });

  return `\n\n---\n\n${HEADING}\n\n${lines.join("\n\n")}\n`;
}

/**
 * Rewrite inline body citations `[Doc, tr.X]` / `[Doc, đoạn N]` into report-source links.
 */
export function toReportCitationLinks(markdown, citations) {
  const base = markdown || "";
  if (!Array.isArray(citations) || citations.length === 0) return base;

  let text = base;
  for (const c of citations) {
    const marker = c.marker;
    const label = c.doc_name || c.doc_id;
    if (!marker || !label) continue;
    const escaped = escapeRegex(label);
    if (c.page != null) {
      const re = new RegExp(`\\[${escaped},\\s*tr\\.${c.page}\\]`, "gi");
      const link = `[${label}, tr.${c.page}](${REPORT_SOURCE_PREFIX}${marker})`;
      text = text.replace(re, (match) => (match.includes("](") ? match : link));
    } else if (c.chunk_index != null) {
      const re = new RegExp(`\\[${escaped},\\s*đoạn\\s*${c.chunk_index}\\]`, "gi");
      const link = `[${label}, đoạn ${c.chunk_index}](${REPORT_SOURCE_PREFIX}${marker})`;
      text = text.replace(re, (match) => (match.includes("](") ? match : link));
    }
  }
  return text;
}

/**
 * Append the sources section to a report's markdown. Idempotent — if the
 * heading is already present (e.g. a re-run of the completion handler), the
 * input is returned unchanged.
 */
export function appendCitations(markdown, citations) {
  const base = markdown || "";
  if (base.includes(HEADING)) return base;
  const block = buildCitationsMarkdown(citations);
  return block ? base + block : base;
}
