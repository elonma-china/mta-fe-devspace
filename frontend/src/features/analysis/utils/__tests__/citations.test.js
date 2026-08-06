import {
  appendCitations,
  buildCitationsMarkdown,
  mergeReportSelected,
  reportCitationSources,
  stripUnsupportedMarkers,
  toReportCitationLinks,
} from "../citations";

const CITES = [
  { marker: 1, doc_id: "d1", doc_name: "Báo cáo A", page: 1, chunk_index: 0, quote: "kết quả tốt" },
  { marker: 2, doc_id: "d2", doc_name: "Hậu cần B", page: 2, chunk_index: 3, quote: null },
  { marker: 3, doc_id: "d3", doc_name: "Phối hợp C", page: null, chunk_index: 7 },
];

describe("buildCitationsMarkdown", () => {
  test("returns empty string for missing/empty citations", () => {
    expect(buildCitationsMarkdown(undefined)).toBe("");
    expect(buildCitationsMarkdown([])).toBe("");
  });

  test("renders heading, clickable markers, page and chunk fallback, and quote", () => {
    const md = buildCitationsMarkdown(CITES);
    expect(md).toContain("### Nguồn trích dẫn");
    expect(md).toContain("**[1](#report-source-1)** Báo cáo A — tr.1");
    expect(md).toContain('_"kết quả tốt"_');
    expect(md).toContain("**[2](#report-source-2)** Hậu cần B — tr.2");
    expect(md).toContain("**[3](#report-source-3)** Phối hợp C — đoạn 7");
  });

  test("falls back to doc_id when doc_name is absent", () => {
    expect(buildCitationsMarkdown([{ marker: 1, doc_id: "xyz", page: 1 }])).toContain(
      "**[1](#report-source-1)** xyz — tr.1"
    );
  });

  test("test_theme_hint_heads_the_source_when_present", () => {
    const md = buildCitationsMarkdown([
      { marker: 1, doc_name: "NĐ 58/2025", page: 12, quote: "Nhà nước có cơ chế ưu đãi.",
        theme_hint: "Ưu đãi vật liệu xanh" },
    ]);
    expect(md).toContain("**[1](#report-source-1)** NĐ 58/2025 — tr.12 — *Ưu đãi vật liệu xanh*");
  });

  test("test_long_quote_is_truncated_in_the_list", () => {
    // Real data: quotes run to 759 chars, 12-18 per report. Printing them in
    // full turned the sources list into a wall of raw digitised text.
    const long = "Người đang trong thời gian thi hành hình phạt tù. ".repeat(10);
    const md = buildCitationsMarkdown([{ marker: 1, doc_name: "TT 07", page: 3, quote: long }]);
    const shown = md.match(/_"([^"]*)"_/)[1];

    expect(shown.length).toBeLessThanOrEqual(140);
    expect(shown.endsWith("…")).toBe(true);
    expect(long.startsWith(shown.slice(0, 40))).toBe(true);
  });

  test("test_short_quote_is_left_whole_and_unsuffixed", () => {
    const md = buildCitationsMarkdown([
      { marker: 1, doc_name: "Báo cáo A", page: 1, quote: "kết quả tốt" },
    ]);
    expect(md).toContain('_"kết quả tốt"_');
  });
});

describe("stripUnsupportedMarkers", () => {
  test("test_legacy_persisted_reports_lose_the_marker", () => {
    // Reports generated before the backend stopped emitting it still carry
    // `[?]` in their stored content, and the UI does not accept it.
    const stored = "Đa số đơn vị đồng thuận. Kinh phí tăng 15%. [?] Đề nghị phê duyệt.";
    expect(stripUnsupportedMarkers(stored)).toBe(
      "Đa số đơn vị đồng thuận. Kinh phí tăng 15%. Đề nghị phê duyệt."
    );
  });

  test("test_real_citations_are_not_touched", () => {
    const md = "Nội dung [Báo cáo A, tr.1] và [2](#report-source-2).";
    expect(stripUnsupportedMarkers(md)).toBe(md);
  });

  test("test_handles_empty_input", () => {
    expect(stripUnsupportedMarkers("")).toBe("");
    expect(stripUnsupportedMarkers(undefined)).toBe("");
  });
});

describe("reportCitationSources", () => {
  test("test_source_card_keeps_the_full_quote_for_verification", () => {
    // The list is truncated for reading; the popup must stay verifiable.
    const long = "Nhà nước có cơ chế, chính sách khuyến khích, ưu đãi. ".repeat(10);
    const [src] = reportCitationSources({ selected: { citations: [{ marker: 1, quote: long }] } });
    expect(src.enriched_content).toBe(long);
  });
});

describe("appendCitations", () => {
  test("appends the sources block to existing markdown", () => {
    const out = appendCitations("# Báo cáo\n\nNội dung [Báo cáo A, tr.1].", CITES);
    expect(out).toContain("# Báo cáo");
    expect(out).toContain("### Nguồn trích dẫn");
    expect(out.indexOf("### Nguồn trích dẫn")).toBeGreaterThan(out.indexOf("Nội dung"));
  });

  test("is idempotent — does not double-append", () => {
    const once = appendCitations("# Báo cáo", CITES);
    const twice = appendCitations(once, CITES);
    expect(twice).toBe(once);
    expect(twice.match(/### Nguồn trích dẫn/g)).toHaveLength(1);
  });

  test("returns base unchanged when there are no citations", () => {
    expect(appendCitations("# Báo cáo", [])).toBe("# Báo cáo");
    expect(appendCitations("", undefined)).toBe("");
  });
});

describe("reportCitationSources", () => {
  test("maps synthesis citations into SourceCard-compatible objects", () => {
    const item = {
      selected: {
        document_ids: ["d1"],
        template_id: "speech_draft",
        citations: CITES,
      },
    };
    const sources = reportCitationSources(item);
    expect(sources).toHaveLength(3);
    expect(sources[0]).toEqual(
      expect.objectContaining({
        document_id: "d1",
        enriched_content: "kết quả tốt",
        metadata: { page_number: 1, chunk_index: 0 },
        marker: 1,
        doc_name: "Báo cáo A",
      })
    );
  });

  test("returns empty array when citations are not persisted", () => {
    expect(reportCitationSources({ selected: { document_ids: [] } })).toEqual([]);
    expect(reportCitationSources(null)).toEqual([]);
  });
});

describe("toReportCitationLinks", () => {
  test("rewrites inline page and chunk citations to report-source links", () => {
    const md = "Theo [Báo cáo A, tr.1] và [Phối hợp C, đoạn 7].";
    const out = toReportCitationLinks(md, CITES);
    expect(out).toContain("[Báo cáo A, tr.1](#report-source-1)");
    expect(out).toContain("[Phối hợp C, đoạn 7](#report-source-3)");
  });

  test("returns markdown unchanged when citations are missing", () => {
    expect(toReportCitationLinks("# Báo cáo", [])).toBe("# Báo cáo");
    expect(toReportCitationLinks("", undefined)).toBe("");
  });
});

describe("mergeReportSelected", () => {
  test("preserves document_ids and template_id while adding citations", () => {
    const merged = mergeReportSelected(
      { document_ids: ["d1", "d2"], template_id: "opinion_consolidation" },
      { citations: CITES }
    );
    expect(merged).toEqual({
      document_ids: ["d1", "d2"],
      template_id: "opinion_consolidation",
      citations: CITES,
    });
  });

  test("supports legacy array selected shape", () => {
    const merged = mergeReportSelected(["d1"], { citations: CITES });
    expect(merged.document_ids).toEqual(["d1"]);
    expect(merged.citations).toEqual(CITES);
  });
});
