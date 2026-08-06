// src/features/analysis/__tests__/directiveCitations.test.js
import {
  flattenDirectiveCitations,
  directiveCitationsFromItem,
  toDirectiveCitationLinks,
  DR_CITATION_PREFIX,
} from "../utils/directiveCitations";

const cite = (marker, over = {}) => ({
  marker,
  doc_id: `doc-${marker}`,
  doc_name: `TT-${marker}.pdf`,
  page: marker + 1,
  chunk_id: `chunk-${marker}`,
  chunk_index: 0,
  quote: `trích dẫn ${marker}`,
  ...over,
});

describe("flattenDirectiveCitations", () => {
  test("test_flattens_dedupes_by_marker_and_sorts", () => {
    const verdicts = [
      { citations: [cite(3), cite(1)] },
      { citations: [cite(1, { quote: "DUPLICATE — must not replace first" })] },
      { citations: [] },
      {},
    ];
    const flat = flattenDirectiveCitations(verdicts);
    expect(flat.map((c) => c.marker)).toEqual([1, 3]);
    expect(flat[0].quote).toBe("trích dẫn 1"); // first occurrence wins
    // Only the fields the FE persists — no chunk noise.
    expect(Object.keys(flat[0]).sort()).toEqual(
      ["doc_id", "doc_name", "marker", "page", "quote"].sort()
    );
  });

  test("test_empty_input_gives_empty_array", () => {
    expect(flattenDirectiveCitations([])).toEqual([]);
    expect(flattenDirectiveCitations(undefined)).toEqual([]);
  });
});

describe("directiveCitationsFromItem", () => {
  test("test_builds_marker_map", () => {
    const item = { selected: { citations: [cite(2), cite(5)] } };
    const map = directiveCitationsFromItem(item);
    expect(map.get(2).doc_id).toBe("doc-2");
    expect(map.get(5).page).toBe(6);
    expect(map.size).toBe(2);
  });

  test("test_absent_citations_gives_empty_map", () => {
    expect(directiveCitationsFromItem({ selected: {} }).size).toBe(0);
    expect(directiveCitationsFromItem(null).size).toBe(0);
  });
});

describe("toDirectiveCitationLinks", () => {
  const map = new Map([
    [1, cite(1)],
    [14, cite(14)],
  ]);

  test("test_rewrites_known_markers_only", () => {
    const md = "- Nguồn: [1] TT-1.pdf, tr.2\n\n[14] TT-14.pdf\n\n[99] unknown";
    const out = toDirectiveCitationLinks(md, map);
    expect(out).toContain(`[[1]](${DR_CITATION_PREFIX}1)`);
    expect(out).toContain(`[[14]](${DR_CITATION_PREFIX}14)`);
    expect(out).toContain("[99] unknown"); // untouched
    expect(out).not.toContain(`${DR_CITATION_PREFIX}99`);
  });

  test("test_does_not_touch_existing_links_or_double_apply", () => {
    const md = `xem [tài liệu](https://x.vn) và [[1]](${DR_CITATION_PREFIX}1)`;
    const out = toDirectiveCitationLinks(md, map);
    expect(out).toBe(md); // idempotent, existing links untouched
  });

  test("test_empty_map_returns_input", () => {
    const md = "[1] gì đó";
    expect(toDirectiveCitationLinks(md, new Map())).toBe(md);
  });
});
