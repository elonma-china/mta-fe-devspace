// src/features/analysis/api/tools.test.js
import { submitDraft, getDraftStatus, callDraft, exportDraftDocx } from "features/analysis/api/tools";
import {
  submitDirectiveReview,
  getDirectiveReviewStatus,
  exportDirectiveReviewDocx,
} from "./tools";
import { apiClient } from "lib/apiClient";
import { API_PREFIX } from "config";

jest.mock("lib/apiClient", () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), postBlob: jest.fn() },
}));

beforeEach(() => jest.clearAllMocks());

test("test_submit_draft_posts_to_draft_with_tool_prefix", () => {
  apiClient.post.mockResolvedValue({ task_id: "t1" });
  const payload = { document_ids: ["d1"], template_id: "speech_draft", options: {} };
  submitDraft(payload);
  expect(apiClient.post).toHaveBeenCalledWith("/draft", payload, {
    prefix: API_PREFIX.TOOL,
    signal: undefined,
  });
});

test("test_get_draft_status_builds_status_url_and_params", () => {
  apiClient.get.mockResolvedValue({});
  getDraftStatus("abc def", 1000, "c1");
  expect(apiClient.get).toHaveBeenCalledWith("/draft/status/abc%20def", {
    prefix: API_PREFIX.TOOL,
    signal: undefined,
    params: { startTime: 1000, conversation_id: "c1" },
  });
});

test("test_export_draft_docx_posts_blob_request", async () => {
  const blob = new Blob(["pk"], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const response = { blob, filename: "phatbieu_20260725_1435.docx" };
  apiClient.postBlob.mockResolvedValue(response);
  const payload = {
    draft_markdown: "# Báo cáo\n\nNội dung",
    template_id: "speech_draft",
  };
  const result = await exportDraftDocx(payload);
  expect(apiClient.postBlob).toHaveBeenCalledWith("/draft/export", payload, {
    prefix: API_PREFIX.TOOL,
    signal: undefined,
  });
  expect(result).toBe(response);
});

test("test_call_draft_resolves_when_draft_markdown_present", async () => {
  apiClient.post.mockResolvedValue({ task_id: "t1" });
  apiClient.get.mockResolvedValue({ draft_markdown: "# Report" });
  const result = await callDraft({ document_ids: ["d1"], template_id: "speech_draft" });
  expect(result.draft_markdown).toBe("# Report");
});

describe("directive review", () => {
  test("test_submit_directive_review_posts_formdata_untouched", async () => {
    const fd = new FormData();
    fd.append("file", new Blob(["pk"]), "draft.docx");
    fd.append("payload", JSON.stringify({ reference_document_ids: ["d1"], options: {} }));
    apiClient.post.mockResolvedValue({ task_id: "t9" });

    const result = await submitDirectiveReview(fd);

    expect(apiClient.post).toHaveBeenCalledWith("/directive-review", fd, {
      prefix: API_PREFIX.TOOL,
      signal: undefined,
    });
    // The FormData instance must be passed through, NOT serialized — apiClient
    // relies on `body instanceof FormData` to set the multipart boundary.
    const [, body] = apiClient.post.mock.calls[0];
    expect(body).toBeInstanceOf(FormData);
    expect(result).toEqual({ task_id: "t9" });
  });

  test("test_get_directive_review_status_sends_no_startTime", async () => {
    // Critical: _apply_zombie_check on the backend rewrites a status-less
    // response into FAILURE once startTime is older than 10 minutes, and the
    // AI's COMPLETED response has no status field. Sending startTime would
    // corrupt a successful long-running review into a failure.
    apiClient.get.mockResolvedValue({ report_markdown: "# ok" });

    await getDirectiveReviewStatus("t9");

    expect(apiClient.get).toHaveBeenCalledWith("/directive-review/status/t9", {
      prefix: API_PREFIX.TOOL,
      signal: undefined,
    });
    const [, opts] = apiClient.get.mock.calls[0];
    expect(opts.params).toBeUndefined();
  });

  test("test_export_directive_review_docx_posts_blob", async () => {
    const blob = new Blob(["pk"], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const response = { blob, filename: "rasoat_20260725_1620.docx" };
    apiClient.postBlob.mockResolvedValue(response);
    const payload = { report_markdown: "# Báo cáo" };

    const result = await exportDirectiveReviewDocx(payload);

    expect(apiClient.postBlob).toHaveBeenCalledWith("/directive-review/export", payload, {
      prefix: API_PREFIX.TOOL,
      signal: undefined,
    });
    expect(result).toBe(response);
  });
});
