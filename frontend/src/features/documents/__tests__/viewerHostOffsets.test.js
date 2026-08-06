// src/features/documents/__tests__/viewerHostOffsets.test.js
//
// What the viewer gets handed when a citation is clicked.
//
// `enriched_content` is the retrieval window — the chunk plus its neighbours,
// routinely 3× the chunk and often wider than the page. Highlighting it marked
// far more than the cited passage. The chunk's own `content` is the passage,
// and `char_start`/`char_end` say exactly where it sits, so both must reach the
// viewer. The window is still forwarded separately for the preview popover.

import { sourceViewerDoc } from "features/documents/components/viewer/viewerHost";

const DOCS = [{ id: "d1", name: "vanban.pdf" }];

test("sourceViewerDoc_sourceWithContentAndOffsets_passesBothToViewer", () => {
  const target = sourceViewerDoc(
    {
      document_id: "d1",
      content: "Điều 5. Nguyên tắc áp dụng.",
      enriched_content: "…trang trước… Điều 5. Nguyên tắc áp dụng. …trang sau…",
      char_start: 1200,
      char_end: 1227,
      metadata: { page_number: 3 },
    },
    DOCS,
    "câu trả lời"
  );

  // The chunk itself bounds the highlight, not the window around it.
  expect(target.highlight).toBe("Điều 5. Nguyên tắc áp dụng.");
  expect(target.charStart).toBe(1200);
  expect(target.charEnd).toBe(1227);
  expect(target.page).toBe(3);
});

test("sourceViewerDoc_sourceWithoutContent_fallsBackToEnrichedContent", () => {
  // Messages persisted before this change carry only the window.
  const target = sourceViewerDoc(
    {
      document_id: "d1",
      enriched_content: "toàn bộ cửa sổ ngữ cảnh",
      metadata: { page_number: 2 },
    },
    DOCS,
    "câu trả lời"
  );

  expect(target.highlight).toBe("toàn bộ cửa sổ ngữ cảnh");
  expect(target.charStart).toBeUndefined();
  expect(target.charEnd).toBeUndefined();
});

test("sourceViewerDoc_sourceWithOffsetsButNoPage_stillPassesOffsets", () => {
  const target = sourceViewerDoc(
    { document_id: "d1", content: "x", char_start: 5, char_end: 9, metadata: {} },
    DOCS,
    ""
  );
  expect(target.charStart).toBe(5);
  expect(target.charEnd).toBe(9);
  expect(target.page).toBeUndefined();
});

test("sourceViewerDoc_unknownDocument_stillReturnsNull", () => {
  expect(
    sourceViewerDoc(
      { document_id: "nope", content: "x", char_start: 1, char_end: 2 },
      DOCS,
      ""
    )
  ).toBeNull();
});
