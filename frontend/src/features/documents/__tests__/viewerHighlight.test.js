// Story 110: pure highlight helpers. Given ONE page's text + the citation text,
// decide a tiered highlight for that page (scoped to a single page → scales):
//   - "spans": mark the matching lines (Tier A)
//   - "page":  tint the whole page (Tier B — citation ≈ whole page, or too little
//              reliable match e.g. a table whose structure differs)
//   - "none":  nothing (Tier C — empty page / no citation)
import {
  computePageHighlight,
  segmentByRanges,
} from "features/documents/components/viewer/viewerHighlight";

// Story 132: removed the `resolveFocusPage` / `bestPageForText` describes — the
// viewer no longer scans the whole document to pick a page. It trusts the API
// `page_number` and highlights on THAT page only (see documentViewer.test.js
// `documentViewer_trustsPageNumber_*`).

describe("computePageHighlight", () => {
  test("tierA_partialLineMatch_returnsSpans", () => {
    const page =
      "Tiêu đề trang ba\nDoanh thu thuần 1.560.000 triệu\nGhi chú nội bộ khác";
    // The citation contains the revenue line but not the note line.
    const cite =
      "Trong báo cáo: Doanh thu thuần 1.560.000 triệu là tổng thu chính.";
    const res = computePageHighlight(page, cite);
    expect(res.mode).toBe("spans");
    expect(res.ranges.length).toBeGreaterThan(0);
    // The marked range must cover the revenue line, not the note.
    const [s, e] = res.ranges[0];
    expect(page.slice(s, e)).toContain("Doanh thu thuần 1.560.000 triệu");
    expect(page.slice(s, e)).not.toContain("Ghi chú nội bộ");
  });

  // Story 113: even when the citation ≈ the whole page, MARK the matching lines
  // (spans) instead of tinting the whole section. The "page" tint mode is removed.
  test("wholePageCite_marksMatchingLines_spansNotPage", () => {
    const page =
      "Dòng một nội dung dài\nDòng hai nội dung dài\nDòng ba nội dung dài";
    const cite = page + " thêm phần kết luận.";
    const res = computePageHighlight(page, cite);
    expect(res.mode).toBe("spans");
    expect(res.ranges.length).toBeGreaterThan(0);
  });

  // Story 113: no reliable match → "none" (leave plain + scroll to page), NOT a
  // whole-page tint.
  test("noReliableMatch_returnsNone", () => {
    const page = "Chỉ tiêu | 2025 | 2024\nDoanh thu | 1560 | 1342";
    const cite = "Một đoạn văn hoàn toàn khác không liên quan tới bảng số liệu.";
    expect(computePageHighlight(page, cite).mode).toBe("none");
  });

  // Story 113: match at SENTENCE granularity so a citation that quotes ONE
  // sentence of a long DOCX paragraph marks only that sentence — and dotted
  // numbers (1.560.000) are NOT split into separate sentences.
  test("sentenceLevel_marksOnlyMatchingSentence_keepsDottedNumbers", () => {
    const page =
      "Doanh thu thuần đạt 1.560.000 triệu. Chi phí khác không liên quan ở đây.";
    const cite =
      "Theo báo cáo: Doanh thu thuần đạt 1.560.000 triệu là tổng thu chính.";
    const res = computePageHighlight(page, cite);
    expect(res.mode).toBe("spans");
    const marked = res.ranges.map(([s, e]) => page.slice(s, e)).join(" | ");
    expect(marked).toContain("Doanh thu thuần đạt 1.560.000 triệu");
    expect(marked).not.toContain("Chi phí khác");
  });

  // Story 113: normalization strips table pipes / bullets / nbsp so a citation
  // matches a table row despite the different serialization.
  test("normalize_stripsTableChars_matchesTableRow", () => {
    const page = "Chỉ tiêu | Doanh thu thuần | 1.560.000";
    const cite = "Trong bảng: Chỉ tiêu Doanh thu thuần 1.560.000 là dòng đầu.";
    expect(computePageHighlight(page, cite).mode).toBe("spans");
  });

  test("tierC_emptyPage_returnsNone", () => {
    expect(computePageHighlight("", "bất kỳ").mode).toBe("none");
    expect(computePageHighlight("   ", "bất kỳ").mode).toBe("none");
  });

  test("noCite_returnsNone", () => {
    expect(computePageHighlight("nội dung trang", "").mode).toBe("none");
    expect(computePageHighlight("nội dung trang", null).mode).toBe("none");
  });

  test("normalize_caseAndWhitespace_stillMatches", () => {
    const page = "Lợi   nhuận\tsau  thuế 238.400 triệu VNĐ";
    const cite = "lợi nhuận sau thuế 238.400 triệu vnđ (tăng 30,7%)";
    expect(computePageHighlight(page, cite).mode).toBe("spans");
  });

  test("shortLinesBelowMinLen_ignored", () => {
    // A short line (< minLen) that happens to be in the cite must not, alone,
    // create a span match.
    const page = "OK\nMột dòng dài đủ 12+ ký tự để tính khớp thật sự ở đây";
    const cite = "OK và Một dòng dài đủ 12+ ký tự để tính khớp thật sự ở đây";
    const res = computePageHighlight(page, cite);
    // The long line matches → spans; the "OK" line is ignored (too short).
    expect(res.mode).toBe("spans");
    const covers = res.ranges.some(([s, e]) => page.slice(s, e).includes("Một dòng dài"));
    expect(covers).toBe(true);
  });
});

