// src/features/documents/__tests__/viewerHighlightOffsets.test.js
//
// Highlighting by character offset instead of by matching text.
//
// A citation now carries `char_start`/`char_end` in the document's source text,
// and each page carries its own span in that same text. Subtracting one from
// the other gives the exact range to mark — no normalization, no sentence
// splitting, no tolerance for OCR drift, because no comparison happens at all.
//
// The text-matching path stays as the fallback for citations and pages that
// predate the offsets; these tests cover the exact path and its refusals.

import { rangeFromCharSpan } from "features/documents/components/viewer/viewerHighlight";

// A page whose text starts at char 100 of the document's source text.
const PAGE = { page_number: 2, content: "0123456789ABCDEFGHIJ", char_start: 100, char_end: 120 };

test("rangeFromCharSpan_citationInsidePage_marksExactRange", () => {
  // Document chars 105..110 → page-local 5..10 → "56789".
  const hl = rangeFromCharSpan(PAGE, 105, 110);
  expect(hl).toEqual({ mode: "spans", ranges: [[5, 10]] });
  expect(PAGE.content.slice(5, 10)).toBe("56789");
});

test("rangeFromCharSpan_citationStartsBeforePage_clipsToPageStart", () => {
  // A chunk that begins on the previous page: mark from this page's first char.
  const hl = rangeFromCharSpan(PAGE, 80, 104);
  expect(hl).toEqual({ mode: "spans", ranges: [[0, 4]] });
});

test("rangeFromCharSpan_citationRunsPastPage_clipsToPageEnd", () => {
  const hl = rangeFromCharSpan(PAGE, 115, 400);
  expect(hl).toEqual({ mode: "spans", ranges: [[15, 20]] });
});

test("rangeFromCharSpan_citationCoversWholePage_marksWholePage", () => {
  const hl = rangeFromCharSpan(PAGE, 0, 9999);
  expect(hl).toEqual({ mode: "spans", ranges: [[0, 20]] });
});

test("rangeFromCharSpan_citationOnAnotherPage_marksNothing", () => {
  // No overlap at all — the caller must fall back rather than mark a wrong span.
  expect(rangeFromCharSpan(PAGE, 500, 600)).toEqual({ mode: "none" });
  expect(rangeFromCharSpan(PAGE, 0, 100)).toEqual({ mode: "none" });
});

test("rangeFromCharSpan_pageWithoutSpan_marksNothing", () => {
  // Pre-migration upstream: no page span published → cannot subtract.
  const bare = { page_number: 2, content: "abc" };
  expect(rangeFromCharSpan(bare, 1, 2)).toEqual({ mode: "none" });
});

test("rangeFromCharSpan_citationWithoutOffsets_marksNothing", () => {
  expect(rangeFromCharSpan(PAGE, undefined, undefined)).toEqual({ mode: "none" });
  expect(rangeFromCharSpan(PAGE, null, 110)).toEqual({ mode: "none" });
  expect(rangeFromCharSpan(PAGE, 105, null)).toEqual({ mode: "none" });
});

test("rangeFromCharSpan_emptyOrInvertedRange_marksNothing", () => {
  expect(rangeFromCharSpan(PAGE, 105, 105)).toEqual({ mode: "none" });
  expect(rangeFromCharSpan(PAGE, 110, 105)).toEqual({ mode: "none" });
});

test("rangeFromCharSpan_pageTextShorterThanItsSpan_clampsToTheText", () => {
  // Upstream page text and its span can disagree (a truncated preview). Never
  // hand the renderer a range past the end of the string it will slice.
  const short = { page_number: 2, content: "abcde", char_start: 100, char_end: 200 };
  expect(rangeFromCharSpan(short, 100, 180)).toEqual({ mode: "spans", ranges: [[0, 5]] });
});

test("rangeFromCharSpan_missingPage_marksNothing", () => {
  expect(rangeFromCharSpan(undefined, 1, 2)).toEqual({ mode: "none" });
  expect(rangeFromCharSpan(null, 1, 2)).toEqual({ mode: "none" });
});

// ── Corroboration ───────────────────────────────────────────────────────────
//
// Offsets are only as good as the data. 7% of the already-indexed chunks still
// carry offsets that do not describe their own text — the migration relocates
// conservatively and never guesses. For those, marking the computed range would
// be confidently wrong, which is worse than the text matching it replaced. So
// when the caller passes the citation's text, the range must corroborate it
// before being trusted.

const REAL_PAGE = {
  page_number: 2,
  content: "Điều 5. Nguyên tắc áp dụng. Ghi chú nội bộ.",
  char_start: 100,
  char_end: 142,
};

test("rangeFromCharSpan_rangeMatchesTheCitation_isTrusted", () => {
  const hl = rangeFromCharSpan(REAL_PAGE, 100, 127, "Điều 5. Nguyên tắc áp dụng.");
  expect(hl).toEqual({ mode: "spans", ranges: [[0, 27]] });
});

test("rangeFromCharSpan_citationLongerThanTheSlice_isTrusted", () => {
  // A chunk clipped by the page boundary, or one carrying a borrowed overlap
  // prefix: the slice is PART of the citation, which still corroborates it.
  const hl = rangeFromCharSpan(
    REAL_PAGE, 100, 127, "…phần trước… Điều 5. Nguyên tắc áp dụng. …phần sau…"
  );
  expect(hl.mode).toBe("spans");
});

test("rangeFromCharSpan_sliceLongerThanTheCitation_isTrusted", () => {
  const hl = rangeFromCharSpan(REAL_PAGE, 100, 142, "Nguyên tắc áp dụng");
  expect(hl.mode).toBe("spans");
});

test("rangeFromCharSpan_rangeContradictsTheCitation_marksNothing", () => {
  // A stale offset pointing somewhere else on the page. Refuse, so the caller
  // falls back to matching rather than marking the wrong passage.
  const hl = rangeFromCharSpan(REAL_PAGE, 127, 142, "Điều 5. Nguyên tắc áp dụng.");
  expect(hl).toEqual({ mode: "none" });
});

test("rangeFromCharSpan_ignoresWhitespaceAndCaseWhenCorroborating", () => {
  const hl = rangeFromCharSpan(
    REAL_PAGE, 100, 127, "  điều 5.   nguyên tắc\náp dụng.  "
  );
  expect(hl.mode).toBe("spans");
});

test("rangeFromCharSpan_sliceTooShortToCorroborate_marksNothing", () => {
  // A few characters match anything; that is not evidence the offset is right.
  const hl = rangeFromCharSpan(REAL_PAGE, 98, 104, "Điều 5. Nguyên tắc áp dụng.");
  expect(hl).toEqual({ mode: "none" });
});

test("rangeFromCharSpan_noCitationTextGiven_skipsCorroboration", () => {
  // Nothing to check against — the offsets are all the caller has.
  expect(rangeFromCharSpan(REAL_PAGE, 100, 127)).toEqual({
    mode: "spans", ranges: [[0, 27]],
  });
});
