// src/utils/pageNumber.js
//
// Mirrors backend tools/provenance.py::page_number_from_metadata — same
// priority order (page_number > page > original_page_number) so a chunk's
// page number resolves the same whether read server- or client-side.
// Pre-migration semantic/hybrid chunked documents only carry the legacy
// `page` key (int or list); page 0 is a valid page, never treated as falsy.
export function resolvePageNumber(metadata) {
  if (!metadata) return undefined;
  let page = metadata.page_number ?? metadata.page ?? metadata.original_page_number;
  if (Array.isArray(page)) {
    page = page.length ? page[0] : undefined;
  }
  return Number.isFinite(page) ? page : undefined;
}
