// src/features/documents/__tests__/pdfCitationFocus.test.js
//
// Bug 4 — the CitationCard popup ("Rà soát dự thảo" citation chips) opens a PDF
// but lands at the wrong place ("cuối trang") instead of the cited page.
//
// Mechanism (same family as bug 2/3 — a one-shot scroll racing layout):
// PdfCitationView renders every page as a placeholder whose height is GUESSED
// (`DEFAULT_ASPECT` A4) and scrolls to the cited page exactly ONCE, as soon as
// the page elements exist. Real pages then render asynchronously and report
// their true aspect (`onLoadSuccess` → setAspects) — every page above the cited
// one that differs from the guess shifts the whole column while the scroll
// position stays put. On a long document those errors accumulate to whole
// screens; nobody ever corrects the scroll.
//
// jsdom has no layout, so the tests pin down the CONTRACT of the fix instead:
// while the programmatic focus still owns the scroll, any layout-changing
// signal (a page reporting its real aspect) must RE-APPLY the scroll to the
// cited page; the first real user gesture hands the scroll back and later
// reflows must not yank the user around.
import React from "react";
import { act, render, waitFor } from "@testing-library/react";

// Mock react-pdf: the real module needs pdf.js + workers that don't run under
// babel-jest. The mock exposes the load callbacks (via globalThis — a jest.mock
// factory may not close over test-file variables) so a test can drive the exact
// async sequence the bug needs: numPages first, real page aspects later.
jest.mock("react-pdf", () => {
  const ReactLocal = require("react");
  return {
    __esModule: true,
    Document: ({ children, onLoadSuccess }) => {
      globalThis.__pcvDocumentProps = { onLoadSuccess };
      return ReactLocal.createElement(
        "div",
        { "data-testid": "pdf-doc" },
        children
      );
    },
    Page: ({ pageNumber, onLoadSuccess }) => {
      globalThis.__pcvPageLoad.set(pageNumber, onLoadSuccess);
      return ReactLocal.createElement("div", {
        "data-testid": `pdf-page-${pageNumber}`,
      });
    },
  };
});
globalThis.__pcvPageLoad = new Map();
const documentProps = () => globalThis.__pcvDocumentProps;
const pageLoadCallbacks = globalThis.__pcvPageLoad;
// The real pdfjsWorker sets pdfjs.GlobalWorkerOptions (absent from the mock
// above) — isolated in its own module precisely so tests can blank it.
jest.mock("features/documents/components/viewer/pdfjsWorker", () => ({}));

import PdfCitationView from "features/documents/components/viewer/PdfCitationView";

// Record which element every scrollIntoView landed on.
let scrollTargets = [];

beforeEach(() => {
  globalThis.__pcvDocumentProps = null;
  pageLoadCallbacks.clear();
  scrollTargets = [];
  window.HTMLElement.prototype.scrollIntoView = jest.fn(function record() {
    scrollTargets.push(this);
  });
});

const scrolledPages = () =>
  scrollTargets.map((el) =>
    el.closest ? el.closest("[data-pcv-page]")?.getAttribute("data-pcv-page") : null
  );

/** Mount with a citation and simulate the PDF reporting `numPages`. */
async function mountWithPages(numPages, citedPage) {
  const view = render(
    <PdfCitationView
      blob={{ type: "application/pdf" }}
      name="dai.pdf"
      citation={{ page: citedPage, quote: "kinh phí thực hiện mức hỗ trợ" }}
    />
  );
  await waitFor(() => expect(documentProps()).not.toBeNull());
  await act(async () => {
    // getPage/getTextContent power the highlight only — irrelevant here.
    await documentProps().onLoadSuccess({
      numPages,
      getPage: async () => ({ getTextContent: async () => ({ items: [] }) }),
    });
  });
  return view;
}

test("pdfCitationFocus_initialLoad_scrollsToCitedPage", async () => {
  await mountWithPages(108, 100);
  await waitFor(() => expect(scrollTargets.length).toBeGreaterThan(0));
  expect(scrolledPages()).toContain("100");
});

test("pdfCitationFocus_pageAspectArrivesLate_reAppliesScroll", async () => {
  // A page ABOVE the cited one reports its real aspect after the one-shot
  // scroll — exactly what shifts the column under the reader on a long PDF.
  await mountWithPages(108, 100);
  await waitFor(() => expect(scrollTargets.length).toBeGreaterThan(0));
  const before = scrollTargets.length;

  act(() => {
    pageLoadCallbacks.get(99)?.({ height: 700, width: 600 }); // 1.167 ≠ 1.414
  });

  await waitFor(() => expect(scrollTargets.length).toBeGreaterThan(before));
  expect(scrolledPages().slice(before)).toContain("100");
});

test("pdfCitationFocus_userScrolled_reflowDoesNotYankBack", async () => {
  const { container } = await mountWithPages(108, 100);
  await waitFor(() => expect(scrollTargets.length).toBeGreaterThan(0));

  // First real user gesture hands the scroll back (story-138 convention).
  const scroller = container.querySelector(".pcv-scroll");
  act(() => {
    scroller.dispatchEvent(new Event("wheel", { bubbles: true }));
  });

  const before = scrollTargets.length;
  act(() => {
    pageLoadCallbacks.get(50)?.({ height: 700, width: 600 });
  });
  await new Promise((r) => setTimeout(r, 20));
  expect(scrollTargets.length).toBe(before);
});

test("pdfCitationFocus_noCitedPage_neverScrolls", async () => {
  const view = render(
    <PdfCitationView blob={{ type: "application/pdf" }} name="x.pdf" citation={{}} />
  );
  await waitFor(() => expect(documentProps()).not.toBeNull());
  await act(async () => {
    await documentProps().onLoadSuccess({
      numPages: 3,
      getPage: async () => ({ getTextContent: async () => ({ items: [] }) }),
    });
  });
  act(() => {
    pageLoadCallbacks.get(1)?.({ height: 700, width: 600 });
  });
  await new Promise((r) => setTimeout(r, 20));
  expect(scrollTargets.length).toBe(0);
  view.unmount();
});
