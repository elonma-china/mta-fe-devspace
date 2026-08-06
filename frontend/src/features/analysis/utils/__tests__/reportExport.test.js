import {
  resolveTemplateId,
  selectedDocumentIds,
} from "../reportExport";

describe("selectedDocumentIds", () => {
  test("handles array shape", () => {
    expect(selectedDocumentIds(["a", "b"])).toEqual(["a", "b"]);
  });

  test("handles report object shape", () => {
    expect(selectedDocumentIds({ document_ids: ["x"], template_id: "speech_draft" })).toEqual(["x"]);
  });
});

describe("resolveTemplateId", () => {
  test("reads template_id from selected object", () => {
    expect(
      resolveTemplateId({
        name: "Sinh văn bản",
        selected: { document_ids: [], template_id: "opinion_consolidation" },
      })
    ).toBe("opinion_consolidation");
  });

  test("infers from report name label", () => {
    expect(resolveTemplateId({ name: "Sinh văn bản - Bài phát biểu" })).toBe("speech_draft");
  });
});
