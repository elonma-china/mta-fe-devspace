import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import DraftUploadModal from "../components/DraftUploadModal";

// AnalysisSection.js pulls in the components barrel (".") for InfoPanel and
// DetachableMindmap, whose ESM-only markdown/mindmap dependencies aren't
// transformed by Jest. Mock them so importing the pure helpers below doesn't
// require parsing those packages.
jest.mock("react-markdown", () => ({
  __esModule: true,
  // Renders children as text, but parses markdown links `[label](href)` —
  // including the nested-bracket chip shape `[[1]](#dr-citation-1)` — through
  // the `components.a` override when provided, so link-override behavior
  // (report source chips, directive citation chips) is actually exercised.
  default: ({ children, components }) => {
    const text = String(children ?? "");
    const re = /\[(\[[^\]]*\]|[^\]]*)\]\(([^)]+)\)/g;
    const parts = [];
    let last = 0;
    let i = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      const A = components?.a;
      parts.push(
        A ? (
          <A key={`l${i++}`} href={m[2]}>
            {m[1]}
          </A>
        ) : (
          <a key={`l${i++}`} href={m[2]}>
            {m[1]}
          </a>
        )
      );
      last = m.index + m[0].length;
    }
    parts.push(text.slice(last));
    return <div>{parts}</div>;
  },
}));
jest.mock("remark-gfm", () => ({ __esModule: true, default: () => null }));
jest.mock("rehype-raw", () => ({ __esModule: true, default: () => null }));
jest.mock("rehype-highlight", () => ({ __esModule: true, default: () => null }));
jest.mock("remark-math", () => ({ __esModule: true, default: () => null }));
jest.mock("rehype-katex", () => ({ __esModule: true, default: () => null }));
jest.mock("highlight.js/styles/github.css", () => ({}));
jest.mock("katex/dist/katex.min.css", () => ({}));
jest.mock("markmap-view", () => ({ Markmap: { create: jest.fn() } }));
jest.mock("markmap-lib", () => ({
  Transformer: jest.fn().mockImplementation(() => ({ transform: jest.fn() })),
}));
jest.mock("markmap-toolbar", () => ({ Toolbar: { create: jest.fn() } }));
jest.mock("markmap-toolbar/dist/style.css", () => ({}));
// PDF.js citation viewer (spec 2026-07-17): FileOriginalView lazy-imports it
// for PDFs WITH a quote. Mock it — the real module pulls react-pdf (ESM) and
// the import.meta worker wiring, neither of which parse under babel-jest.
jest.mock("features/documents/components/viewer/PdfCitationView", () => ({
  __esModule: true,
  default: () => {
    const React = require("react");
    return React.createElement("div", { "data-testid": "pdf-citation-view" });
  },
}));

import {
  contentForResult,
  isRefused,
  isPollExpired,
  DIRECTIVE_REVIEW_MAX_WAIT_MS,
  MAX_REFERENCE_DOCS,
} from "../components/AnalysisSection";

jest.mock("assets/images/report.svg", () => ({
  ReactComponent: () => <span data-testid="report-icon" />,
}));
// CRA's stub SVG jest-transform (react-scripts/config/jest/fileTransform.js)
// hand-builds a react.element object that predates React 19's element shape
// and trips react-dom 19's stricter validation the moment it's actually
// mounted (not merely imported) — see AnalysisSection's real-wiring tests
// below, which render the full component including its icon tiles.
jest.mock("assets/images/summary.svg", () => ({
  ReactComponent: () => <span data-testid="summary-icon" />,
}));
jest.mock("assets/images/mindmap.svg", () => ({
  ReactComponent: () => <span data-testid="mindmap-icon" />,
}));
jest.mock("assets/images/delete.svg", () => ({
  ReactComponent: (props) => <span data-testid="delete-icon" {...props} />,
}));
// InfoPanel (mounted directly further below, for the directive_review
// describe block) pulls in copy/download/expand icons too — same CRA stub
// SVG issue as above. Props are forwarded so getByTitle/aria-label lookups
// on the rendered icon (e.g. the "Tải DOCX" download button) work.
jest.mock("assets/images/copy.svg", () => ({
  ReactComponent: (props) => <span data-testid="copy-icon" {...props} />,
}));
jest.mock("assets/images/download.svg", () => ({
  ReactComponent: (props) => <span data-testid="download-icon" {...props} />,
}));
jest.mock("assets/images/expand.svg", () => ({
  ReactComponent: (props) => <span data-testid="expand-icon" {...props} />,
}));

