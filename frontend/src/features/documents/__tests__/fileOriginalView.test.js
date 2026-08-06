// src/features/documents/__tests__/fileOriginalView.test.js
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

import FileOriginalView from "features/documents/components/viewer/FileOriginalView";

// Heavy parsers are mocked: we test the renderer-selection branches and the
// inline output, not the real docx/xlsx parsing (ADR-008 — behavior, not libs).
jest.mock("mammoth", () => ({
  __esModule: true,
  default: {
    convertToHtml: jest.fn().mockResolvedValue({ value: "<p>DOCX HTML</p>" }),
  },
}));

jest.mock("xlsx", () => ({
  read: jest.fn(() => ({ SheetNames: ["Sheet1"], Sheets: { Sheet1: {} } })),
  utils: { sheet_to_html: jest.fn(() => "<table><tr><td>CELL</td></tr></table>") },
}));

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }) => <div data-testid="md">{children}</div>,
}));

beforeEach(() => {
  // jsdom has no object-URL support; assign per-test (a beforeAll assignment
  // gets reset before the test body runs in this env).
  window.URL.createObjectURL = jest.fn(() => "blob:mock");
  window.URL.revokeObjectURL = jest.fn();
});

// jsdom Blob lacks arrayBuffer/text in some versions — provide them.
function blobWith({ type = "", text = "", bytes } = {}) {
  return {
    type,
    arrayBuffer: jest.fn().mockResolvedValue(bytes || new ArrayBuffer(8)),
    text: jest.fn().mockResolvedValue(text),
  };
}

test("fileOriginalView_pdf_rendersIframeFromObjectUrl", async () => {
  const { container } = render(
    <FileOriginalView blob={blobWith({ type: "application/pdf" })} name="a.pdf" />
  );
  await waitFor(() =>
    expect(container.querySelector("iframe.dv-file-frame")).toBeInTheDocument()
  );
  expect(global.URL.createObjectURL).toHaveBeenCalled();
});

