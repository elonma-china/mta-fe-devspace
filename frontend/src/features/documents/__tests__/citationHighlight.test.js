// src/features/documents/__tests__/citationHighlight.test.js
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import {
  findQuoteRange,
  mergePdfFragment,
} from "../components/viewer/viewerUtils";
import FileOriginalView from "../components/viewer/FileOriginalView";

// mammoth is absent from this checkout's node_modules (pre-existing gap; the
// docker build installs it fresh) — mock it VIRTUALLY so the docx path can
// execute under Jest without the real package.
jest.mock(
  "mammoth",
  () => ({
    convertToHtml: jest.fn(async () => ({
      value: "<p>Điều 6. Các thiết bị dùng để đun nấu bị cấm.</p>",
    })),
  }),
  { virtual: true }
);
jest.mock("react-markdown", () => (props) => <div>{props.children}</div>);

// PDF.js citation viewer (spec 2026-07-17): FileOriginalView lazy-imports it
// for PDFs WITH a quote. Mock it — the real module pulls react-pdf (ESM) and
// the import.meta worker wiring, neither of which parse under babel-jest.
jest.mock("../components/viewer/PdfCitationView", () => ({
  __esModule: true,
  default: () => <div data-testid="pdf-citation-view" />,
}));

const textBlob = (s) => new Blob([s], { type: "text/plain" });

// jsdom's Blob lacks .text()/.arrayBuffer() (browsers have both) — polyfill
// via FileReader, which jsdom does implement, so the component's real parse
// path runs unmodified.
beforeAll(() => {
  if (!Blob.prototype.text) {
    // eslint-disable-next-line no-extend-native
    Blob.prototype.text = function text() {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsText(this);
      });
    };
  }
  if (!Blob.prototype.arrayBuffer) {
    // eslint-disable-next-line no-extend-native
    Blob.prototype.arrayBuffer = function arrayBuffer() {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsArrayBuffer(this);
      });
    };
  }
});

describe("findQuoteRange", () => {
  const page =
    "Điều 6. Đồ vật cấm đưa vào buồng giam\n" +
    "1. Các thiết bị dùng để  đun nấu, đồ dùng bằng kim loại,\nsành, sứ, đá, đất\n" +
    "và các đồ vật có thể làm hung khí.";

  test("test_exact_match_returns_raw_indices", () => {
    const quote = "đồ dùng bằng kim loại,\nsành, sứ";
    const r = findQuoteRange(page, quote);
    expect(r).not.toBeNull();
    expect(page.slice(r.start, r.end)).toContain("kim loại");
    expect(page.slice(r.start, r.end)).toContain("sành, sứ");
  });

  test("test_whitespace_normalized_match", () => {
    // Quote has single spaces where the page has a double space + newline.
    const quote = "thiết bị dùng để đun nấu, đồ dùng bằng kim loại, sành";
    const r = findQuoteRange(page, quote);
    expect(r).not.toBeNull();
    expect(page.slice(r.start, r.end)).toMatch(/^thiết bị dùng để/);
    expect(page.slice(r.start, r.end)).toMatch(/sành$/);
  });

  test("test_long_quote_falls_back_to_80_char_prefix", () => {
    // The first >80 chars match the page; the TAIL diverges (OCR drift is a
    // tail phenomenon — the prefix fallback exists exactly for this shape).
    const quote =
      "Các thiết bị dùng để đun nấu, đồ dùng bằng kim loại, sành, sứ, đá, đất " +
      "và các đồ vật có thể làm hung khí" +
      " NHƯNG PHẦN ĐUÔI NÀY KHÔNG TỒN TẠI TRONG VĂN BẢN GỐC NÊN KHÔNG KHỚP";
    const r = findQuoteRange(page, quote);
    expect(r).not.toBeNull();
    expect(page.slice(r.start, r.end)).toMatch(/^Các thiết bị/);
  });

  test("test_no_match_returns_null", () => {
    expect(findQuoteRange(page, "hoàn toàn không liên quan gì cả")).toBeNull();
    expect(findQuoteRange(page, "")).toBeNull();
    expect(findQuoteRange("", "gì đó")).toBeNull();
  });
});

