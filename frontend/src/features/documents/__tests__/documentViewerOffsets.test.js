// src/features/documents/__tests__/documentViewerOffsets.test.js
//
// The viewer marks a citation by character offset when it can, and only falls
// back to matching text when it cannot.
//
// Matching was the whole problem: the citation had to be compared against the
// digitized page, so any OCR or markdown difference marked nothing, and a
// generic sentence marked the wrong thing. Now the backend publishes each
// page's span in the document's source text and each citation's own offsets in
// that same text, so the range is a subtraction — exact, and impossible to
// mismatch.
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

import DocumentViewer from "features/documents/components/viewer/DocumentViewer";
import useViewerCacheStore from "stores/useViewerCacheStore";

jest.mock("assets/images/x.svg", () => ({
  ReactComponent: () => <span data-testid="x-icon" />,
}));

jest.mock("features/documents/api", () => ({
  getDocumentPages: jest.fn(),
  fetchDocumentFile: jest.fn(),
}));

jest.mock("features/documents/components/viewer/FileOriginalView", () => ({
  __esModule: true,
  default: ({ name }) => <div data-testid="file-original-view">FOV:{name}</div>,
}));

import { getDocumentPages, fetchDocumentFile } from "features/documents/api";

const props = {
  documentId: "d1",
  documentName: "report.docx",
  userId: "u1",
  conversationId: "c1",
};

const P1 = "Trang một mở đầu tài liệu.";
const P2 = "Điều 5. Nguyên tắc áp dụng. Ghi chú nội bộ không liên quan.";
// Pages laid out back to back with a "\n\n" separator, as the chunker's source
// text is built — page 2 therefore starts at len(P1) + 2.
const P2_START = P1.length + 2;

const PAGES_WITH_SPANS = {
  name: "report.docx",
  page_count: 2,
  pages: [
    { page_number: 1, content: P1, char_start: 0, char_end: P1.length },
    {
      page_number: 2,
      content: P2,
      char_start: P2_START,
      char_end: P2_START + P2.length,
    },
  ],
};

const CITED = "Điều 5. Nguyên tắc áp dụng.";
const CITE_START = P2_START;
const CITE_END = P2_START + CITED.length;

beforeEach(() => {
  useViewerCacheStore.getState().clearViewerCache();
  window.URL.createObjectURL = jest.fn(() => "blob:mock");
  window.URL.revokeObjectURL = jest.fn();
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
  getDocumentPages.mockReset();
  fetchDocumentFile.mockReset().mockResolvedValue(new Blob(["docx"]));
});

async function renderViewer(extra) {
  render(<DocumentViewer {...props} initialPage={2} {...extra} />);
  await waitFor(() =>
    expect(
      screen.getByRole("tab", { name: "Nội dung đã số hóa" })
    ).toHaveAttribute("aria-selected", "true")
  );
}

test("documentViewer_citationWithOffsets_marksExactlyTheCitedRange", async () => {
  getDocumentPages.mockResolvedValue(PAGES_WITH_SPANS);
  await renderViewer({
    highlightText: CITED,
    highlightCharStart: CITE_START,
    highlightCharEnd: CITE_END,
  });

  const marks = document.querySelectorAll("mark.dv-hl");
  expect(marks).toHaveLength(1);
  expect(marks[0].textContent).toBe(CITED);
});

test("documentViewer_citationWithOffsets_marksNothingOutsideTheRange", async () => {
  getDocumentPages.mockResolvedValue(PAGES_WITH_SPANS);
  await renderViewer({
    highlightText: CITED,
    highlightCharStart: CITE_START,
    highlightCharEnd: CITE_END,
  });

  const mark = document.querySelector("mark.dv-hl");
  expect(mark.textContent).not.toContain("Ghi chú nội bộ");
  // The unfocused page stays plain.
  const page1 = document.querySelector('[data-page="1"]');
  expect(page1.querySelector("mark.dv-hl")).toBeNull();
});

test("documentViewer_offsetsDisagreeWithText_stillMarksTheOffsets", async () => {
  // The point of the offsets: the digitized page can differ from the citation
  // text (OCR, markdown, an em-dash). Matching would find nothing here; the
  // offsets still place the mark, because they never compare the two.
  getDocumentPages.mockResolvedValue(PAGES_WITH_SPANS);
  await renderViewer({
    highlightText: "Điều 5 — Nguyên  tắc  áp dụng!!!",
    highlightCharStart: CITE_START,
    highlightCharEnd: CITE_END,
  });

  const mark = document.querySelector("mark.dv-hl");
  expect(mark).toBeInTheDocument();
  expect(mark.textContent).toBe(CITED);
});

test("documentViewer_pagesWithoutSpans_fallsBackToTextMatching", async () => {
  // Documents indexed before the page spans exist keep working.
  getDocumentPages.mockResolvedValue({
    name: "report.docx",
    page_count: 2,
    pages: [
      { page_number: 1, content: P1 },
      { page_number: 2, content: P2 },
    ],
  });
  await renderViewer({
    highlightText: `Theo tài liệu, ${CITED}`,
    highlightCharStart: CITE_START,
    highlightCharEnd: CITE_END,
  });

  const mark = document.querySelector("mark.dv-hl");
  expect(mark).toBeInTheDocument();
  expect(mark.textContent).toContain("Nguyên tắc áp dụng");
});

test("documentViewer_citationWithoutOffsets_fallsBackToTextMatching", async () => {
  getDocumentPages.mockResolvedValue(PAGES_WITH_SPANS);
  await renderViewer({ highlightText: `Theo tài liệu, ${CITED}` });

  const mark = document.querySelector("mark.dv-hl");
  expect(mark).toBeInTheDocument();
  expect(mark.textContent).toContain("Nguyên tắc áp dụng");
});

test("documentViewer_offsetsOnAnotherPage_fallsBackRatherThanMarkNothing", async () => {
  // A stale offset that lands outside the focused page must not blank the
  // highlight — matching is worse than exact, but better than nothing.
  getDocumentPages.mockResolvedValue(PAGES_WITH_SPANS);
  await renderViewer({
    highlightText: `Theo tài liệu, ${CITED}`,
    highlightCharStart: 900000,
    highlightCharEnd: 900100,
  });

  const mark = document.querySelector("mark.dv-hl");
  expect(mark).toBeInTheDocument();
  expect(mark.textContent).toContain("Nguyên tắc áp dụng");
});