const docxFile = (name = "du-thao.docx", size = 1024) => {
  const f = new File(["pk"], name, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

const pdfFile = (name = "du-thao.pdf", size = 1024) => {
  const f = new File(["%PDF"], name, { type: "application/pdf" });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

describe("DraftUploadModal", () => {
  test("test_submit_disabled_until_a_docx_is_chosen", () => {
    render(<DraftUploadModal open onClose={jest.fn()} onPick={jest.fn()} />);
    expect(screen.getByRole("button", { name: /bắt đầu rà soát/i })).toBeDisabled();
  });

  test("test_picks_the_chosen_docx_file", () => {
    const onPick = jest.fn();
    const onClose = jest.fn();
    render(<DraftUploadModal open onClose={onClose} onPick={onPick} />);

    const file = docxFile();
    fireEvent.change(screen.getByLabelText(/chọn file/i), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: /bắt đầu rà soát/i }));

    expect(onPick).toHaveBeenCalledWith(file);
    expect(onClose).toHaveBeenCalled();
  });

  test("test_picks_the_chosen_pdf_file", () => {
    // .pdf covers both native-text and scanned drafts — BE's liteparse
    // processor OCRs image-only pages internally.
    const onPick = jest.fn();
    const onClose = jest.fn();
    render(<DraftUploadModal open onClose={onClose} onPick={onPick} />);

    const file = pdfFile();
    fireEvent.change(screen.getByLabelText(/chọn file/i), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: /bắt đầu rà soát/i }));

    expect(onPick).toHaveBeenCalledWith(file);
    expect(onClose).toHaveBeenCalled();
  });

  test("test_rejects_unsupported_file_type", () => {
    const onPick = jest.fn();
    render(<DraftUploadModal open onClose={jest.fn()} onPick={onPick} />);

    fireEvent.change(screen.getByLabelText(/chọn file/i), {
      target: { files: [new File(["hello"], "draft.txt", { type: "text/plain" })] },
    });

    expect(screen.getByText(/chỉ hỗ trợ file \.docx, \.pdf/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /bắt đầu rà soát/i })).toBeDisabled();
  });

  test("test_rejects_file_over_50mb", () => {
    render(<DraftUploadModal open onClose={jest.fn()} onPick={jest.fn()} />);

    fireEvent.change(screen.getByLabelText(/chọn file/i), {
      target: { files: [docxFile("big.docx", 51 * 1024 * 1024)] },
    });

    expect(screen.getByText(/vượt quá dung lượng/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /bắt đầu rà soát/i })).toBeDisabled();
  });
});

