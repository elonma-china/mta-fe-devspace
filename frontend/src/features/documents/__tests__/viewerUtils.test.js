// src/features/documents/__tests__/viewerUtils.test.js
import {
  clampSplitRatio,
  ratioFromPointer,
  clampPage,
  pageTextFor,
  pageSnippet,
  MIN_SPLIT_RATIO,
  MAX_SPLIT_RATIO,
  DEFAULT_SPLIT_RATIO,
  VIEWER_TABS,
  fileKindFor,
  isUnprocessed,
  pageAtScroll,
} from "features/documents/components/viewer/viewerUtils";

describe("viewerUtils", () => {
  test("clampSplitRatio_keepsWithinBounds", () => {
    expect(clampSplitRatio(0.05)).toBe(MIN_SPLIT_RATIO);
    expect(clampSplitRatio(0.95)).toBe(MAX_SPLIT_RATIO);
    expect(clampSplitRatio(0.5)).toBe(0.5);
  });

  test("clampSplitRatio_nonFinite_returnsDefault", () => {
    expect(clampSplitRatio(NaN)).toBe(DEFAULT_SPLIT_RATIO);
    expect(clampSplitRatio(undefined)).toBe(DEFAULT_SPLIT_RATIO);
  });

  test("ratioFromPointer_computesAndClamps", () => {
    // pointer at 50% of a 1000px container starting at 0
    expect(ratioFromPointer(500, 0, 1000)).toBe(0.5);
    // pointer far left clamps to min
    expect(ratioFromPointer(0, 0, 1000)).toBe(MIN_SPLIT_RATIO);
    // zero width returns default
    expect(ratioFromPointer(500, 0, 0)).toBe(DEFAULT_SPLIT_RATIO);
  });

  test("clampPage_boundsToPageCount", () => {
    expect(clampPage(0, 4)).toBe(1);
    expect(clampPage(5, 4)).toBe(4);
    expect(clampPage(2, 4)).toBe(2);
    expect(clampPage(2, 0)).toBe(1);
  });

  test("pageTextFor_findsByPageNumber", () => {
    const pages = [
      { page_number: 1, content: "A" },
      { page_number: 2, content: "B" },
    ];
    expect(pageTextFor(pages, 2)).toBe("B");
    expect(pageTextFor(pages, 9)).toBe("");
    expect(pageTextFor(null, 1)).toBe("");
  });

  // Story 29: thumbnail text-snippet fallback (when no page image).
  test("pageSnippet_trimsAndTruncates", () => {
    const pages = [
      { page_number: 1, content: "  Hello world this is a long page  " },
      { page_number: 2, content: "" },
    ];
    expect(pageSnippet(pages, 1, 5)).toBe("Hello…");
    expect(pageSnippet(pages, 1, 100)).toBe("Hello world this is a long page");
    expect(pageSnippet(pages, 2, 10)).toBe(""); // empty content
    expect(pageSnippet(pages, 9, 10)).toBe(""); // missing page
    expect(pageSnippet([], 1)).toBe("");
  });

  test("VIEWER_TABS_hasTwoTabs", () => {
    expect(VIEWER_TABS.ORIGINAL).toBe("original");
    expect(VIEWER_TABS.DIGITIZED).toBe("digitized");
  });

  test("fileKindFor_pdf_returnsPdf", () => {
    expect(fileKindFor("report.pdf")).toBe("pdf");
    expect(fileKindFor("REPORT.PDF")).toBe("pdf");
  });

  test("fileKindFor_docx_returnsDocx", () => {
    expect(fileKindFor("06_chinh_sach_nhan_su.docx")).toBe("docx");
  });

  test("fileKindFor_xlsxAndCsv_returnsSheet", () => {
    expect(fileKindFor("data.xlsx")).toBe("sheet");
    expect(fileKindFor("data.csv")).toBe("sheet");
  });

  test("fileKindFor_txtAndMd_returnsText", () => {
    expect(fileKindFor("notes.txt")).toBe("text");
    expect(fileKindFor("readme.md")).toBe("text");
  });

  test("fileKindFor_images_returnsImage", () => {
    expect(fileKindFor("scan.png")).toBe("image");
    expect(fileKindFor("scan.JPG")).toBe("image");
    expect(fileKindFor("scan.jpeg")).toBe("image");
  });

  test("fileKindFor_unknown_returnsUnsupported", () => {
    expect(fileKindFor("legacy.ppt")).toBe("unsupported");
    expect(fileKindFor("archive.zip")).toBe("unsupported");
    expect(fileKindFor("")).toBe("unsupported");
  });

  test("fileKindFor_fallsBackToContentType_whenNoExt", () => {
    expect(fileKindFor("noext", "application/pdf")).toBe("pdf");
    expect(
      fileKindFor(
        "noext",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      )
    ).toBe("docx");
    expect(fileKindFor("noext", "text/csv")).toBe("sheet");
    expect(fileKindFor("noext", "image/png")).toBe("image");
    expect(fileKindFor("noext", "application/octet-stream")).toBe(
      "unsupported"
    );
  });

  test("isUnprocessed_noPagesAndFileFailed_returnsTrue", () => {
    expect(isUnprocessed({ pageCount: 0, fileFailed: true })).toBe(true);
  });

  test("isUnprocessed_hasPages_returnsFalse", () => {
    expect(isUnprocessed({ pageCount: 3, fileFailed: true })).toBe(false);
    expect(isUnprocessed({ pageCount: 2, fileFailed: false })).toBe(false);
  });

  test("isUnprocessed_fileLoadedButNoPages_returnsFalse", () => {
    // File loaded fine (fileFailed=false) but no digitized pages — that's a
    // viewable file, not a "waiting" state.
    expect(isUnprocessed({ pageCount: 0, fileFailed: false })).toBe(false);
  });

  // ── Story 133: page counter follows the page actually in view ──────────────
  // `sections` = [{ page, top }] where `top` is each page section's offset
  // within the scroll container (px). The old IntersectionObserver picked the
  // TOPMOST still-intersecting section, so it lagged one page behind the page
  // filling the viewport (e.g. reading page 10 showed "9/10"). `pageAtScroll`
  // returns the page whose top has passed a reading line just below the
  // viewport top, with a bottom-guard so a short LAST page reads as N/N.
  describe("pageAtScroll", () => {
    // 3 pages, 1000px tall each, in a 800px-tall viewport of a 3000px column.
    const sections = [
      { page: 1, top: 0 },
      { page: 2, top: 1000 },
      { page: 3, top: 2000 },
    ];
    const CLIENT = 800;
    const SCROLL_H = 3000;

    test("pageAtScroll_topOfDoc_returnsFirstPage", () => {
      expect(pageAtScroll(sections, 0, CLIENT, SCROLL_H)).toBe(1);
    });

    test("pageAtScroll_scrolledToPage2_returnsTwoNotOne", () => {
      // Scrolled so page 2 fills the viewport (scrollTop ~ page 2 top). The old
      // "topmost intersecting" logic returned 1 here — the off-by-one bug.
      expect(pageAtScroll(sections, 1000, CLIENT, SCROLL_H)).toBe(2);
      // Even slightly before fully aligned, once page 2's top passes the
      // reading line (25% down) it counts as current.
      expect(pageAtScroll(sections, 820, CLIENT, SCROLL_H)).toBe(2);
    });

    test("pageAtScroll_stillOnPage1_beforeReadingLine", () => {
      // Barely scrolled — page 2's top (1000) is still below the reading line
      // (scrollTop 100 + 25%*800 = 300), so page 1 is current.
      expect(pageAtScroll(sections, 100, CLIENT, SCROLL_H)).toBe(1);
    });

    test("pageAtScroll_shortLastPage_scrolledToBottom_returnsN", () => {
      // A short last page: total scrollable content ends at 2200 (page 3 only
      // 200px). At the bottom, page 2 still fills most of the viewport, but the
      // user scrolled to READ page 3 → must read N/N, not N-1/N.
      const shortLast = [
        { page: 1, top: 0 },
        { page: 2, top: 1000 },
        { page: 3, top: 2000 },
      ];
      const scrollH = 2200; // page 3 is only 200px tall
      const bottomScrollTop = scrollH - CLIENT; // 1400 = scrolled fully down
      expect(pageAtScroll(shortLast, bottomScrollTop, CLIENT, scrollH)).toBe(3);
    });

    test("pageAtScroll_notScrollable_returnsFirstPage", () => {
      // Content shorter than the viewport → nothing to scroll → page 1.
      expect(pageAtScroll(sections, 0, 4000, 3000)).toBe(1);
    });

    test("pageAtScroll_unsortedInput_stillCorrect", () => {
      const unsorted = [
        { page: 3, top: 2000 },
        { page: 1, top: 0 },
        { page: 2, top: 1000 },
      ];
      expect(pageAtScroll(unsorted, 1000, CLIENT, SCROLL_H)).toBe(2);
    });

    test("pageAtScroll_emptyOrInvalid_returnsNull", () => {
      expect(pageAtScroll([], 0, 800, 3000)).toBeNull();
      expect(pageAtScroll(null, 0, 800, 3000)).toBeNull();
    });
  });
});
