// src/features/documents/__tests__/viewerHost.test.js
import {
  openViewer,
  closeViewer,
  reconcileViewerOnContext,
  isViewerOpen,
  sourceViewerDoc,
} from "features/documents/components/viewer/viewerHost";

describe("viewerHost", () => {
  test("openViewer_setsDoc", () => {
    expect(openViewer(null, { id: "d1", name: "a.pdf" })).toEqual({
      id: "d1",
      name: "a.pdf",
    });
  });

  test("openViewer_ignoresInvalidDoc", () => {
    expect(openViewer(null, null)).toBeNull();
    expect(openViewer(null, { name: "x" })).toBeNull();
  });

  test("closeViewer_restoresAnalysis_returnsNull", () => {
    expect(closeViewer()).toBeNull();
  });

  test("reconcileViewerOnContext_closesOnConversationChange", () => {
    const cur = { id: "d1", name: "a.pdf" };
    expect(reconcileViewerOnContext(cur, { conversationChanged: true })).toBeNull();
    expect(reconcileViewerOnContext(cur, { leftChat: true })).toBeNull();
    expect(reconcileViewerOnContext(cur, { mobileTabChanged: true })).toBeNull();
  });

  test("reconcileViewerOnContext_keepsWhenNoContextChange", () => {
    const cur = { id: "d1", name: "a.pdf" };
    expect(reconcileViewerOnContext(cur, {})).toBe(cur);
  });

  test("isViewerOpen_reflectsState", () => {
    expect(isViewerOpen(null)).toBe(false);
    expect(isViewerOpen({ id: "d1", name: "a" })).toBe(true);
  });
});

// Story 109: resolve a chat citation source into a paged viewer doc. A source
// carries `document_id` + `metadata.page_number`; we match it against the
// conversation's document list (same id space the AI was queried with) so the
// viewer opens the RIGHT doc at the RIGHT page. Returns null when the cited doc
// is not part of this session → caller falls back to the SourceCard popover.
describe("sourceViewerDoc", () => {
  const docs = [
    { id: "d1", name: "Bao_cao.pdf", from_repository: true },
    { id: "d2", name: "notes.docx" },
    { id: 7, name: "num.pdf" },
  ];

  test("matchedDoc_returnsIdNamePage", () => {
    const src = { document_id: "d1", metadata: { page_number: 3 } };
    expect(sourceViewerDoc(src, docs)).toEqual({
      id: "d1",
      name: "Bao_cao.pdf",
      page: 3,
    });
  });

  test("idIsNumericVsString_stillMatches", () => {
    // Source id is a string "7" but the store doc id is the number 7 → the
    // helper coerces with String() so they still match.
    const src = { document_id: "7", metadata: { page_number: 1 } };
    expect(sourceViewerDoc(src, docs)).toEqual({
      id: 7,
      name: "num.pdf",
      page: 1,
    });
  });

  test("missingPage_pageUndefined", () => {
    const src = { document_id: "d2", metadata: {} };
    expect(sourceViewerDoc(src, docs)).toEqual({
      id: "d2",
      name: "notes.docx",
      page: undefined,
    });
  });

  test("legacyPageKey_resolves", () => {
    const src = { document_id: "d1", metadata: { page: 5 } };
    expect(sourceViewerDoc(src, docs).page).toBe(5);
  });

  test("unmatchedDoc_returnsNull", () => {
    expect(sourceViewerDoc({ document_id: "zzz" }, docs)).toBeNull();
  });

  test("missingDocumentId_returnsNull", () => {
    expect(sourceViewerDoc({ metadata: { page_number: 1 } }, docs)).toBeNull();
    expect(sourceViewerDoc(null, docs)).toBeNull();
    expect(sourceViewerDoc({ document_id: "" }, docs)).toBeNull();
  });

  test("emptyDocuments_returnsNull", () => {
    expect(sourceViewerDoc({ document_id: "d1" }, [])).toBeNull();
    expect(sourceViewerDoc({ document_id: "d1" }, undefined)).toBeNull();
  });

  // The citation text alone over-marks: it is window-enriched, so on a short
  // document it IS the document and the viewer lit up ~93% of the page. The
  // answer is what says which part of it was used, so it has to be carried too.
  test("includesTheAnswerItWasCitedBy", () => {
    const src = { document_id: "d1", enriched_content: "cả trang" };
    expect(sourceViewerDoc(src, docs, "Chi phí tăng 2,1% [Nguồn 1].").answer)
      .toBe("Chi phí tăng 2,1% [Nguồn 1].");
  });

  test("noAnswerGiven_leavesItUndefined", () => {
    // Admin/repo previews open the same viewer with no answer behind them.
    const src = { document_id: "d1", enriched_content: "cả trang" };
    expect(sourceViewerDoc(src, docs).answer).toBeUndefined();
    expect(sourceViewerDoc(src, docs, "").answer).toBeUndefined();
  });

  // Story 110: carry the citation text so the viewer can highlight the matching
  // content on the focused page.
  test("includesHighlightText", () => {
    const src = {
      document_id: "d1",
      metadata: { page_number: 2 },
      enriched_content: "Doanh thu thuần 1.560.000 triệu VNĐ",
    };
    expect(sourceViewerDoc(src, docs).highlight).toBe(
      "Doanh thu thuần 1.560.000 triệu VNĐ"
    );
  });

  test("noEnrichedContent_highlightUndefined", () => {
    const res = sourceViewerDoc({ document_id: "d1", metadata: {} }, docs);
    expect(res.highlight).toBeUndefined();
  });

  // Cross-page citation fix: a window-enriched source can carry per-page
  // segments (context_metadata.page_segments) when its content spans more
  // than one page — forward them so the viewer can highlight each on its
  // own correct page instead of forcing everything onto one.
  test("includesSegments_whenPageSegmentsPresent", () => {
    const src = {
      document_id: "d1",
      metadata: { page_number: 2 },
      context_metadata: {
        page_segments: [
          { page_number: 1, text: "a" },
          { page_number: 2, text: "b" },
        ],
      },
    };
    expect(sourceViewerDoc(src, docs).segments).toEqual([
      { page_number: 1, text: "a" },
      { page_number: 2, text: "b" },
    ]);
  });

  test("noContextMetadata_segmentsUndefined", () => {
    const src = { document_id: "d1", metadata: { page_number: 2 } };
    expect(sourceViewerDoc(src, docs).segments).toBeUndefined();
  });

  test("emptyPageSegmentsArray_segmentsUndefined", () => {
    const src = {
      document_id: "d1",
      metadata: { page_number: 2 },
      context_metadata: { page_segments: [] },
    };
    expect(sourceViewerDoc(src, docs).segments).toBeUndefined();
  });

  test("malformedPageSegments_segmentsUndefined", () => {
    const src = {
      document_id: "d1",
      metadata: { page_number: 2 },
      context_metadata: { page_segments: "not-an-array" },
    };
    expect(sourceViewerDoc(src, docs).segments).toBeUndefined();
  });
});