// Narrowing by the answer. `enriched_content` is window-enriched: for a short
// document it is the whole document, so "which part of this page is in the
// citation" answers "all of it" and the viewer lit up ~93% of both pages of the
// document cited in conversation 73 — intro, every section, and the trailing
// "Nguồn trích dẫn" block — for an answer that used two sentences. The citation
// says which chunk was retrieved; only the answer says which part was used.
describe("computePageHighlight — scoped to the answer", () => {
  // Trimmed from the real document behind conversation 73.
  const PAGE = [
    "MẪU BÀI PHÁT BIỂU QUÂN SỰ",
    "Hôm nay, chúng ta tập trung để tổng kết tình hình thực hiện nhiệm vụ trong tháng 05/2026.",
    // Opens with the same words as the answer does — the case `runLen` is set
    // against, since a shared boilerplate opening must not drag a paragraph in.
    "Trong tháng 05/2026, dưới sự lãnh đạo chỉ đạo của cấp trên, đơn vị đã duy trì được đà tăng trưởng ổn định.",
    "Doanh thu thuần đạt 3.420.000.000 VNĐ, tăng 6,8% so với tháng trước.",
    "Tuy nhiên, vẫn còn một số hạn chế cần quan tâm: chi phí hoạt động tăng 2,1% lên 680.000.000 VNĐ.",
    "Về nhiệm vụ quán triệt nghị quyết, chỉ thị, đường lối chính sách: Tiếp tục nâng cao nhận thức chính trị.",
  ].join("\n");
  // The retrieved chunk covers the whole page.
  const CITE = PAGE + "\nNguồn trích dẫn Bao_cao_tai_chinh_1trang.pdf - tr.1";
  // The model paraphrases; it does not quote verbatim.
  const ANSWER =
    "Trong tháng 05/2026, đơn vị có một số hạn chế cần quan tâm bao gồm: " +
    "Chi phí hoạt động tăng 2,1% lên mức 680.000.000 VNĐ [Nguồn 1].";

  const markedText = (res) =>
    res.mode === "spans"
      ? res.ranges.map(([s, e]) => PAGE.slice(s, e)).join(" | ")
      : "";

  test("withoutTheAnswer_marksAlmostTheWholePage", () => {
    // Documents today's behaviour, which is what the fix has to improve on.
    const res = computePageHighlight(PAGE, CITE);
    expect(markedText(res)).toContain("Doanh thu thuần");
    expect(markedText(res)).toContain("MẪU BÀI PHÁT BIỂU");
  });

  test("withTheAnswer_marksOnlyTheSentenceItUsed", () => {
    const res = computePageHighlight(PAGE, CITE, { answerText: ANSWER });
    const marked = markedText(res);
    expect(marked).toContain("chi phí hoạt động tăng 2,1% lên 680.000.000 VNĐ");
    expect(marked).not.toContain("Doanh thu thuần");
    expect(marked).not.toContain("MẪU BÀI PHÁT BIỂU");
    expect(marked).not.toContain("quán triệt nghị quyết");
    // Shares "Trong tháng 05/2026," with the answer and nothing else.
    expect(marked).not.toContain("đà tăng trưởng ổn định");
  });

  test("anAnswerThatQuotesNothing_fallsBackToTheWholeCitation", () => {
    // Heavy paraphrase leaves nothing to anchor on. Showing the evidence that
    // was actually retrieved beats showing nothing at all, so this degrades to
    // the previous behaviour rather than to an empty highlight.
    const res = computePageHighlight(PAGE, CITE, {
      answerText: "Đơn vị cần lưu ý một vài vấn đề về tài chính.",
    });
    expect(res.mode).toBe("spans");
    expect(markedText(res)).toContain("Doanh thu thuần");
  });

  test("noAnswerText_isUnchanged", () => {
    const before = computePageHighlight(PAGE, CITE);
    for (const answerText of [undefined, null, ""]) {
      expect(computePageHighlight(PAGE, CITE, { answerText })).toEqual(before);
    }
  });

  test("anAnswerCannotInventAMatchOutsideTheCitation", () => {
    // The citation still bounds the highlight: the answer may discuss things
    // from other sources, and those must not light up this page.
    const res = computePageHighlight(
      "Doanh thu thuần đạt 3.420.000.000 VNĐ, tăng 6,8% so với tháng trước.",
      "Một đoạn trích hoàn toàn khác, không chứa dòng doanh thu nào.",
      { answerText: "Doanh thu thuần đạt 3.420.000.000 VNĐ, tăng 6,8%." }
    );
    expect(res.mode).toBe("none");
  });
});

describe("segmentByRanges", () => {
  test("splitsMarkedAndUnmarked", () => {
    const text = "abcdefghij";
    const segs = segmentByRanges(text, [[2, 5]]);
    expect(segs).toEqual([
      { text: "ab", marked: false },
      { text: "cde", marked: true },
      { text: "fghij", marked: false },
    ]);
  });

  test("noRanges_returnsSingleUnmarked", () => {
    expect(segmentByRanges("abc", [])).toEqual([{ text: "abc", marked: false }]);
  });

  test("clampsOutOfBoundRanges", () => {
    const segs = segmentByRanges("abc", [[1, 99]]);
    expect(segs).toEqual([
      { text: "a", marked: false },
      { text: "bc", marked: true },
    ]);
  });
});

// Story 132: `bestPageForText` removed (no whole-document page search).