describe("directive review poll semantics", () => {
  test("test_content_comes_from_report_markdown_not_draft_markdown", () => {
    expect(
      contentForResult("directive_review", { report_markdown: "# Góp ý", draft_markdown: "WRONG" })
    ).toBe("# Góp ý");
    expect(contentForResult("report", { draft_markdown: "# Báo cáo" })).toBe("# Báo cáo");
  });

  test("test_refusal_is_detected_even_though_http_succeeded", () => {
    // The AI service refuses an empty draft / unindexed references with a 200
    // carrying refused:true and an empty report — NOT an error status.
    expect(
      isRefused({ refused: true, refusal_reason: "Dự thảo không có nội dung để phân tích." })
    ).toBe(true);
    expect(isRefused({ refused: false, report_markdown: "# ok" })).toBe(false);
    expect(isRefused({ report_markdown: "# ok" })).toBe(false);
  });

  test("test_poll_expires_only_past_the_ceiling", () => {
    const now = 1_000_000_000_000;
    expect(isPollExpired(now - 1000, now)).toBe(false);
    expect(isPollExpired(now - DIRECTIVE_REVIEW_MAX_WAIT_MS - 1, now)).toBe(true);
  });

  test("test_reference_doc_cap_is_ten_not_fifty", () => {
    // The AI service caps reference_document_ids at 10 (max_length), unlike
    // report's MAX_REPORT_DOCS = 50.
    expect(MAX_REFERENCE_DOCS).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Real-wiring tests (code review finding 1): the 4 tests above only exercise
// exported pure helpers in isolation. Everything below mounts the real
// AnalysisSection and drives it through the real useTaskPoller + store
// wiring, mocking only at the module boundary (stores + api), the way
// documentRepoStatusPoll.test.js does for the admin repo screen.
// ─────────────────────────────────────────────────────────────────────────

import { act, waitFor } from "@testing-library/react";
import { PROCESSING_STATUS } from "constants/status";
import AnalysisSection from "../components/AnalysisSection";
import useAnalysisStoreMock from "stores/useAnalysisStore";
import useModalStoreMock from "stores/useModalStore";
import {
  getSummaryStatus,
  getMindmapStatus,
  getDraftStatus,
  getDirectiveReviewStatus,
  updateConversationInfo,
} from "../api";

// Auto-mock: every named export of "../api" becomes a jest.fn(). We import
// the same jest.fn() instances above to configure return values per test.
jest.mock("../api");

jest.mock("stores/useAuthStore", () => ({
  __esModule: true,
  default: () => ({ user: { id: "u1" } }),
}));
jest.mock("stores/useChatStore", () => ({
  __esModule: true,
  default: () => ({ selectedConvId: "c1" }),
}));
jest.mock("stores/useDocumentStore", () => ({
  __esModule: true,
  default: () => ({ selectedDocumentIds: [], documents: [] }),
}));

// showModal/hideModal captured on a handle exposed off the mocked default
// export (__mock) so tests can assert on them without re-declaring the
// factory per test.
jest.mock("stores/useModalStore", () => {
  const showModal = jest.fn();
  const hideModal = jest.fn();
  const fn = () => ({ showModal, hideModal });
  fn.__mock = { showModal, hideModal };
  return { __esModule: true, default: fn };
});

// useAnalysisStore needs to be a *mutable*, reactive-enough fake: the real
// store's pollingTasks object reference is read once by useTaskPoller's
// effect and then mutated in place by completePolling (delete the finished
// id) so the SAME effect instance stops polling that id on the next tick —
// mirroring the real store's contract closely enough to prove the ceiling
// actually terminates polling, not just detects expiry.
jest.mock("stores/useAnalysisStore", () => {
  const state = {
    items: [],
    pending: [],
    selectedInfo: null,
    pollingTasks: {},
    fetchItems: jest.fn(),
    generate: jest.fn(),
    deleteItem: jest.fn(),
    selectInfo: jest.fn(),
    clearSelection: jest.fn(),
    updateItemContent: jest.fn(),
    updateItem: jest.fn(),
    completePolling: jest.fn((itemId) => {
      delete state.pollingTasks[itemId];
    }),
  };
  const fn = (selector) => (selector ? selector(state) : state);
  fn.getState = () => state;
  fn.__mockState = state;
  return { __esModule: true, default: fn };
});

describe("AnalysisSection real wiring (useTaskPoller + store dispatch)", () => {
  const state = useAnalysisStoreMock.__mockState;
  const showModal = useModalStoreMock.__mock.showModal;

  beforeEach(() => {
    state.items = [];
    state.pending = [];
    state.selectedInfo = null;
    state.pollingTasks = {};
    state.updateItemContent = jest.fn();
    state.updateItem = jest.fn();
    state.completePolling = jest.fn((itemId) => {
      delete state.pollingTasks[itemId];
    });
    showModal.mockClear();
    getSummaryStatus.mockReset();
    getMindmapStatus.mockReset();
    getDraftStatus.mockReset();
    getDirectiveReviewStatus.mockReset();
    updateConversationInfo.mockReset().mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("test_refusal_produces_error_item_and_the_specific_reason_not_a_blank_report_or_generic_message", async () => {
    state.pollingTasks = {
      "item-1": {
        taskId: "task-1",
        type: "directive_review",
        dateCreated: new Date().toISOString(),
      },
    };
    getDirectiveReviewStatus.mockResolvedValue({
      refused: true,
      refusal_reason: "Dự thảo không có nội dung để phân tích.",
      report_markdown: "",
    });

    render(<AnalysisSection />);

    await waitFor(() =>
      expect(state.updateItemContent).toHaveBeenCalledWith(
        "item-1",
        "",
        PROCESSING_STATUS.ERROR
      )
    );
    expect(state.completePolling).toHaveBeenCalledWith("item-1");

    // handlePollComplete (which would render report_markdown, here "") must
    // NOT have been the path taken — updateItem (the completion path) is
    // never called; only updateItemContent (the error/refusal path) is.
    expect(state.updateItem).not.toHaveBeenCalled();

    const [, props] = showModal.mock.calls.at(-1);
    expect(props.message).toBe("Dự thảo không có nội dung để phân tích.");
    // The generic fallback would discard the specific reason — assert it's
    // not what's shown.
    expect(props.message).not.toMatch(/Không thể tạo/);
  });

  test("test_checkStatus_dispatches_directive_review_without_startTime_or_conversationId_but_others_keep_both", async () => {
    // Recent, not a fixed calendar date — a stale fixed timestamp can drift
    // past the directive_review poll ceiling as the test suite ages, which
    // would make this test assert the wrong (expired) branch entirely.
    const dateCreated = new Date(Date.now() - 60_000).toISOString();
    state.pollingTasks = {
      s1: { taskId: "sum-1", type: "summary", dateCreated },
      m1: { taskId: "map-1", type: "mindmap", dateCreated },
      r1: { taskId: "rep-1", type: "report", dateCreated },
      d1: { taskId: "dir-1", type: "directive_review", dateCreated },
    };
    getSummaryStatus.mockResolvedValue({ status: "PROCESSING" });
    getMindmapStatus.mockResolvedValue({ status: "PROCESSING" });
    getDraftStatus.mockResolvedValue({ status: "PROCESSING" });
    getDirectiveReviewStatus.mockResolvedValue({ status: "PROCESSING" });

    render(<AnalysisSection />);

    await waitFor(() => expect(getDirectiveReviewStatus).toHaveBeenCalled());
    await waitFor(() => expect(getSummaryStatus).toHaveBeenCalled());
    await waitFor(() => expect(getMindmapStatus).toHaveBeenCalled());
    await waitFor(() => expect(getDraftStatus).toHaveBeenCalled());

    const ts = new Date(dateCreated).getTime();
    expect(getSummaryStatus).toHaveBeenCalledWith("sum-1", ts, "c1");
    expect(getMindmapStatus).toHaveBeenCalledWith("map-1", ts, "c1");
    expect(getDraftStatus).toHaveBeenCalledWith("rep-1", ts, "c1");

    // directive_review: exactly one argument — no startTime, no conversationId.
    expect(getDirectiveReviewStatus).toHaveBeenCalledWith("dir-1");
    expect(getDirectiveReviewStatus.mock.calls[0]).toHaveLength(1);
  });

  test("test_poll_ceiling_terminates_an_expired_directive_review_task_without_ever_calling_the_status_endpoint", async () => {
    const longAgo = new Date(
      Date.now() - DIRECTIVE_REVIEW_MAX_WAIT_MS - 60000
    ).toISOString();
    state.pollingTasks = {
      "item-old": {
        taskId: "task-old",
        type: "directive_review",
        dateCreated: longAgo,
      },
    };

    render(<AnalysisSection />);

    await waitFor(() =>
      expect(state.updateItemContent).toHaveBeenCalledWith(
        "item-old",
        "",
        PROCESSING_STATUS.ERROR
      )
    );

    // Terminated, not merely detected: the store's polling entry is gone —
    // the same useTaskPoller effect instance will skip this id on every
    // later tick (see the mocked completePolling above) — and the real
    // network call was never made.
    expect(state.completePolling).toHaveBeenCalledWith("item-old");
    expect(state.pollingTasks["item-old"]).toBeUndefined();
    expect(getDirectiveReviewStatus).not.toHaveBeenCalled();

    const [, props] = showModal.mock.calls.at(-1);
    expect(props.message).toBe("Tác vụ rà soát vượt quá thời gian cho phép.");
  });

  test("test_appendCitations_folds_into_report_but_not_directive_review", async () => {
    state.items = [{ id: "rep-item", type: "report", selected: {} }];
    state.pollingTasks = {
      "rep-item": {
        taskId: "rep-task",
        type: "report",
        dateCreated: new Date().toISOString(),
      },
      "dir-item": {
        taskId: "dir-task",
        type: "directive_review",
        dateCreated: new Date().toISOString(),
      },
    };
    getDraftStatus.mockResolvedValue({
      status: "SUCCESS",
      draft_markdown: "# Báo cáo",
      citations: [{ marker: 1, doc_id: "d1", doc_name: "Văn bản A", page: 2 }],
    });
    // Real directive_review responses never carry citations[] (the AI
    // service embeds its own "### Nguồn trích dẫn" appendix directly in
    // report_markdown) — included here anyway to prove the code path
    // doesn't fold it in even if present, not merely that it has nothing
    // to fold.
    getDirectiveReviewStatus.mockResolvedValue({
      report_markdown: "# Rà soát\n\nNội dung rà soát.",
      citations: [{ marker: 1, doc_id: "x1", doc_name: "Văn bản X", page: 5 }],
    });

    render(<AnalysisSection />);

    await waitFor(() => {
      const call = state.updateItem.mock.calls.find(([id]) => id === "rep-item");
      expect(call).toBeTruthy();
    });
    await waitFor(() => {
      const call = state.updateItem.mock.calls.find(([id]) => id === "dir-item");
      expect(call).toBeTruthy();
    });

    const reportCall = state.updateItem.mock.calls.find(([id]) => id === "rep-item");
    expect(reportCall[1].content).toContain("### Nguồn trích dẫn");

    const directiveCall = state.updateItem.mock.calls.find(([id]) => id === "dir-item");
    expect(directiveCall[1].content).toBe("# Rà soát\n\nNội dung rà soát.");
    expect(directiveCall[1].selected).toBeUndefined();
  });

  test("test_completion_persists_deduped_citations_into_selected", async () => {
    // The slim marker→source lookup that makes [n] chips clickable after a
    // reload. Deduped by marker (first occurrence wins), chunk noise dropped,
    // and the existing selected fields (reference ids, draft name) preserved.
    state.items = [
      {
        id: "dir-item",
        type: "directive_review",
        selected: { reference_document_ids: ["d2"], draft_filename: "d.docx" },
      },
    ];
    state.pollingTasks = {
      "dir-item": {
        taskId: "dir-task",
        type: "directive_review",
        dateCreated: new Date().toISOString(),
      },
    };
    getDirectiveReviewStatus.mockResolvedValue({
      report_markdown:
        "# Văn bản góp ý dự thảo\n\n### Nguồn trích dẫn\n\n[2] a\n[5] b",
      refused: false,
      verdicts: [
        {
          citations: [
            { marker: 2, doc_id: "d2", doc_name: "TT2.pdf", page: 3, quote: "q2", chunk_id: "c2", chunk_index: 1 },
          ],
        },
        {
          citations: [
            { marker: 2, doc_id: "d2", doc_name: "TT2.pdf", page: 3, quote: "ignored dup", chunk_id: "c2", chunk_index: 1 },
            { marker: 5, doc_id: "d5", doc_name: "TT5.pdf", page: 7, quote: "q5", chunk_id: "c5", chunk_index: 4 },
          ],
        },
      ],
    });

    render(<AnalysisSection />);

    await waitFor(() => {
      const call = state.updateItem.mock.calls.find(([id]) => id === "dir-item");
      expect(call).toBeTruthy();
    });
    const [, patch] = state.updateItem.mock.calls.find(([id]) => id === "dir-item");
    expect(patch.selected.citations).toEqual([
      { marker: 2, doc_id: "d2", doc_name: "TT2.pdf", page: 3, quote: "q2" },
      { marker: 5, doc_id: "d5", doc_name: "TT5.pdf", page: 7, quote: "q5" },
    ]);
    // Existing selected fields must survive the merge.
    expect(patch.selected.reference_document_ids).toEqual(["d2"]);
    expect(patch.selected.draft_filename).toBe("d.docx");
    // And the persisted DB update carries the same selected payload.
    await waitFor(() => expect(updateConversationInfo).toHaveBeenCalled());
    const persisted = updateConversationInfo.mock.calls.find(
      ([, , id]) => id === "dir-item"
    );
    expect(persisted[3].selected.citations).toHaveLength(2);
  });

  test("test_missing_dateCreated_cannot_disable_the_poll_ceiling", async () => {
    // Finding 2 regression test. The buggy version re-derived startedAt as
    // Date.now() on every tick when dateCreated was absent, so "now minus
    // now" never exceeds the ceiling and polling never stops. Modern fake
    // timers advance Date.now() together with setInterval callbacks, so we
    // can prove the fix captures a first-seen timestamp on tick 1 and
    // reuses it on tick 2, rather than re-basing it forward.
    jest.useFakeTimers();
    const t0 = Date.now();
    state.pollingTasks = {
      "item-nodate": { taskId: "task-nodate", type: "directive_review" },
    };
    getDirectiveReviewStatus.mockResolvedValue({ status: "PROCESSING" });

    render(<AnalysisSection />);
    // Flush the immediate on-mount poll (tick 1): captures startedAt ~= t0
    // and, since not yet expired, calls the real status endpoint once.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getDirectiveReviewStatus).toHaveBeenCalledTimes(1);
    expect(state.updateItemContent).not.toHaveBeenCalled();

    // Jump the clock past the ceiling WITHOUT firing any timers, then let
    // exactly one more 3s tick run.
    act(() => {
      jest.setSystemTime(new Date(t0 + DIRECTIVE_REVIEW_MAX_WAIT_MS + 60000));
    });
    await act(async () => {
      jest.advanceTimersByTime(3100);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Tick 2 must have used tick 1's captured startedAt (now long expired),
    // NOT a freshly recomputed Date.now() — so it must route to onError
    // and must NOT have called the real status endpoint again.
    expect(getDirectiveReviewStatus).toHaveBeenCalledTimes(1);
    expect(state.updateItemContent).toHaveBeenCalledWith(
      "item-nodate",
      "",
      PROCESSING_STATUS.ERROR
    );
  });
});

describe("handlePollError message surfacing (finding 3)", () => {
  const state = useAnalysisStoreMock.__mockState;
  const showModal = useModalStoreMock.__mock.showModal;

  beforeEach(() => {
    state.items = [];
    state.pending = [];
    state.selectedInfo = null;
    state.pollingTasks = {};
    state.updateItemContent = jest.fn();
    state.updateItem = jest.fn();
    state.completePolling = jest.fn((itemId) => {
      delete state.pollingTasks[itemId];
    });
    showModal.mockClear();
    getSummaryStatus.mockReset();
    getMindmapStatus.mockReset();
    getDraftStatus.mockReset();
    getDirectiveReviewStatus.mockReset();
    updateConversationInfo.mockReset().mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("test_directive_review_failure_with_no_message_falls_back_to_generic_copy", async () => {
    state.pollingTasks = {
      "d1": { taskId: "dir-1", type: "directive_review", dateCreated: new Date().toISOString() },
    };
    getDirectiveReviewStatus.mockResolvedValue({ status: "FAILURE" });

    render(<AnalysisSection />);

    await waitFor(() =>
      expect(state.updateItemContent).toHaveBeenCalledWith("d1", "", PROCESSING_STATUS.ERROR)
    );

    const [, props] = showModal.mock.calls.at(-1);
    expect(props.message).toBe("Không thể tạo rà soát dự thảo. Vui lòng thử lại.");
  });

  test.each([
    ["summary", () => getSummaryStatus, "it-s", "Không thể tạo tóm tắt. Vui lòng thử lại."],
    ["mindmap", () => getMindmapStatus, "it-m", "Không thể tạo bản đồ tư duy. Vui lòng thử lại."],
    ["report", () => getDraftStatus, "it-r", "Không thể tạo văn bản. Vui lòng thử lại."],
  ])(
    "test_%s_failure_keeps_the_generic_vietnamese_copy_even_when_the_backend_sends_a_message",
    async (type, getStatusFn, itemId, expectedMessage) => {
      state.pollingTasks = {
        [itemId]: { taskId: `task-${type}`, type, dateCreated: new Date().toISOString() },
      };
      // Mirrors the backend's zombie-check payload (English, hardcoded) —
      // see backend-fastapi/app/routes/llm.py:_apply_zombie_check. It must
      // never be parroted back to the user for these three types.
      getStatusFn().mockResolvedValue({
        status: "FAILURE",
        message: "Task exceeded the 10 minute processing limit.",
      });

      render(<AnalysisSection />);

      await waitFor(() =>
        expect(state.updateItemContent).toHaveBeenCalledWith(itemId, "", PROCESSING_STATUS.ERROR)
      );

      const [, props] = showModal.mock.calls.at(-1);
      expect(props.message).toBe(expectedMessage);
      expect(props.message).not.toMatch(/processing limit/i);
    }
  );

  test("test_directive_review_ceiling_message_is_surfaced_verbatim_not_swallowed", async () => {
    const longAgo = new Date(Date.now() - DIRECTIVE_REVIEW_MAX_WAIT_MS - 60000).toISOString();
    state.pollingTasks = {
      "d-ceiling": { taskId: "task-ceiling", type: "directive_review", dateCreated: longAgo },
    };

    render(<AnalysisSection />);

    await waitFor(() =>
      expect(state.updateItemContent).toHaveBeenCalledWith(
        "d-ceiling",
        "",
        PROCESSING_STATUS.ERROR
      )
    );

    const [, props] = showModal.mock.calls.at(-1);
    expect(props.message).toBe("Tác vụ rà soát vượt quá thời gian cho phép.");
  });

  test("test_directive_review_backend_origin_message_does_not_leak_does_not_use_generic_copy", async () => {
    // Finding 1 regression test. getDirectiveReviewStatus hits the generic
    // backend route GET /tools/{tool_name}/status/{task_id}
    // (backend-fastapi/app/routes/llm.py), which on ANY upstream 4xx/5xx
    // returns {status: FAILURE, message: <err_json detail or raw response
    // text>} — English, possibly a raw body — and ToolStatusResponse is
    // `extra: "allow"`, so upstream `message` fields pass through too. Before
    // the fix, handlePollError trusted `result.message` for directive_review
    // regardless of its origin, so this backend-origin message would leak
    // straight into the (Vietnamese) AlertModal. It must instead fall back
    // to the generic Vietnamese copy, exactly like the other three types.
    state.pollingTasks = {
      "d-backend-msg": {
        taskId: "task-backend-msg",
        type: "directive_review",
        dateCreated: new Date().toISOString(),
      },
    };
    getDirectiveReviewStatus.mockResolvedValue({
      status: "FAILURE",
      message: "Some English detail",
    });

    render(<AnalysisSection />);

    await waitFor(() =>
      expect(state.updateItemContent).toHaveBeenCalledWith(
        "d-backend-msg",
        "",
        PROCESSING_STATUS.ERROR
      )
    );

    const [, props] = showModal.mock.calls.at(-1);
    expect(props.message).toBe("Không thể tạo rà soát dự thảo. Vui lòng thử lại.");
    expect(props.message).not.toMatch(/Some English detail/);
  });

  test("test_malformed_dateCreated_still_trips_the_poll_ceiling", async () => {
    // Finding 2 regression test. new Date("junk").getTime() is NaN, and
    // NaN - x > MAX is always false, so a naive isPollExpired(startedAt)
    // check would never trip and polling would continue forever — the same
    // fail-open hole in a third costume. The fix must detect the NaN via
    // Number.isFinite and fall back to the first-seen-ref anchor path
    // instead of trusting the unparseable dateCreated.
    jest.useFakeTimers();
    const t0 = Date.now();
    state.pollingTasks = {
      "item-baddate": {
        taskId: "task-baddate",
        type: "directive_review",
        dateCreated: "not-a-real-date",
      },
    };
    getDirectiveReviewStatus.mockResolvedValue({ status: "PROCESSING" });

    render(<AnalysisSection />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getDirectiveReviewStatus).toHaveBeenCalledTimes(1);
    expect(state.updateItemContent).not.toHaveBeenCalled();

    act(() => {
      jest.setSystemTime(new Date(t0 + DIRECTIVE_REVIEW_MAX_WAIT_MS + 60000));
    });
    await act(async () => {
      jest.advanceTimersByTime(3100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getDirectiveReviewStatus).toHaveBeenCalledTimes(1);
    expect(state.updateItemContent).toHaveBeenCalledWith(
      "item-baddate",
      "",
      PROCESSING_STATUS.ERROR
    );
    const [, props] = showModal.mock.calls.at(-1);
    expect(props.message).toBe("Tác vụ rà soát vượt quá thời gian cho phép.");
  });
});

import { exportDirectiveReviewDocx } from "../api/tools";
import InfoPanel from "../components/InfoPanel";
import { downloadBlob } from "../utils/reportExport";

jest.mock("../api/tools");
jest.mock("../utils/reportExport", () => ({
  ...jest.requireActual("../utils/reportExport"),
  downloadBlob: jest.fn(),
}));

describe("InfoPanel directive_review", () => {
  const item = {
    id: "i9",
    type: "directive_review",
    name: "Rà soát dự thảo - du-thao.docx",
    content: "# Văn bản góp ý dự thảo\n\n### Nguồn trích dẫn\n\n[1] Thông tư 07/2024",
    selected: { reference_document_ids: ["r1"], draft_filename: "du-thao.docx" },
  };

  test("test_renders_report_markdown", () => {
    render(<InfoPanel item={item} onClose={jest.fn()} />);
    expect(screen.getByText(/văn bản góp ý dự thảo/i)).toBeInTheDocument();
    expect(screen.getByText(/nguồn trích dẫn/i)).toBeInTheDocument();
  });

  test("test_export_posts_report_markdown_and_downloads", async () => {
    const blob = new Blob(["pk"]);
    exportDirectiveReviewDocx.mockResolvedValue({
      blob,
      filename: "rasoat_20260725_1620.docx",
    });

    render(<InfoPanel item={item} onClose={jest.fn()} />);
    fireEvent.click(screen.getByTitle(/tải docx/i));

    await waitFor(() => expect(exportDirectiveReviewDocx).toHaveBeenCalled());
    const [payload] = exportDirectiveReviewDocx.mock.calls[0];
    expect(payload.report_markdown).toBe(item.content);
    // No template_id: directive review has one fixed report shape.
    expect(payload.template_id).toBeUndefined();
    await waitFor(() =>
      expect(downloadBlob).toHaveBeenCalledWith(blob, "rasoat_20260725_1620.docx")
    );
  });
});

describe("InfoPanel directive citations", () => {
  const itemWithCites = {
    id: "i9",
    type: "directive_review",
    name: "Rà soát dự thảo - du-thao.docx",
    content:
      "## Những điểm cần chỉnh sửa\n- đề xuất X\n  - Nguồn: [1] TT2.pdf — tr.3\n\n### Nguồn trích dẫn\n\n[1] TT2.pdf — tr.3",
    selected: {
      reference_document_ids: ["d2"],
      draft_filename: "du-thao.docx",
      citations: [
        { marker: 1, doc_id: "d2", doc_name: "TT2.pdf", page: 3, quote: "trích dẫn nguồn" },
      ],
    },
  };

  test("test_markers_render_as_chips_and_click_opens_citation", () => {
    const showModal = useModalStoreMock.__mock.showModal;
    showModal.mockClear();
    render(<InfoPanel item={itemWithCites} onClose={jest.fn()} />);
    const chips = screen.getAllByRole("button", { name: "[1]" });
    expect(chips.length).toBeGreaterThanOrEqual(2); // body + appendix
    fireEvent.click(chips[0]);
    expect(showModal).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        docId: "d2",
        docName: "TT2.pdf",
        citation: { page: 3, quote: "trích dẫn nguồn" },
      })
    );
  });

  test("test_without_persisted_citations_markers_stay_plain_text", () => {
    const item = {
      ...itemWithCites,
      selected: { reference_document_ids: ["d2"] },
    };
    render(
      <InfoPanel item={item} onClose={jest.fn()} onOpenCitation={jest.fn()} />
    );
    expect(screen.queryByRole("button", { name: "[1]" })).toBeNull();
    // The literal text still renders.
    expect(screen.getAllByText(/\[1\]/).length).toBeGreaterThan(0);
  });
});

// (AnalysisSection no longer forwards a citation prop — chips open the
// CitationCard modal directly from InfoPanel; see the describes below.)

// ── CitationCard: compact modal wrapping FileOriginalView ────────────────
import CitationCard from "../components/CitationCard";
import useViewerCacheStore from "stores/useViewerCacheStore";
import { fetchDocumentFile } from "features/documents/api";

jest.mock("features/documents/api", () => ({
  fetchDocumentFile: jest.fn(),
}));

describe("CitationCard", () => {
  beforeEach(() => {
    useViewerCacheStore.getState().clearViewerCache();
    fetchDocumentFile.mockReset();
    global.URL.createObjectURL = jest.fn(() => "blob:card");
    global.URL.revokeObjectURL = jest.fn();
  });

  const pdfBlob = () => new Blob(["%PDF"], { type: "application/pdf" });

  test("test_fetches_file_and_renders_original_view_at_cited_page", async () => {
    fetchDocumentFile.mockResolvedValue(pdfBlob());
    render(
      <CitationCard
        open
        onClose={jest.fn()}
        docId="d2"
        docName="TT2.pdf"
        citation={{ page: 3, quote: "trích dẫn nguồn" }}
      />
    );
    // Spec 2026-07-17: PDF + quote renders through the PDF.js citation
    // viewer (mocked); page focus is the viewer's job via the citation prop.
    await screen.findByTestId("pdf-citation-view");
    // Header names the doc and the cited page.
    expect(screen.getByText(/TT2\.pdf/)).toBeInTheDocument();
    expect(fetchDocumentFile).toHaveBeenCalledWith("u1", "c1", "d2");
  });

  test("test_second_open_same_doc_serves_from_cache", async () => {
    fetchDocumentFile.mockResolvedValue(pdfBlob());
    const first = render(
      <CitationCard open onClose={jest.fn()} docId="d2" docName="TT2.pdf"
        citation={{ page: 3, quote: "q" }} />
    );
    await screen.findByTestId("pdf-citation-view");
    first.unmount();
    render(
      <CitationCard open onClose={jest.fn()} docId="d2" docName="TT2.pdf"
        citation={{ page: 5, quote: "q2" }} />
    );
    await screen.findByTestId("pdf-citation-view");
    expect(fetchDocumentFile).toHaveBeenCalledTimes(1);
  });

  test("test_fetch_failure_shows_error_and_keeps_quote_visible", async () => {
    fetchDocumentFile.mockRejectedValue(new Error("502"));
    render(
      <CitationCard open onClose={jest.fn()} docId="d2" docName="TT2.pdf"
        citation={{ page: 3, quote: "đoạn trích quan trọng" }} />
    );
    expect(await screen.findByText(/không tải được tài liệu/i)).toBeInTheDocument();
    expect(screen.getByText(/đoạn trích quan trọng/)).toBeInTheDocument();
  });
});

describe("InfoPanel opens CitationCard via modal", () => {
  test("test_chip_click_shows_CitationCard_modal_with_citation_props", () => {
    const showModal = useModalStoreMock.__mock.showModal;
    showModal.mockClear();
    const item = {
      id: "i9",
      type: "directive_review",
      name: "Rà soát",
      content: "- Nguồn: [1] TT2.pdf — tr.3",
      selected: {
        citations: [
          { marker: 1, doc_id: "d2", doc_name: "TT2.pdf", page: 3, quote: "trích dẫn nguồn" },
        ],
      },
    };
    render(<InfoPanel item={item} onClose={jest.fn()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "[1]" })[0]);
    expect(showModal).toHaveBeenCalledWith(
      CitationCard,
      expect.objectContaining({
        docId: "d2",
        docName: "TT2.pdf",
        citation: { page: 3, quote: "trích dẫn nguồn" },
      })
    );
  });
});
