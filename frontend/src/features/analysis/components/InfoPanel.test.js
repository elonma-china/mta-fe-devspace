import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import InfoPanel from "features/analysis/components/InfoPanel";

jest.mock("remark-gfm", () => ({ __esModule: true, default: () => null }));
jest.mock("rehype-raw", () => ({ __esModule: true, default: () => null }));
jest.mock("rehype-highlight", () => ({ __esModule: true, default: () => null }));
jest.mock("remark-math", () => ({ __esModule: true, default: () => null }));
jest.mock("rehype-katex", () => ({ __esModule: true, default: () => null }));
jest.mock("highlight.js/styles/github.css", () => ({}));
jest.mock("katex/dist/katex.min.css", () => ({}));

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children, components }) => {
    const text = String(children || "");
    const linkRe = /\[([^\]]+)\]\(#report-source-(\d+)\)/g;
    const parts = [];
    let last = 0;
    let match;
    while ((match = linkRe.exec(text)) !== null) {
      if (match.index > last) parts.push(text.slice(last, match.index));
      const href = `#report-source-${match[2]}`;
      const Link = components?.a || (({ href: h, children: c }) => <a href={h}>{c}</a>);
      parts.push(
        <Link key={match.index} href={href}>
          {match[1]}
        </Link>
      );
      last = linkRe.lastIndex;
    }
    if (last < text.length) parts.push(text.slice(last));
    return <div data-testid="md">{parts}</div>;
  },
}));

jest.mock("features/documents/components/SourceCard", () => ({
  __esModule: true,
  default: ({ src }) => (
    <div role="dialog" aria-label="source-card">
      <div>{src?.enriched_content}</div>
      {Number.isFinite(src?.metadata?.page_number) ? (
        <span>{`(Trang ${src.metadata.page_number})`}</span>
      ) : null}
    </div>
  ),
}));

jest.mock("stores/useModalStore", () => ({
  __esModule: true,
  default: () => ({ showModal: jest.fn(), hideModal: jest.fn() }),
}));

jest.mock("stores/useDocumentStore", () => ({
  __esModule: true,
  default: (selector) =>
    selector({
      documents: [{ id: "d1", name: "prefix_Báo cáo A.docx" }],
    }),
}));

jest.mock("../api/tools", () => ({
  exportDraftDocx: jest.fn(),
  exportDirectiveReviewDocx: jest.fn(),
}));

jest.mock("../utils/reportExport", () => ({
  downloadBlob: jest.fn(),
  resolveTemplateId: () => "speech_draft",
  selectedDocumentIds: () => [],
}));

jest.mock("assets/images/delete.svg", () => ({
  __esModule: true,
  ReactComponent: (props) => require("react").createElement("svg", props),
}));
jest.mock("assets/images/copy.svg", () => ({
  __esModule: true,
  ReactComponent: (props) => require("react").createElement("svg", props),
}));
jest.mock("assets/images/download.svg", () => ({
  __esModule: true,
  ReactComponent: (props) => require("react").createElement("svg", props),
}));
jest.mock("assets/images/expand.svg", () => ({
  __esModule: true,
  ReactComponent: (props) => require("react").createElement("svg", props),
}));

const REPORT_ITEM = {
  id: "r1",
  type: "report",
  name: "Báo cáo thử",
  content:
    "# Báo cáo\n\nTheo [Báo cáo A, tr.1].\n\n---\n\n### Nguồn trích dẫn\n\n**[1](#report-source-1)** Báo cáo A — tr.1  \n   _\"kết quả tốt\"_",
  selected: {
    document_ids: ["d1"],
    template_id: "speech_draft",
    citations: [
      {
        marker: 1,
        doc_id: "d1",
        doc_name: "Báo cáo A",
        page: 1,
        chunk_index: 0,
        quote: "kết quả tốt",
      },
    ],
  },
  date_created: "2026-06-06T10:00:00Z",
};

test("test_export_docx_uses_the_server_filename", async () => {
  const { exportDraftDocx } = require("../api/tools");
  const { downloadBlob } = require("../utils/reportExport");
  const blob = new Blob(["pk"]);
  exportDraftDocx.mockResolvedValue({ blob, filename: "phatbieu_20260725_1435.docx" });

  render(<InfoPanel item={REPORT_ITEM} onClose={() => {}} />);
  fireEvent.click(screen.getByTitle("Tải DOCX"));
  await waitFor(() => expect(downloadBlob).toHaveBeenCalled());

  // Regression: the name used to be derived from the Vietnamese title here,
  // and `\w` without the /u flag stripped every accented letter out of it.
  expect(downloadBlob).toHaveBeenCalledWith(blob, "phatbieu_20260725_1435.docx");
  expect(exportDraftDocx.mock.calls[0][0]).not.toHaveProperty("filename");
});

test("report citation chip opens source card popup", () => {
  render(<InfoPanel item={REPORT_ITEM} onClose={() => {}} />);

  const chip = screen.getByRole("button", { name: "1" });
  fireEvent.click(chip, { clientX: 120, clientY: 80 });

  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText("kết quả tốt")).toBeInTheDocument();
  expect(screen.getByText(/Trang 1/)).toBeInTheDocument();
});

// Story 137: on plain HTTP the browser exposes no clipboard object, so the old
// direct call threw and the catch only reached the console — the button looked
// dead. Copy now goes through the shared helper and always reports the outcome
// on screen.
describe("copy button (story 137)", () => {
  const helpers = require("utils/helpers");

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("test_copy_success_shows_a_visible_confirmation", async () => {
    jest.spyOn(helpers, "copyTextToClipboard").mockResolvedValue(true);

    render(<InfoPanel item={REPORT_ITEM} onClose={() => {}} />);
    fireEvent.click(screen.getByTitle("Sao chép"));

    expect(await screen.findByRole("status")).toHaveTextContent("Đã sao chép");
  });

  test("test_copy_failure_is_visible_not_silent", async () => {
    // The whole point of the story: a failed copy must not be swallowed.
    jest.spyOn(helpers, "copyTextToClipboard").mockResolvedValue(false);

    render(<InfoPanel item={REPORT_ITEM} onClose={() => {}} />);
    fireEvent.click(screen.getByTitle("Sao chép"));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Không sao chép được"
    );
  });

  test("test_copied_report_text_is_stripped_like_the_screen_and_docx", async () => {
    const spy = jest.spyOn(helpers, "copyTextToClipboard").mockResolvedValue(true);
    const withMarker = {
      ...REPORT_ITEM,
      content: "Doanh thu tăng 6,8%. [?] Đề nghị phê duyệt.",
    };

    render(<InfoPanel item={withMarker} onClose={() => {}} />);
    fireEvent.click(screen.getByTitle("Sao chép"));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    // The legacy `[?]` marker is dropped on screen and in the DOCX; the
    // clipboard must agree with both instead of pasting a third variant.
    expect(spy).toHaveBeenCalledWith("Doanh thu tăng 6,8%. Đề nghị phê duyệt.");
  });

  test("test_empty_content_copies_nothing_and_shows_no_fake_success", async () => {
    const spy = jest.spyOn(helpers, "copyTextToClipboard").mockResolvedValue(true);

    render(<InfoPanel item={{ ...REPORT_ITEM, content: "" }} onClose={() => {}} />);
    fireEvent.click(screen.getByTitle("Sao chép"));

    expect(spy).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
