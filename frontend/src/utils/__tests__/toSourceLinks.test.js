import { toSourceLinks } from "utils/helpers";

// Conversation 72 message 2: the answer was grounded and its ids were right, but
// the model wrote bare `[1]`/`[2]`/`[4]` instead of `[Nguồn N]` — it had picked up
// the bracket style of the reference-dense paper it was answering from. The old
// regex only rewrote brackets containing the word "Nguồn", so those markers
// rendered as plain text: no chip, no click-through to the source.
//
// The AI service now normalizes new answers server-side, but every answer already
// stored in Mongo still carries the raw markers, so the renderer has to cope too.
// `sourceCount` is the guard: a bare bracket is a citation only if it addresses a
// source that exists — which is what separates the answer's own `[1]` from the
// paper's `[64]`.
describe("toSourceLinks", () => {
  test("rewrites the canonical marker", () => {
    expect(toSourceLinks("Gated MLA [Nguồn 1].", 4)).toBe("Gated MLA [1](#source-1).");
  });

  test("rewrites bare markers when they address a real source", () => {
    expect(toSourceLinks("Gated MLA [1].", 4)).toBe("Gated MLA [1](#source-1).");
  });

  test("rewrites a run of adjacent bare markers", () => {
    expect(toSourceLinks("tỷ lệ 3:1 [1][2].", 4)).toBe(
      "tỷ lệ 3:1 [1](#source-1)[2](#source-2).",
    );
  });

  test("rewrites a bare marker at the start of the text", () => {
    expect(toSourceLinks("[3] mở đầu.", 4)).toBe("[3](#source-3) mở đầu.");
  });

  test("rewrites the English label", () => {
    expect(toSourceLinks("The block mixes 3 KDA layers [Source 2].", 4)).toBe(
      "The block mixes 3 KDA layers [2](#source-2).",
    );
  });

  test("leaves the source paper's own references alone", () => {
    const text = "KDA extends the delta-rule recurrence [106] with a forget gate [64].";
    expect(toSourceLinks(text, 4)).toBe(text);
  });

  test("leaves a run alone when any of its ids is out of range", () => {
    expect(toSourceLinks("abc [1][64].", 4)).toBe("abc [1][64].");
  });

  test("leaves [0] alone — sources are numbered from 1", () => {
    expect(toSourceLinks("arr index [0].", 4)).toBe("arr index [0].");
  });

  test("leaves an array index alone", () => {
    expect(toSourceLinks("dùng arr[1] để lấy phần tử.", 4)).toBe(
      "dùng arr[1] để lấy phần tử.",
    );
  });

  test("does not re-wrap a marker it already rewrote", () => {
    expect(toSourceLinks("xem [1](#source-1) nhé.", 4)).toBe("xem [1](#source-1) nhé.");
  });

  test("leaves a reference-style link definition alone", () => {
    expect(toSourceLinks("[1]: https://example.com", 4)).toBe("[1]: https://example.com");
  });

  test("without a source count, bare markers are left as text", () => {
    // An unknown bound cannot tell a citation from a footnote — stay conservative.
    expect(toSourceLinks("Gated MLA [1].")).toBe("Gated MLA [1].");
    expect(toSourceLinks("Gated MLA [Nguồn 1].")).toBe("Gated MLA [1](#source-1).");
  });

  test("handles empty and non-string input", () => {
    expect(toSourceLinks("", 4)).toBe("");
    expect(toSourceLinks(null, 4)).toBe("");
    expect(toSourceLinks(undefined, 4)).toBe("");
  });

  test("still splits a comma-grouped labelled marker", () => {
    expect(toSourceLinks("abc [Nguồn 1, 3].", 4)).toBe(
      "abc [1](#source-1), [3](#source-3).",
    );
  });

  test("rewrites the whole conversation-72 paragraph", () => {
    const answer =
      "Hybrid Attention bao gồm KDA và Gated MLA [1]. KDA áp dụng channel-wise " +
      "decay [1] với gmin = -5 [4]. Mỗi khối chứa 3 lớp KDA và 1 lớp Gated MLA [1][2].";
    const out = toSourceLinks(answer, 4);
    expect(out).toContain("[4](#source-4)");
    expect(out).toContain("[1](#source-1)[2](#source-2)");
    expect(out.match(/#source-1/g)).toHaveLength(3);
  });
});