test("fileOriginalView_pdf_srcCarriesInitialPage", async () => {
  // Story 109 (amends story 57): the PDF iframe DOES focus a page via `#page=N`
  // now — but only from the STABLE `page` prop the viewer passes ONCE at open
  // (the citation's page), NEVER from the scroll-spy current page. So the src
  // changes only on a deliberate open, not on scroll → the story-57 jank fix is
  // preserved (see srcStableAcrossReRender below).
  const { container } = render(
    <FileOriginalView
      blob={blobWith({ type: "application/pdf" })}
      name="a.pdf"
      page={3}
    />
  );
  await waitFor(() =>
    expect(container.querySelector("iframe.dv-file-frame")).toBeInTheDocument()
  );
  const src = container.querySelector("iframe.dv-file-frame").getAttribute("src");
  expect(src).toMatch(/#page=3/);
  expect(src).toMatch(/zoom=page-width/);
});

test("fileOriginalView_pdf_noPage_noPageFragment", async () => {
  // No page prop (the 3 existing viewer consumers that open from a list) → the
  // src must be identical to before story 109: no `#page` fragment.
  const { container } = render(
    <FileOriginalView blob={blobWith({ type: "application/pdf" })} name="a.pdf" />
  );
  await waitFor(() =>
    expect(container.querySelector("iframe.dv-file-frame")).toBeInTheDocument()
  );
  const src = container.querySelector("iframe.dv-file-frame").getAttribute("src");
  expect(src).not.toMatch(/#page=/);
  expect(src).toMatch(/zoom=page-width/);
});

test("fileOriginalView_pdf_srcStableAcrossReRender", async () => {
  // Story 57/58 anti-jank regression: an unrelated parent re-render (same blob,
  // same page) must NOT change the iframe src (else the native PDF reloads →
  // flicker/jank). The src is memoized on [objectUrl, page]; the object URL is
  // created once per blob.
  const blob = blobWith({ type: "application/pdf" });
  const { container, rerender } = render(
    <FileOriginalView blob={blob} name="a.pdf" page={2} />
  );
  await waitFor(() =>
    expect(container.querySelector("iframe.dv-file-frame")).toBeInTheDocument()
  );
  const src1 = container.querySelector("iframe.dv-file-frame").getAttribute("src");
  rerender(<FileOriginalView blob={blob} name="a.pdf" page={2} />);
  const src2 = container.querySelector("iframe.dv-file-frame").getAttribute("src");
  expect(src2).toBe(src1);
  expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1);
});

test("fileOriginalView_pdf_pageWidth_byDefault", async () => {
  // Story 58: PDFs fit to the pane WIDTH (`zoom=page-width`) so they never
  // overflow horizontally — a fixed 85% made the page wider than the pane on a
  // narrow split, which gave the native viewer an internal horizontal scrollbar
  // that was janky to drag (PDF-only; non-PDF HTML wraps). Fit-width removes the
  // horizontal overflow → removes the jank, and shows the full document width.
  const { container } = render(
    <FileOriginalView blob={blobWith({ type: "application/pdf" })} name="a.pdf" />
  );
  await waitFor(() =>
    expect(container.querySelector("iframe.dv-file-frame")).toBeInTheDocument()
  );
  const src = container.querySelector("iframe.dv-file-frame").getAttribute("src");
  expect(src).toMatch(/zoom=page-width/);
  expect(src).not.toMatch(/zoom=85/);
});

test("fileOriginalView_pdfNameWrongType_stillRendersInlinePdf", async () => {
  // Story 32: a .pdf whose blob carries a wrong/generic content-type must still
  // render inline (kind resolved by name) — NOT fall to the "Tải về" branch
  // (which is what made PDFs download instead of view).
  const { container } = render(
    <FileOriginalView
      blob={blobWith({ type: "application/octet-stream" })}
      name="report.pdf"
    />
  );
  await waitFor(() =>
    expect(container.querySelector("iframe.dv-file-frame")).toBeInTheDocument()
  );
  expect(screen.queryByRole("button", { name: "Tải về" })).not.toBeInTheDocument();
});

test("fileOriginalView_image_rendersImg", async () => {
  const { container } = render(
    <FileOriginalView blob={blobWith({ type: "image/png" })} name="scan.png" />
  );
  await waitFor(() =>
    expect(container.querySelector("img.dv-page-image")).toBeInTheDocument()
  );
});

test("fileOriginalView_docx_rendersMammothHtml_notIframe", async () => {
  const { container } = render(
    <FileOriginalView blob={blobWith()} name="policy.docx" />
  );
  await waitFor(() =>
    expect(container.querySelector(".dv-file-doc")).toBeInTheDocument()
  );
  expect(screen.getByText("DOCX HTML")).toBeInTheDocument();
  expect(container.querySelector("iframe")).not.toBeInTheDocument();
});

test("fileOriginalView_xlsx_rendersSheetTable", async () => {
  const { container } = render(
    <FileOriginalView blob={blobWith()} name="data.xlsx" />
  );
  await waitFor(() =>
    expect(container.querySelector(".dv-file-sheet")).toBeInTheDocument()
  );
  expect(screen.getByText("CELL")).toBeInTheDocument();
});

test("fileOriginalView_txt_rendersPre", async () => {
  const { container } = render(
    <FileOriginalView blob={blobWith({ text: "hello world" })} name="notes.txt" />
  );
  await waitFor(() =>
    expect(container.querySelector("pre.dv-page-text")).toBeInTheDocument()
  );
  expect(screen.getByText("hello world")).toBeInTheDocument();
});

test("fileOriginalView_unsupported_showsDownloadButton_noSilentDownload", async () => {
  render(
    <FileOriginalView
      blob={blobWith({ type: "application/octet-stream" })}
      name="legacy.ppt"
    />
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Tải về" })).toBeInTheDocument()
  );
  // No iframe / img — the file is NOT auto-rendered (so no silent download).
  expect(screen.queryByText(/đang tải/i)).not.toBeInTheDocument();
});
