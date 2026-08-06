// src/features/documents/__tests__/documentViewer.test.js
//
// Story 51 — the viewer is file-kind aware:
//   - PDF: two tabs ("File gốc" → PdfDocView library viewer, "Nội dung đã số
//     hóa" → digitized text). No custom thumbnail rail.
//   - Non-PDF: ONLY the original file content (FileOriginalView), no tab bar,
//     no thumbnail.
import React from "react";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";

import DocumentViewer from "features/documents/components/viewer/DocumentViewer";
import useViewerCacheStore from "stores/useViewerCacheStore";

jest.mock("assets/images/x.svg", () => ({
  ReactComponent: () => <span data-testid="x-icon" />,
}));

jest.mock("features/documents/api", () => ({
  getDocumentPages: jest.fn(),
  fetchDocumentFile: jest.fn(),
}));

// Mock the content renderer so these tests stay at the DocumentViewer level
// (which renderer fires by kind is covered by fileOriginalView.test.js). Story
// 52: PDF reverted to FileOriginalView's iframe (no PdfDocView). Capture `page`
// so we can assert PDF forwards the current page.
jest.mock("features/documents/components/viewer/FileOriginalView", () => ({
  __esModule: true,
  default: ({ name, page }) => (
    <div data-testid="file-original-view" data-page={page}>
      FOV:{name}
    </div>
  ),
}));

import {
  getDocumentPages,
  fetchDocumentFile,
} from "features/documents/api";

const pdfProps = {
  documentId: "d1",
  documentName: "doc4.pdf",
  userId: "u1",
  conversationId: "c1",
};

const threePages = {
  name: "doc.pdf",
  page_count: 3,
  pages: [
    { page_number: 1, content: "Nội dung trang một" },
    { page_number: 2, content: "Nội dung trang hai" },
    { page_number: 3, content: "Nội dung trang ba" },
  ],
};

// Story 138: `scrollIntoView` is mocked as a prototype method, so `this` is the
// element it was called on. Recording those elements lets a test assert WHICH
// node the viewer scrolled to (the cited page's own section/mark) and HOW MANY
// scrolls one citation open fires.
let scrollTargets = [];

beforeEach(() => {
  // The viewer cache deliberately persists across mounts in production;
  // tests reuse document ids, so isolate them from each other here.
  useViewerCacheStore.getState().clearViewerCache();
  window.URL.createObjectURL = jest.fn(() => "blob:mock");
  window.URL.revokeObjectURL = jest.fn();
  scrollTargets = [];
  window.HTMLElement.prototype.scrollIntoView = jest.fn(function record() {
    scrollTargets.push(this);
  });
  getDocumentPages.mockReset();
  fetchDocumentFile.mockReset().mockResolvedValue(new Blob(["%PDF"]));
});

// ── PDF: two tabs, library viewer ────────────────────────────────────────────

