// src/stores/useAnalysisStore.test.js
import useAnalysisStore from "stores/useAnalysisStore";
import {
  submitDraft,
  addConversationInfo,
  submitDirectiveReview,
} from "features/analysis/api";

jest.mock("features/analysis/api");

beforeEach(() => {
  useAnalysisStore.setState({ items: [], pending: [], pollingTasks: {}, conversationId: null, selectedInfo: null, loading: false });
  jest.clearAllMocks();
});

test("test_generate_report_submits_draft_and_registers_polling", async () => {
  submitDraft.mockResolvedValue({ task_id: "t1" });
  addConversationInfo.mockResolvedValue({
    info: { id: "i1", type: "report", date_created: "2026-06-06" },
  });

  await useAnalysisStore.getState().generate("report", {
    userId: "u1",
    conversationId: "c1",
    documentIds: ["d1", "d2"],
    templateId: "opinion_consolidation",
    templateLabel: "Tổng hợp văn bản",
  });

  expect(submitDraft).toHaveBeenCalledWith({
    document_ids: ["d1", "d2"],
    template_id: "opinion_consolidation",
    options: {},
  });
  expect(addConversationInfo).toHaveBeenCalledWith(
    "u1",
    "c1",
    expect.objectContaining({
      type: "report",
      name: "Tổng hợp văn bản",
      selected: { document_ids: ["d1", "d2"], template_id: "opinion_consolidation" },
      task_id: "t1",
    })
  );

  const state = useAnalysisStore.getState();
  expect(state.items[0]).toEqual(expect.objectContaining({ id: "i1" }));
  expect(state.pollingTasks["i1"]).toEqual(
    expect.objectContaining({ taskId: "t1", type: "report" })
  );
});

test("test_generate_report_without_template_label_uses_bare_name", async () => {
  submitDraft.mockResolvedValue({ task_id: "t2" });
  addConversationInfo.mockResolvedValue({
    info: { id: "i2", type: "report", date_created: "2026-06-06" },
  });

  await useAnalysisStore.getState().generate("report", {
    userId: "u1",
    conversationId: "c1",
    documentIds: ["d1"],
    templateId: "speech_draft",
  });

  expect(addConversationInfo).toHaveBeenCalledWith(
    "u1",
    "c1",
    expect.objectContaining({ type: "report", name: "Văn bản" })
  );
});

test("updateItem_persists_report_citations_in_selected", () => {
  useAnalysisStore.setState({
    items: [
      {
        id: "i1",
        type: "report",
        selected: { document_ids: ["d1"], template_id: "speech_draft" },
      },
    ],
    selectedInfo: null,
  });

  const citations = [
    { marker: 1, doc_id: "d1", doc_name: "Doc A", page: 1, quote: "hello" },
  ];
  useAnalysisStore.getState().updateItem("i1", {
    content: "# Report",
    status: "COMPLETED",
    selected: {
      document_ids: ["d1"],
      template_id: "speech_draft",
      citations,
    },
  });

  const item = useAnalysisStore.getState().items[0];
  expect(item.selected.citations).toEqual(citations);
  expect(item.content).toBe("# Report");
});

describe("generate directive_review", () => {
  test("test_generate_directive_review_submits_formdata_and_registers_polling", async () => {
    const draftFile = new File(["pk"], "du-thao.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    submitDirectiveReview.mockResolvedValue({ task_id: "dr-1" });
    addConversationInfo.mockResolvedValue({
      info: { id: "i9", type: "directive_review", date_created: "2026-07-13" },
    });

    const info = await useAnalysisStore.getState().generate("directive_review", {
      userId: 1,
      conversationId: 7,
      documentIds: ["ref1", "ref2"],
      draftFile,
    });

    // Submitted as multipart FormData, not JSON.
    const [body] = submitDirectiveReview.mock.calls[0];
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("file")).toBe(draftFile);
    expect(JSON.parse(body.get("payload"))).toEqual({
      reference_document_ids: ["ref1", "ref2"],
      options: {},
    });

    // Persisted with the reference ids and the draft's name (not the file).
    const [, , record] = addConversationInfo.mock.calls[0];
    expect(record.type).toBe("directive_review");
    expect(record.selected).toEqual({
      reference_document_ids: ["ref1", "ref2"],
      draft_filename: "du-thao.docx",
    });

    expect(useAnalysisStore.getState().pollingTasks.i9).toEqual(
      expect.objectContaining({ taskId: "dr-1", type: "directive_review" })
    );
    expect(info.id).toBe("i9");
  });

  test("test_generate_directive_review_drops_placeholder_on_failure", async () => {
    submitDirectiveReview.mockRejectedValue(new Error("boom"));

    await expect(
      useAnalysisStore.getState().generate("directive_review", {
        userId: 1,
        conversationId: 7,
        documentIds: ["ref1"],
        draftFile: new File(["pk"], "d.docx"),
      })
    ).rejects.toThrow("boom");

    expect(useAnalysisStore.getState().pending).toHaveLength(0);
  });
});