describe("mergePdfFragment", () => {
  test("test_page_prepended_into_existing_fragment", () => {
    expect(mergePdfFragment("blob:x", 4)).toBe(
      "blob:x#page=4&zoom=page-width&pagemode=none"
    );
  });

  test("test_no_page_keeps_todays_fragment", () => {
    expect(mergePdfFragment("blob:x", null)).toBe(
      "blob:x#zoom=page-width&pagemode=none"
    );
    expect(mergePdfFragment("blob:x", undefined)).toBe(
      "blob:x#zoom=page-width&pagemode=none"
    );
    expect(mergePdfFragment("blob:x", 0)).toBe(
      "blob:x#zoom=page-width&pagemode=none"
    );
  });
});

describe("FileOriginalView citation", () => {
  beforeEach(() => {
    global.URL.createObjectURL = jest.fn(() => "blob:test-url");
    global.URL.revokeObjectURL = jest.fn();
  });

  test("test_pdf_with_quote_renders_pdfjs_view_and_ribbon", async () => {
    // Spec 2026-07-17: a PDF WITH a citation quote goes through the PDF.js
    // viewer (in-page highlight), not the native iframe.
    const blob = new Blob(["%PDF"], { type: "application/pdf" });
    render(
      <FileOriginalView
        blob={blob}
        name="tt.pdf"
        citation={{ page: 4, quote: "đồ dùng bằng kim loại" }}
      />
    );
    expect(await screen.findByTestId("pdf-citation-view")).toBeInTheDocument();
    expect(screen.queryByTitle(/file gốc/i)).not.toBeInTheDocument();
    // Ribbon shows the quote with the page label until a highlight lands
    // (the mocked viewer never reports one), and dismisses.
    expect(screen.getByText(/trích dẫn \(tr\.4\)/i)).toBeInTheDocument();
    expect(screen.getByText(/đồ dùng bằng kim loại/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /đóng trích dẫn/i }));
    expect(screen.queryByText(/trích dẫn \(tr\.4\)/i)).not.toBeInTheDocument();
  });

  test("test_pdf_without_citation_keeps_todays_src", async () => {
    const blob = new Blob(["%PDF"], { type: "application/pdf" });
    render(<FileOriginalView blob={blob} name="tt.pdf" />);
    const frame = await screen.findByTitle(/file gốc/i);
    expect(frame.src).toContain("#zoom=page-width&pagemode=none");
    expect(frame.src).not.toContain("page=4");
    expect(frame.src).not.toContain("#page=");
    expect(screen.queryByText(/trích dẫn/i)).not.toBeInTheDocument();
  });

  test("test_text_kind_inline_marks_the_quote", async () => {
    const content =
      "Khoản 1. Cấm  mang rượu\nvà chất kích thích vào buồng giam.";
    render(
      <FileOriginalView
        blob={textBlob(content)}
        name="quydinh.txt"
        citation={{ page: null, quote: "Cấm mang rượu và chất kích thích" }}
      />
    );
    await waitFor(() => {
      const mark = document.querySelector("mark.fov-cite-highlight");
      expect(mark).not.toBeNull();
      expect(mark.textContent).toContain("Cấm");
    });
    // No ribbon when the inline mark succeeded.
    expect(screen.queryByText(/trích dẫn/i)).not.toBeInTheDocument();
  });

  test("test_text_kind_unmatched_quote_falls_back_to_ribbon", async () => {
    render(
      <FileOriginalView
        blob={textBlob("nội dung hoàn toàn khác")}
        name="quydinh.txt"
        citation={{ page: 2, quote: "không hề xuất hiện trong file" }}
      />
    );
    expect(await screen.findByText(/trích dẫn \(tr\.2\)/i)).toBeInTheDocument();
    expect(document.querySelector("mark.fov-cite-highlight")).toBeNull();
  });

  test("test_docx_kind_marks_inside_parsed_html", async () => {
    const blob = new Blob(["pk"], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    render(
      <FileOriginalView
        blob={blob}
        name="vb.docx"
        citation={{ page: 1, quote: "thiết bị dùng để đun nấu" }}
      />
    );
    await waitFor(() => {
      const mark = document.querySelector("mark.fov-cite-highlight");
      expect(mark).not.toBeNull();
      expect(mark.textContent).toContain("đun nấu");
    });
  });

  test("test_no_citation_prop_changes_nothing_for_text", async () => {
    render(<FileOriginalView blob={textBlob("abc")} name="a.txt" />);
    expect(await screen.findByText("abc")).toBeInTheDocument();
    expect(document.querySelector("mark")).toBeNull();
    expect(screen.queryByText(/trích dẫn/i)).not.toBeInTheDocument();
  });
});
