import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

// FileOriginalView's static imports that are ESM-only in node_modules.
jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
}));

// Capture the props FileOriginalView passes down; drive callbacks per test.
const pdfViewState = { highlightResult: null, fireLoadError: false };
jest.mock("../PdfCitationView", () => ({
  __esModule: true,
  default: (props) => {
    const React = require("react");
    React.useEffect(() => {
      // Fire asynchronously like the real component (callbacks only land
      // after pdf.getPage()/getTextContent() promises) — a synchronous call
      // here would race FileOriginalView's own mount effects.
      const t = setTimeout(() => {
        if (pdfViewState.fireLoadError) props.onLoadError?.();
        else if (pdfViewState.highlightResult != null)
          props.onHighlightResult?.(pdfViewState.highlightResult);
      }, 0);
      return () => clearTimeout(t);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="pdf-citation-view" />;
  },
}));

import FileOriginalView from "../FileOriginalView";

// jsdom-safe fake blob: FileOriginalView guards `instanceof Blob` (story 32)
// and only calls URL.createObjectURL on it.
const fakePdfBlob = { type: "application/pdf", size: 100 };

beforeAll(() => {
  // jsdom lacks the object-URL APIs; define them so they can be spied on.
  if (!global.URL.createObjectURL) global.URL.createObjectURL = () => "";
  if (!global.URL.revokeObjectURL) global.URL.revokeObjectURL = () => {};
});

describe("FileOriginalView — PDF citation branch", () => {
  beforeEach(() => {
    pdfViewState.highlightResult = null;
    pdfViewState.fireLoadError = false;
    // CRA's jest config has resetMocks:true — spy return values set in
    // beforeAll are wiped per test, so (re)apply them here.
    jest
      .spyOn(global.URL, "createObjectURL")
      .mockReturnValue("blob:mock-url");
    jest.spyOn(global.URL, "revokeObjectURL").mockImplementation(() => {});
  });

  test("PDF WITHOUT quote keeps the native iframe (story 57 path)", async () => {
    const { container } = render(
      <FileOriginalView blob={fakePdfBlob} name="a.pdf" />
    );
    await waitFor(() =>
      expect(container.querySelector("iframe.dv-file-frame")).not.toBeNull()
    );
    expect(screen.queryByTestId("pdf-citation-view")).toBeNull();
  });

  test("PDF WITH quote renders PdfCitationView (lazy)", async () => {
    render(
      <FileOriginalView
        blob={fakePdfBlob}
        name="a.pdf"
        citation={{ page: 2, quote: "trích dẫn" }}
      />
    );
    expect(await screen.findByTestId("pdf-citation-view")).toBeInTheDocument();
  });

  test("highlight found → ribbon suppressed", async () => {
    pdfViewState.highlightResult = true;
    render(
      <FileOriginalView
        blob={fakePdfBlob}
        name="a.pdf"
        citation={{ page: 2, quote: "trích dẫn" }}
      />
    );
    await screen.findByTestId("pdf-citation-view");
    await waitFor(() =>
      expect(document.querySelector(".fov-cite-ribbon")).toBeNull()
    );
  });

  test("highlight NOT found → ribbon stays", async () => {
    pdfViewState.highlightResult = false;
    render(
      <FileOriginalView
        blob={fakePdfBlob}
        name="a.pdf"
        citation={{ page: 2, quote: "trích dẫn" }}
      />
    );
    await screen.findByTestId("pdf-citation-view");
    expect(document.querySelector(".fov-cite-ribbon")).not.toBeNull();
  });

  test("pdfjs load failure → falls back to native iframe, ribbon stays", async () => {
    pdfViewState.fireLoadError = true;
    const { container } = render(
      <FileOriginalView
        blob={fakePdfBlob}
        name="a.pdf"
        citation={{ page: 2, quote: "trích dẫn" }}
      />
    );
    await waitFor(() =>
      expect(container.querySelector("iframe.dv-file-frame")).not.toBeNull()
    );
    expect(screen.queryByTestId("pdf-citation-view")).toBeNull();
    expect(document.querySelector(".fov-cite-ribbon")).not.toBeNull();
  });
});