test("documentViewer_pdf_rendersTwoTabs_fileGocDefault", async () => {
  getDocumentPages.mockResolvedValue({
    name: "doc4.pdf",
    page_count: 2,
    pages: [
      { page_number: 1, content: "Trang 1" },
      { page_number: 2, content: "Trang 2" },
    ],
  });
  render(<DocumentViewer {...pdfProps} />);

  expect(screen.getByRole("tab", { name: "File gốc" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  expect(
    screen.getByRole("tab", { name: "Nội dung đã số hóa" })
  ).toBeInTheDocument();
  // Story 52: PDF renders through FileOriginalView's iframe branch (not a lib).
  await waitFor(() =>
    expect(screen.getByTestId("file-original-view")).toBeInTheDocument()
  );
  // Story 133: the "File gốc" (PDF iframe) tab shows the TOTAL only — its
  // internal page scroll can't be tracked, so a "1/N" there was misleading.
  await waitFor(() =>
    expect(screen.getByText("2 trang")).toBeInTheDocument()
  );
});

test("documentViewer_pageCounter_tabAware_totalOnFileGoc_currentOnDigitized", async () => {
  // Story 133: the counter format follows the tab. "File gốc" (native PDF
  // iframe, untrackable internal scroll) shows only the TOTAL ("N trang");
  // "Nội dung đã số hóa" (scroll-spy tracks the page) shows "current/total".
  getDocumentPages.mockResolvedValue(threePages);
  render(<DocumentViewer {...pdfProps} />);

  // Default tab is "File gốc" → total-only, no "current/…".
  await waitFor(() =>
    expect(screen.getByText("3 trang")).toBeInTheDocument()
  );
  expect(screen.queryByText("1/3 trang")).not.toBeInTheDocument();

  // Switching to the digitized tab shows the current page out of the total.
  fireEvent.click(screen.getByRole("tab", { name: "Nội dung đã số hóa" }));
  await waitFor(() =>
    expect(screen.getByText("1/3 trang")).toBeInTheDocument()
  );
  expect(screen.queryByText("3 trang")).not.toBeInTheDocument();
});

test("documentViewer_pdf_header_tabsRowAboveTitle", async () => {
  getDocumentPages.mockResolvedValue(threePages);
  render(<DocumentViewer {...pdfProps} />);

  const tabs = document.querySelector(".dv-tabs");
  const titlebar = document.querySelector(".dv-titlebar");
  expect(within(tabs).getByRole("button", { name: "Đóng" })).toBeInTheDocument();
  expect(within(tabs).getByRole("tab", { name: "File gốc" })).toBeInTheDocument();
  expect(
    tabs.compareDocumentPosition(titlebar) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
  expect(within(titlebar).getByText("doc4.pdf")).toBeInTheDocument();
});

test("documentViewer_pdf_fileGoc_doesNotForwardPage", async () => {
  getDocumentPages.mockResolvedValue(threePages);
  render(<DocumentViewer {...pdfProps} />);
  // Story 57: the PDF "File gốc" no longer forwards currentPage to
  // FileOriginalView — coupling the iframe src to the (scroll-spy) page reloaded
  // the whole PDF on every page/tab change ("giật/lag"). The browser PDF viewer
  // handles its own page navigation, so no page is passed.
  await waitFor(() =>
    expect(screen.getByTestId("file-original-view")).toBeInTheDocument()
  );
  expect(screen.getByTestId("file-original-view")).not.toHaveAttribute(
    "data-page"
  );
});

// ── Story 109: focus a cited page ────────────────────────────────────────────

test("documentViewer_pdf_initialPage_opensDigitizedAndFileGocForwardsPage", async () => {
  // Story 111: a PDF citation now opens the "Nội dung đã số hóa" tab (so the
  // highlighted cited passage is visible immediately — story 110). The counter
  // reads the cited page, and switching to "File gốc" still focuses the PDF page
  // (`#page` via FileOriginalView). (Story 109 used to open "File gốc" directly.)
  getDocumentPages.mockResolvedValue(threePages);
  render(<DocumentViewer {...pdfProps} initialPage={3} />);

  await waitFor(() =>
    expect(
      screen.getByRole("tab", { name: "Nội dung đã số hóa" })
    ).toHaveAttribute("aria-selected", "true")
  );
  await waitFor(() => expect(screen.getByText("3/3 trang")).toBeInTheDocument());

  // Switching to "File gốc" forwards the cited page to the PDF iframe.
  fireEvent.click(screen.getByRole("tab", { name: "File gốc" }));
  await waitFor(() =>
    expect(screen.getByTestId("file-original-view")).toBeInTheDocument()
  );
  expect(screen.getByTestId("file-original-view")).toHaveAttribute(
    "data-page",
    "3"
  );
});

test("documentViewer_docx_initialPage_showsDigitizedFocus", async () => {
  // A non-PDF (docx) "File gốc" is a continuous blob with no page anchors, so a
  // citation focuses the DIGITIZED per-page text instead: tabs appear, the
  // "Nội dung đã số hóa" tab is active, and the cited page scrolls into view.
  getDocumentPages.mockResolvedValue({
    name: "report.docx",
    page_count: 3,
    pages: [
      { page_number: 1, content: "Trang một" },
      { page_number: 2, content: "Trang hai" },
      { page_number: 3, content: "Trang ba" },
    ],
  });
  fetchDocumentFile.mockResolvedValue(new Blob(["docx-bytes"]));
  render(
    <DocumentViewer {...pdfProps} documentName="report.docx" initialPage={2} />
  );

  await waitFor(() =>
    expect(
      screen.getByRole("tab", { name: "Nội dung đã số hóa" })
    ).toHaveAttribute("aria-selected", "true")
  );
  const digitized = document.querySelector(".dv-digitized");
  expect(within(digitized).getByText("Trang hai")).toBeInTheDocument();
  // The cited page was scrolled into view.
  expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
});

test("documentViewer_nonPdfNoInitialPage_stillNoTabs", async () => {
  // Regression: a non-PDF opened WITHOUT a citation page keeps the story-51
  // behavior — only "File gốc", no tab bar.
  getDocumentPages.mockResolvedValue({
    name: "report.docx",
    page_count: 2,
    pages: [
      { page_number: 1, content: "x" },
      { page_number: 2, content: "y" },
    ],
  });
  render(<DocumentViewer {...pdfProps} documentName="report.docx" />);
  await waitFor(() =>
    expect(screen.getByTestId("file-original-view")).toBeInTheDocument()
  );
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
});

test("documentViewer_image_initialPage_noTabsNoFocus", async () => {
  // An image has no per-page concept → a citation opens File gốc (the image),
  // no tabs, no focus.
  getDocumentPages.mockResolvedValue({
    name: "scan.png",
    page_count: 1,
    pages: [{ page_number: 1, content: "" }],
  });
  fetchDocumentFile.mockResolvedValue(new Blob(["img"], { type: "image/png" }));
  render(
    <DocumentViewer {...pdfProps} documentName="scan.png" initialPage={1} />
  );
  await waitFor(() =>
    expect(screen.getByTestId("file-original-view")).toBeInTheDocument()
  );
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
});

// ── Story 110: highlight the cited content on the focused page ────────────────

const HL_PAGES = {
  name: "report.docx",
  page_count: 2,
  pages: [
    { page_number: 1, content: "Trang một nội dung dài đủ ký tự ở đây" },
    {
      page_number: 2,
      content:
        "Doanh thu thuần 1.560.000 triệu VNĐ\nGhi chú nội bộ khác nhau ở dòng",
    },
  ],
};

test("documentViewer_highlight_tierA_marksMatchingLine", async () => {
  getDocumentPages.mockResolvedValue(HL_PAGES);
  fetchDocumentFile.mockResolvedValue(new Blob(["docx"]));
  render(
    <DocumentViewer
      {...pdfProps}
      documentName="report.docx"
      initialPage={2}
      highlightText="Theo báo cáo, Doanh thu thuần 1.560.000 triệu VNĐ là tổng thu."
    />
  );
  await waitFor(() =>
    expect(
      screen.getByRole("tab", { name: "Nội dung đã số hóa" })
    ).toHaveAttribute("aria-selected", "true")
  );
  const mark = document.querySelector("mark.dv-hl");
  expect(mark).toBeInTheDocument();
  expect(mark.textContent).toContain("Doanh thu thuần 1.560.000 triệu VNĐ");
  // The non-matching note line is NOT marked.
  expect(mark.textContent).not.toContain("Ghi chú nội bộ");
});

test("documentViewer_highlight_wholePageCite_marksLinesNoTint", async () => {
  // Story 113: even when the citation ≈ the whole page, MARK the matching lines
  // (spans) — no full-page tint (`.dv-page-section--focused` is gone).
  const whole =
    "Dòng một nội dung dài ở đây\nDòng hai nội dung dài ở đây\nDòng ba nội dung dài ở đây";
  getDocumentPages.mockResolvedValue({
    name: "report.docx",
    page_count: 2,
    pages: [
      { page_number: 1, content: "khác" },
      { page_number: 2, content: whole },
    ],
  });
  fetchDocumentFile.mockResolvedValue(new Blob(["docx"]));
  render(
    <DocumentViewer
      {...pdfProps}
      documentName="report.docx"
      initialPage={2}
      highlightText={whole + " và phần kết luận thêm."}
    />
  );
  await waitFor(() =>
    expect(document.querySelector(".dv-digitized")).toBeInTheDocument()
  );
  expect(document.querySelector("mark.dv-hl")).toBeInTheDocument();
  expect(document.querySelector(".dv-page-section--focused")).toBeNull();
});

test("documentViewer_trustsPageNumber_marksOnlyContentOnThatPage", async () => {
  // Story 132: the API `page_number` is authoritative (document → page → text).
  // Even though the cited content is actually on page 1, page_number=3 → the
  // viewer focuses page 3 (NO whole-doc scan / auto-correct) and marks NOTHING
  // (the text isn't on page 3 → never guess another page). A wrong page_number
  // thus surfaces as no-highlight (an AI data bug), not a wrong highlight.
  getDocumentPages.mockResolvedValue({
    name: "doc.pdf",
    page_count: 3,
    pages: [
      { page_number: 1, content: "Bảng cân đối: Tổng cộng tài sản 980.000 đồng ở đây" },
      { page_number: 2, content: "Kết quả kinh doanh lợi nhuận sau thuế ở trang hai" },
      { page_number: 3, content: "Lưu chuyển tiền tệ thuần hoạt động ở trang ba" },
    ],
  });
  fetchDocumentFile.mockResolvedValue(new Blob(["%PDF"]));
  render(
    <DocumentViewer
      {...pdfProps}
      initialPage={3}
      highlightText="Theo tài liệu, Bảng cân đối: Tổng cộng tài sản 980.000 đồng ở đây."
    />
  );
  await waitFor(() =>
    expect(
      screen.getByRole("tab", { name: "Nội dung đã số hóa" })
    ).toHaveAttribute("aria-selected", "true")
  );
  // Focus = the trusted page_number 3, NOT auto-corrected to page 1.
  await waitFor(() => expect(screen.getByText("3/3 trang")).toBeInTheDocument());
  // Content isn't on page 3 → no mark (no wrong highlight).
  expect(document.querySelector("mark.dv-hl")).toBeNull();
  // "File gốc" forwards the trusted page 3.
  fireEvent.click(screen.getByRole("tab", { name: "File gốc" }));
  await waitFor(() =>
    expect(screen.getByTestId("file-original-view")).toBeInTheDocument()
  );
  expect(screen.getByTestId("file-original-view")).toHaveAttribute(
    "data-page",
    "3"
  );
});

test("documentViewer_correctPageNumber_marksTheCitedText", async () => {
  // Story 132 positive path: page_number matches where the content is → the
  // citation is highlighted on that page.
  getDocumentPages.mockResolvedValue({
    name: "doc.pdf",
    page_count: 3,
    pages: [
      { page_number: 1, content: "Trang một nội dung mở đầu tài liệu ở đây" },
      { page_number: 2, content: "Bảng cân đối: Tổng cộng tài sản 980.000 đồng ở đây" },
      { page_number: 3, content: "Lưu chuyển tiền tệ thuần hoạt động ở trang ba" },
    ],
  });
  fetchDocumentFile.mockResolvedValue(new Blob(["%PDF"]));
  render(
    <DocumentViewer
      {...pdfProps}
      initialPage={2}
      highlightText="Theo tài liệu, Bảng cân đối: Tổng cộng tài sản 980.000 đồng ở đây."
    />
  );
  await waitFor(() =>
    expect(
      screen.getByRole("tab", { name: "Nội dung đã số hóa" })
    ).toHaveAttribute("aria-selected", "true")
  );
  await waitFor(() => expect(screen.getByText("2/3 trang")).toBeInTheDocument());
  const mark = document.querySelector("mark.dv-hl");
  expect(mark).toBeInTheDocument();
  expect(mark.textContent).toContain("Tổng cộng tài sản 980.000");
});

test("documentViewer_highlight_noHighlightText_noMarkNoTint", async () => {
  getDocumentPages.mockResolvedValue(HL_PAGES);
  fetchDocumentFile.mockResolvedValue(new Blob(["docx"]));
  render(
    <DocumentViewer {...pdfProps} documentName="report.docx" initialPage={2} />
  );
  await waitFor(() =>
    expect(document.querySelector(".dv-digitized")).toBeInTheDocument()
  );
  expect(document.querySelector("mark.dv-hl")).toBeNull();
  expect(document.querySelector(".dv-page-section--focused")).toBeNull();
});

// ── Story 111: a PDF citation opens the digitized tab AND highlights there ────

test("documentViewer_pdf_citation_opensDigitizedWithHighlight", async () => {
  // Highlight is NOT gated by file kind — a PDF citation opens "Nội dung đã số
  // hóa" and marks the matching line on the focused page, same as a non-PDF.
  getDocumentPages.mockResolvedValue({
    name: "doc.pdf",
    page_count: 2,
    pages: [
      { page_number: 1, content: "khác nội dung dài đủ ký tự ở đây" },
      {
        page_number: 2,
        content:
          "Doanh thu thuần 1.560.000 triệu VNĐ\nGhi chú nội bộ khác nhau ở dòng",
      },
    ],
  });
  fetchDocumentFile.mockResolvedValue(new Blob(["%PDF"]));
  render(
    <DocumentViewer
      {...pdfProps}
      initialPage={2}
      highlightText="Theo báo cáo, Doanh thu thuần 1.560.000 triệu VNĐ là tổng thu."
    />
  );
  await waitFor(() =>
    expect(
      screen.getByRole("tab", { name: "Nội dung đã số hóa" })
    ).toHaveAttribute("aria-selected", "true")
  );
  const mark = document.querySelector("mark.dv-hl");
  expect(mark).toBeInTheDocument();
  expect(mark.textContent).toContain("Doanh thu thuần 1.560.000 triệu VNĐ");
  expect(mark.textContent).not.toContain("Ghi chú nội bộ");
});

// ── Cross-page citation fix: highlightSegments marks non-focus pages too ─────
// A window-enriched citation can span more than one page. The focus page
// (resolvedPage) keeps using `focusHl`/`highlightText` exactly as before —
// `highlightSegments` only ADDS marks on other pages that legitimately share
// the citation's content, it never changes what's shown on the focus page.

const MULTI_PAGE_HL = {
  name: "bao_cao.pdf",
  page_count: 3,
  pages: [
    { page_number: 1, content: "Trang một nội dung mở đầu tài liệu ở đây" },
    { page_number: 2, content: "Doanh thu thuần 1.560.000 triệu VNĐ ở đây" },
    { page_number: 3, content: "Kế hoạch quý tới mở rộng thị trường mạnh mẽ" },
  ],
};

test("documentViewer_highlightSegments_marksAdditionalNonFocusPage", async () => {
  getDocumentPages.mockResolvedValue(MULTI_PAGE_HL);
  fetchDocumentFile.mockResolvedValue(new Blob(["%PDF"]));
  render(
    <DocumentViewer
      {...pdfProps}
      initialPage={2}
      highlightText="Theo báo cáo, Doanh thu thuần 1.560.000 triệu VNĐ ở đây là số liệu chính."
      highlightSegments={[
        { page_number: 2, text: "Doanh thu thuần 1.560.000 triệu VNĐ ở đây" },
        { page_number: 3, text: "Kế hoạch quý tới mở rộng thị trường mạnh mẽ" },
      ]}
    />
  );
  await waitFor(() =>
    expect(
      screen.getByRole("tab", { name: "Nội dung đã số hóa" })
    ).toHaveAttribute("aria-selected", "true")
  );
  await waitFor(() => expect(screen.getByText("2/3 trang")).toBeInTheDocument());

  const page1 = document.querySelector('[data-page="1"]');
  const page2 = document.querySelector('[data-page="2"]');
  const page3 = document.querySelector('[data-page="3"]');

  const mark2 = page2.querySelector("mark.dv-hl");
  expect(mark2).toBeInTheDocument();
  expect(mark2.textContent).toContain("Doanh thu thuần 1.560.000 triệu VNĐ");

  // The other page in the window ALSO gets marked — not just the focus page.
  const mark3 = page3.querySelector("mark.dv-hl");
  expect(mark3).toBeInTheDocument();
  expect(mark3.textContent).toContain("Kế hoạch quý tới mở rộng thị trường");

  // A page with no matching segment stays plain.
  expect(page1.querySelector("mark.dv-hl")).toBeNull();
});

test("documentViewer_highlightSegments_focusPageUnaffectedBySegmentEntry", async () => {
  getDocumentPages.mockResolvedValue(MULTI_PAGE_HL);
  fetchDocumentFile.mockResolvedValue(new Blob(["%PDF"]));
  render(
    <DocumentViewer
      {...pdfProps}
      initialPage={2}
      highlightText="Theo báo cáo, Doanh thu thuần 1.560.000 triệu VNĐ ở đây là số liệu chính."
      highlightSegments={[
        // Deliberately mismatched vs. page 2's actual content — if the focus
        // page ever used this instead of `focusHl`, its mark would vanish.
        { page_number: 2, text: "Nội dung hoàn toàn không khớp trang này" },
      ]}
    />
  );
  await waitFor(() => expect(screen.getByText("2/3 trang")).toBeInTheDocument());

  const page2 = document.querySelector('[data-page="2"]');
  const mark2 = page2.querySelector("mark.dv-hl");
  expect(mark2).toBeInTheDocument();
  expect(mark2.textContent).toContain("Doanh thu thuần 1.560.000 triệu VNĐ");
});

test("documentViewer_highlightSegments_segmentTextNotFoundOnThatPage_noMarkNoThrow", async () => {
  getDocumentPages.mockResolvedValue(MULTI_PAGE_HL);
  fetchDocumentFile.mockResolvedValue(new Blob(["%PDF"]));
  render(
    <DocumentViewer
      {...pdfProps}
      initialPage={2}
      highlightText="Doanh thu thuần 1.560.000 triệu VNĐ ở đây"
      highlightSegments={[
        { page_number: 3, text: "Câu này không hề xuất hiện ở trang ba đâu nhé" },
      ]}
    />
  );
  await waitFor(() => expect(screen.getByText("2/3 trang")).toBeInTheDocument());

  const page3 = document.querySelector('[data-page="3"]');
  expect(page3.querySelector("mark.dv-hl")).toBeNull();
  expect(within(page3).getByText(/Kế hoạch quý tới/i)).toBeInTheDocument();
});

test("documentViewer_pdf_digitizedTab_showsAllPagesText", async () => {
  getDocumentPages.mockResolvedValue(threePages);
  render(<DocumentViewer {...pdfProps} />);

  // Story 133: File gốc tab shows total-only until we switch to digitized.
  await waitFor(() => expect(screen.getByText("3 trang")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("tab", { name: "Nội dung đã số hóa" }));

  const digitized = document.querySelector(".dv-digitized");
  expect(within(digitized).getByText("Nội dung trang một")).toBeInTheDocument();
  expect(within(digitized).getByText("Nội dung trang ba")).toBeInTheDocument();
  expect(screen.getByText("Trang 1")).toBeInTheDocument();
});

test("documentViewer_pdf_digitized_emptyPage_showsPlaceholder", async () => {
  getDocumentPages.mockResolvedValue({
    name: "doc.pdf",
    page_count: 2,
    pages: [
      { page_number: 1, content: "Có nội dung" },
      { page_number: 2, content: "" },
    ],
  });
  render(<DocumentViewer {...pdfProps} />);
  // Story 133: File gốc total-only.
  await waitFor(() => expect(screen.getByText("2 trang")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("tab", { name: "Nội dung đã số hóa" }));
  expect(screen.getByText(/chưa có nội dung/i)).toBeInTheDocument();
});

// ── Non-PDF: only the original file content, no tabs ─────────────────────────

test("documentViewer_nonPdf_noTabs_rendersOnlyOriginal", async () => {
  getDocumentPages.mockResolvedValue({
    name: "report.docx",
    page_count: 2,
    pages: [
      { page_number: 1, content: "x" },
      { page_number: 2, content: "y" },
    ],
  });
  render(<DocumentViewer {...pdfProps} documentName="report.docx" />);

  await waitFor(() =>
    expect(screen.getByTestId("file-original-view")).toBeInTheDocument()
  );
  // No digitized tab, no tab bar for non-PDF.
  expect(screen.queryByText("Nội dung đã số hóa")).not.toBeInTheDocument();
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  // The page counter is hidden for non-PDF.
  expect(screen.queryByText(/trang$/)).not.toBeInTheDocument();
});

test("documentViewer_nonPdf_closeStillWorks", async () => {
  getDocumentPages.mockResolvedValue({ name: "a.docx", page_count: 1, pages: [{ page_number: 1, content: "x" }] });
  const onClose = jest.fn();
  render(<DocumentViewer {...pdfProps} documentName="a.docx" onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
  expect(onClose).toHaveBeenCalled();
});

// ── No custom thumbnail rail anywhere (story 51 removal) ─────────────────────

test("documentViewer_noCustomThumbnailRail_pdf", async () => {
  getDocumentPages.mockResolvedValue(threePages);
  render(<DocumentViewer {...pdfProps} />);
  // Story 133: File gốc total-only.
  await waitFor(() => expect(screen.getByText("3 trang")).toBeInTheDocument());
  expect(document.querySelector(".dv-rail")).toBeNull();
  expect(document.querySelector(".dv-thumb")).toBeNull();
  expect(document.querySelectorAll("img.dv-thumb-img").length).toBe(0);
});

test("documentViewer_noCustomThumbnailRail_nonPdf", async () => {
  getDocumentPages.mockResolvedValue({ name: "a.docx", page_count: 1, pages: [{ page_number: 1, content: "x" }] });
  render(<DocumentViewer {...pdfProps} documentName="a.docx" />);
  await waitFor(() =>
    expect(screen.getByTestId("file-original-view")).toBeInTheDocument()
  );
  expect(document.querySelector(".dv-rail")).toBeNull();
  expect(document.querySelector(".dv-thumb")).toBeNull();
});

// ── Themed scrollbar container ───────────────────────────────────────────────

test("documentViewer_digitized_scrollContainerHasThemedClass", async () => {
  getDocumentPages.mockResolvedValue(threePages);
  render(<DocumentViewer {...pdfProps} />);
  // Story 133: File gốc total-only.
  await waitFor(() => expect(screen.getByText("3 trang")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("tab", { name: "Nội dung đã số hóa" }));
  expect(document.querySelector(".dv-main.dv-scroll")).toBeTruthy();
});

// ── Shared states ────────────────────────────────────────────────────────────

test("documentViewer_unprocessedDoc_showsWaitingMessage", async () => {
  getDocumentPages.mockResolvedValue({ name: "kho.docx", page_count: 0, pages: [] });
  fetchDocumentFile.mockRejectedValue(new Error("404"));
  render(<DocumentViewer {...pdfProps} documentName="kho.docx" />);
  await waitFor(() =>
    expect(screen.getByText(/đang chờ xử lý/i)).toBeInTheDocument()
  );
});

test("documentViewer_loadError_showsErrorState", async () => {
  getDocumentPages.mockRejectedValue(new Error("network down"));
  render(<DocumentViewer {...pdfProps} />);
  await waitFor(() =>
    expect(screen.getByText("network down")).toBeInTheDocument()
  );
});

test("documentViewer_close_callsOnClose", async () => {
  getDocumentPages.mockResolvedValue({ name: "d.pdf", page_count: 0, pages: [] });
  const onClose = jest.fn();
  render(<DocumentViewer {...pdfProps} onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
  expect(onClose).toHaveBeenCalled();
});

// ── Story 39: injected loaders (admin repository) — no pageImage anymore ──────

test("documentViewer_injectedLoaders_usedInsteadOfChatApi", async () => {
  const pages = jest.fn().mockResolvedValue({
    name: "kho.pdf",
    page_count: 1,
    pages: [{ page_number: 1, content: "Nội dung kho" }],
  });
  const file = jest.fn().mockResolvedValue(new Blob(["%PDF"]));

  render(
    <DocumentViewer
      documentId="d1"
      documentName="kho.pdf"
      loaders={{ pages, file }}
    />
  );

  // Story 133: File gốc (PDF) shows total-only.
  await waitFor(() =>
    expect(screen.getByText("1 trang")).toBeInTheDocument()
  );
  expect(pages).toHaveBeenCalled();
  expect(file).toHaveBeenCalled();
  expect(getDocumentPages).not.toHaveBeenCalled();
  expect(fetchDocumentFile).not.toHaveBeenCalled();
});

// ── Story 135: re-focus a citation when the viewer is already open ───────────
// Two bugs when the viewer stays mounted: (A) switching to another document
// focused on the OLD document's still-loaded pages (a stale one-shot), so the
// new doc opened stuck on page 1; (B) re-clicking a citation to the SAME page
// after scrolling away did nothing because the focus never re-armed. The fix
// gates focus on the pages actually belonging to the current document, and a
// `focusNonce` (bumped by the host on every citation click) re-arms the focus.

const mkPdfLoaders = (count) => ({
  pages: jest.fn(async () => ({
    page_count: count,
    pages: Array.from({ length: count }, (_, i) => ({
      page_number: i + 1,
      content: `Nội dung trang ${i + 1}`,
    })),
  })),
  file: jest.fn(async () => new Blob(["%PDF"], { type: "application/pdf" })),
});

test("documentViewer_switchDocWhileOpen_focusesNewDocCitedPage", async () => {
  const loadersA = mkPdfLoaders(3);
  const loadersB = mkPdfLoaders(8);
  const { rerender } = render(
    <DocumentViewer
      documentId="A"
      documentName="a.pdf"
      loaders={loadersA}
      initialPage={2}
      focusNonce={1}
    />
  );
  await waitFor(() =>
    expect(screen.getByText("2/3 trang")).toBeInTheDocument()
  );

  // Switch to document B (cited page 5) on the SAME mounted viewer. The old bug
  // focused B's page against A's stale 3-page range → "3/8"; the fix waits for
  // B's pages, so the counter reads the real cited page "5/8".
  rerender(
    <DocumentViewer
      documentId="B"
      documentName="b.pdf"
      loaders={loadersB}
      initialPage={5}
      focusNonce={2}
    />
  );
  await waitFor(() =>
    expect(screen.getByText("5/8 trang")).toBeInTheDocument()
  );
});

test("documentViewer_focusNonceBump_reArmsFocusToDigitizedTab", async () => {
  const loaders = mkPdfLoaders(6);
  const { rerender } = render(
    <DocumentViewer
      documentId="X"
      documentName="x.pdf"
      loaders={loaders}
      initialPage={3}
      focusNonce={1}
    />
  );
  // A citation open focuses the digitized tab.
  await waitFor(() =>
    expect(
      screen.getByRole("tab", { name: "Nội dung đã số hóa" })
    ).toHaveAttribute("aria-selected", "true")
  );
  await waitFor(() =>
    expect(screen.getByText("3/6 trang")).toBeInTheDocument()
  );

  // The user switches to "File gốc" and (in the app) scrolls elsewhere.
  fireEvent.click(screen.getByRole("tab", { name: "File gốc" }));
  await waitFor(() =>
    expect(screen.getByRole("tab", { name: "File gốc" })).toHaveAttribute(
      "aria-selected",
      "true"
    )
  );

  // Re-clicking the SAME citation bumps only `focusNonce` (same doc + page).
  // Without the fix nothing re-arms; with it the focus fires again, returning
  // to the digitized tab at the cited page.
  rerender(
    <DocumentViewer
      documentId="X"
      documentName="x.pdf"
      loaders={loaders}
      initialPage={3}
      focusNonce={2}
    />
  );
  await waitFor(() =>
    expect(
      screen.getByRole("tab", { name: "Nội dung đã số hóa" })
    ).toHaveAttribute("aria-selected", "true")
  );
});

// ── Story 138: re-focus after the viewer was CLOSED and reopened ─────────────
// Story 135 fixed the "viewer stays mounted" cases. Closing the viewer UNMOUNTS
// it, so a second citation click is a fresh mount — but now the viewer cache is
// WARM, so pages/file resolve in one microtask and every state update lands in
// a SINGLE commit. On that path the old code (a) fired the tab-change scroll AND
// the citation-focus scroll together, (b) scrolled to the first `.dv-hl` in the
// whole column — which for a cross-page citation can sit on the LAST page — and
// (c) let the scroll-spy overwrite the counter right after the focus, so the
// viewer showed "N/N" instead of the cited page.

const EIGHT_PAGES = {
  name: "nghidinh.pdf",
  page_count: 8,
  pages: Array.from({ length: 8 }, (_, i) => ({
    page_number: i + 1,
    content: `Nội dung trang ${i + 1} của tài liệu`,
  })),
};

test("documentViewer_reopenAfterClose_cachedDoc_focusesCitedPage_singleScroll", async () => {
  getDocumentPages.mockResolvedValue(EIGHT_PAGES);
  const citation = {
    ...pdfProps,
    initialPage: 3,
    highlightText: "Nội dung trang 3 của tài liệu",
  };

  const first = render(<DocumentViewer {...citation} focusNonce={1} />);
  await waitFor(() => expect(screen.getByText("3/8 trang")).toBeInTheDocument());
  // The user closes the viewer (host drops it from the tree).
  first.unmount();

  // Reopen: pages + file come from the warm cache, so the whole load collapses
  // into one commit — the exact path that produced "85/85 trang" in the report.
  scrollTargets = [];
  render(<DocumentViewer {...citation} focusNonce={2} />);
  await waitFor(() => expect(screen.getByText("3/8 trang")).toBeInTheDocument());
  await waitFor(() => expect(scrollTargets.length).toBeGreaterThan(0));

  // Exactly ONE scroll for one citation open — no competing tab-change scroll.
  expect(scrollTargets).toHaveLength(1);
  const page3 = document.querySelector('[data-page="3"]');
  expect(page3.contains(scrollTargets[0])).toBe(true);
});

test("documentViewer_citedPageTextNotMatching_scrollsToCitedSection_notOtherPageMark", async () => {
  getDocumentPages.mockResolvedValue(EIGHT_PAGES);
  render(
    <DocumentViewer
      {...pdfProps}
      initialPage={3}
      // Does not match page 3 → story 132: no mark on the cited page…
      highlightText="Câu trích dẫn này không hề khớp nội dung trang ba"
      // …but the cross-page window DOES mark the last page.
      highlightSegments={[
        { page_number: 8, text: "Nội dung trang 8 của tài liệu" },
      ]}
      focusNonce={1}
    />
  );
  await waitFor(() => expect(screen.getByText("3/8 trang")).toBeInTheDocument());
  await waitFor(() => expect(scrollTargets.length).toBeGreaterThan(0));

  const page3 = document.querySelector('[data-page="3"]');
  const page8 = document.querySelector('[data-page="8"]');
  expect(page3.querySelector("mark.dv-hl")).toBeNull();
  expect(page8.querySelector("mark.dv-hl")).toBeInTheDocument();

  // The scroll must stay on the CITED page's section; the old code jumped to
  // page 8 because that carried the column's first `.dv-hl`.
  expect(page3.contains(scrollTargets[0])).toBe(true);
  expect(page8.contains(scrollTargets[0])).toBe(false);
});

test("documentViewer_afterCitationFocus_counterKeepsCitedPage_untilUserGesture", async () => {
  getDocumentPages.mockResolvedValue(EIGHT_PAGES);
  render(
    <DocumentViewer
      {...pdfProps}
      initialPage={3}
      highlightText="Nội dung trang 3 của tài liệu"
      focusNonce={1}
    />
  );
  await waitFor(() => expect(screen.getByText("3/8 trang")).toBeInTheDocument());
  const main = document.querySelector(".dv-main");

  // The scroll events raised BY the programmatic focus must not move the
  // counter. (jsdom has no layout, so the scroll-spy would report page 1 —
  // in the browser the same hole reported the LAST page via the bottom guard.)
  await act(async () => {
    fireEvent.scroll(main);
    await new Promise((r) => setTimeout(r, 30));
  });
  expect(screen.getByText("3/8 trang")).toBeInTheDocument();

  // A real user gesture hands the counter back to the scroll-spy (story 133).
  await act(async () => {
    fireEvent.wheel(main);
    fireEvent.scroll(main);
    await new Promise((r) => setTimeout(r, 30));
  });
  expect(screen.getByText("1/8 trang")).toBeInTheDocument();
});
