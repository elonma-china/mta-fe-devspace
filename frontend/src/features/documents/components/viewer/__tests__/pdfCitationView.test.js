import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

// ── ESM/worker mocks (pattern: directiveReview.test.js) ──────────────
// The worker module contains import.meta → must never be parsed by jest.
jest.mock("../pdfjsWorker", () => ({}));

// Controls for the react-pdf mock, settable per test.
const pdfMockState = {
  numPages: 3,
  failLoad: false,
  // pageNumber -> items returned by page.getTextContent()
  textItems: {},
};

jest.mock("react-pdf", () => {
  const React = require("react");
  const Document = ({ children, onLoadSuccess, onLoadError }) => {
    React.useEffect(() => {
      if (pdfMockState.failLoad) {
        onLoadError?.(new Error("boom"));
        return;
      }
      onLoadSuccess?.({
        numPages: pdfMockState.numPages,
        getPage: (n) =>
          Promise.resolve({
            getTextContent: () =>
              Promise.resolve({ items: pdfMockState.textItems[n] || [] }),
          }),
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return React.createElement("div", { "data-testid": "pdf-doc" }, children);
  };
  const Page = ({ pageNumber, customTextRenderer }) => {
    const items = pdfMockState.textItems[pageNumber] || [];
    const html = customTextRenderer
      ? items
          .map((it, i) => customTextRenderer({ str: it.str, itemIndex: i }))
          .join("")
      : "";
    return React.createElement("div", {
      "data-testid": `pdf-page-${pageNumber}`,
      dangerouslySetInnerHTML: { __html: html },
    });
  };
  return {
    __esModule: true,
    pdfjs: { GlobalWorkerOptions: {} },
    Document,
    Page,
  };
});

import PdfCitationView from "../PdfCitationView";

const item = (str, hasEOL = false) => ({ str, hasEOL });
const baseProps = () => ({
  blob: { size: 10, type: "application/pdf" }, // plain object; component must not touch Blob APIs
  name: "nghi-dinh.pdf",
  citation: { page: 2, quote: "Phạm vi điều chỉnh" },
});

describe("PdfCitationView", () => {
  beforeEach(() => {
    pdfMockState.numPages = 3;
    pdfMockState.failLoad = false;
    pdfMockState.textItems = {
      2: [item("Điều 1. "), item("Phạm vi điều chỉnh của Nghị định")],
    };
  });

  test("renders one wrapper per page and marks the quote on the cited page", async () => {
    const onHighlightResult = jest.fn();
    const { container } = render(
      <PdfCitationView {...baseProps()} onHighlightResult={onHighlightResult} />
    );
    await waitFor(() => expect(onHighlightResult).toHaveBeenCalledWith(true));
    // jsdom has no IntersectionObserver → all pages render eagerly.
    expect(screen.getByTestId("pdf-page-1")).toBeInTheDocument();
    expect(screen.getByTestId("pdf-page-3")).toBeInTheDocument();
    const mark = container.querySelector("mark.fov-cite-highlight");
    expect(mark).not.toBeNull();
    expect(mark.textContent).toBe("Phạm vi điều chỉnh");
  });

  test("quote not found → onHighlightResult(false) and no mark", async () => {
    pdfMockState.textItems = { 2: [item("nội dung khác hẳn")] };
    const onHighlightResult = jest.fn();
    const { container } = render(
      <PdfCitationView {...baseProps()} onHighlightResult={onHighlightResult} />
    );
    await waitFor(() => expect(onHighlightResult).toHaveBeenCalledWith(false));
    expect(container.querySelector("mark.fov-cite-highlight")).toBeNull();
  });

  test("cited page out of range → onHighlightResult(false), still renders doc", async () => {
    const onHighlightResult = jest.fn();
    render(
      <PdfCitationView
        {...baseProps()}
        citation={{ page: 99, quote: "Phạm vi" }}
        onHighlightResult={onHighlightResult}
      />
    );
    await waitFor(() => expect(onHighlightResult).toHaveBeenCalledWith(false));
    expect(screen.getByTestId("pdf-page-1")).toBeInTheDocument();
  });

  test("document load failure → onLoadError called", async () => {
    pdfMockState.failLoad = true;
    const onLoadError = jest.fn();
    render(<PdfCitationView {...baseProps()} onLoadError={onLoadError} />);
    await waitFor(() => expect(onLoadError).toHaveBeenCalled());
  });

  test("customTextRenderer escapes HTML in item text", async () => {
    pdfMockState.textItems = {
      2: [item("<b>x</b> Phạm vi điều chỉnh")],
    };
    const { container } = render(<PdfCitationView {...baseProps()} />);
    await waitFor(() =>
      expect(container.querySelector("mark.fov-cite-highlight")).not.toBeNull()
    );
    expect(container.querySelector("b")).toBeNull(); // "<b>" arrived as text, not markup
  });
});
