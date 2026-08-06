// src/features/documents/__tests__/viewerReopenCitation.test.js
//
// Bug 3 — click a citation chip → the viewer jumps to the cited passage and
// highlights it; close the viewer; click the SAME chip again → it lands on the
// wrong content.
//
// Two things the older viewer tests never covered:
//
//  1. Closing the viewer UNMOUNTS DocumentViewer, but the per-document page/file
//     cache (useViewerCacheStore) deliberately survives — so the second open runs
//     with a WARM cache. Every existing test clears that cache in `beforeEach`;
//     the reopen test here shares it on purpose.
//  2. The host panel animates its width for 200ms when the viewer opens
//     (Chat.css `.analysis-panel { transition: flex-basis 200ms ease }`). On a
//     warm cache the pages render in the first frame, so the focus scrolls while
//     the pane is still narrow — the `<pre>` is wrapped much taller then, and
//     when the animation lands the text re-wraps and the cited mark slides out of
//     view. Measured on the real stack: 360px/9823px at scroll time vs
//     696px/6800px settled, mark y=3369 → 2238 against a scroll of 2602.
//
// jsdom has no layout, so it cannot reproduce the reflow itself. What it CAN
// pin down is the fix: while the programmatic focus still owns the scroll, a
// resize of the scroll container must re-apply that focus.
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

// Record WHICH element each scroll landed on (same trick as documentViewer.test.js).
let scrollTargets = [];
// jsdom has no ResizeObserver — this stand-in also hands the test the callback
// so it can fire a resize the way the panel's width animation does.
let resizeCallbacks = [];

const CITED = "Điều 12 quy định về chế độ trực ban của đơn vị.";

const mkLoaders = (count, citedPage) => ({
  pages: jest.fn(async () => ({
    page_count: count,
    pages: Array.from({ length: count }, (_, i) => ({
      page_number: i + 1,
      content:
        i + 1 === citedPage
          ? `Mở đầu trang ${i + 1}. ${CITED} Kết thúc trang ${i + 1}.`
          : `Nội dung trang ${i + 1} không liên quan.`,
    })),
  })),
  file: jest.fn(async () => new Blob(["%PDF"], { type: "application/pdf" })),
});

const lastScroll = () => scrollTargets[scrollTargets.length - 1];
const scrolledPage = () => {
  const last = lastScroll();
  const section = last && last.closest ? last.closest(".dv-page-section") : null;
  return section ? section.getAttribute("data-page") : null;
};
const scrolledToMark = () => {
  const last = lastScroll();
  return Boolean(last && last.classList && last.classList.contains("dv-hl"));
};

beforeEach(() => {
  useViewerCacheStore.getState().clearViewerCache();
  window.URL.createObjectURL = jest.fn(() => "blob:mock");
  window.URL.revokeObjectURL = jest.fn();
  scrollTargets = [];
  resizeCallbacks = [];
  window.HTMLElement.prototype.scrollIntoView = jest.fn(function record() {
    scrollTargets.push(this);
  });
  global.ResizeObserver = class {
    constructor(cb) {
      resizeCallbacks.push(cb);
    }
    observe() {}
    disconnect() {}
  };
});

afterEach(() => {
  delete global.ResizeObserver;
});

const citationProps = {
  documentId: "D1",
  documentName: "quy-che.pdf",
  initialPage: 6,
  highlightText: CITED,
};

test("viewerReopenCitation_closeThenReopen_focusesCitedMarkAgain", async () => {
  const loaders = mkLoaders(8, 6);

  // ── Click 1 (cold cache) ──────────────────────────────────────────────────
  const first = render(
    <DocumentViewer {...citationProps} loaders={loaders} focusNonce={1} />
  );
  await waitFor(() => expect(screen.getByText("6/8 trang")).toBeInTheDocument());
  await waitFor(() => expect(scrolledPage()).toBe("6"));
  expect(scrolledToMark()).toBe(true);

  // ── Close the viewer, then click the same chip again (warm cache) ──────────
  first.unmount();
  scrollTargets = [];
  render(<DocumentViewer {...citationProps} loaders={loaders} focusNonce={2} />);

  await waitFor(() => expect(screen.getByText("6/8 trang")).toBeInTheDocument());
  await waitFor(() => expect(scrolledPage()).toBe("6"));
  expect(scrolledToMark()).toBe(true);
  // Pages came from the cache, not a second fetch — that is what makes the
  // reopen race the panel's width animation.
  expect(loaders.pages).toHaveBeenCalledTimes(1);
});

test("viewerReopenCitation_containerResizesAfterFocus_reAppliesFocus", async () => {
  // The panel's 200ms flex-basis animation resizes the scroll container AFTER
  // the focus scrolled. Without re-applying it, the re-wrapped text leaves the
  // cited mark off-screen and the reader sees a later page.
  render(
    <DocumentViewer {...citationProps} loaders={mkLoaders(8, 6)} focusNonce={1} />
  );
  await waitFor(() => expect(scrolledPage()).toBe("6"));
  expect(scrolledToMark()).toBe(true);

  const before = scrollTargets.length;
  expect(resizeCallbacks.length).toBeGreaterThan(0);
  resizeCallbacks.forEach((cb) => cb([], {}));

  await waitFor(() => expect(scrollTargets.length).toBeGreaterThan(before));
  expect(scrolledPage()).toBe("6");
  expect(scrolledToMark()).toBe(true);
});

test("viewerReopenCitation_userScrolledAway_resizeDoesNotYankThemBack", async () => {
  // Story 138 hands the scroll back to the user on the first real gesture. A
  // later resize must NOT drag them back to the citation.
  const { container } = render(
    <DocumentViewer {...citationProps} loaders={mkLoaders(8, 6)} focusNonce={1} />
  );
  await waitFor(() => expect(scrolledPage()).toBe("6"));

  const main = container.querySelector(".dv-main.dv-scroll");
  main.dispatchEvent(new Event("wheel", { bubbles: true }));

  const before = scrollTargets.length;
  resizeCallbacks.forEach((cb) => cb([], {}));
  await new Promise((r) => setTimeout(r, 20));
  expect(scrollTargets.length).toBe(before);
});
