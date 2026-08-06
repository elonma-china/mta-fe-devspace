import { mapQuoteToItemRanges } from "../viewerUtils";

const item = (str, hasEOL = false) => ({ str, hasEOL });

describe("mapQuoteToItemRanges", () => {
  test("quote inside a single item returns local range for that item", () => {
    const items = [item("Điều 1. Phạm vi điều chỉnh"), item("Điều 2. Đối tượng")];
    const m = mapQuoteToItemRanges(items, "Phạm vi điều chỉnh");
    expect(m).not.toBeNull();
    expect([...m.keys()]).toEqual([0]);
    expect(m.get(0)).toEqual({ start: 8, end: 26 });
  });

  test("quote spanning items returns clamped local ranges per item", () => {
    // "quy định về " + "trách nhiệm" — quote crosses the boundary
    const items = [item("Nghị định này quy định về "), item("trách nhiệm của cơ quan")];
    const m = mapQuoteToItemRanges(items, "quy định về trách nhiệm");
    expect([...m.keys()]).toEqual([0, 1]);
    expect(m.get(0)).toEqual({ start: 14, end: 26 }); // "quy định về "
    expect(m.get(1)).toEqual({ start: 0, end: 11 }); // "trách nhiệm"
  });

  test("hasEOL line break separates items so cross-line quotes still match", () => {
    // Without the inserted "\n", "cuối dòng" + "Đầu dòng" would concatenate
    // into "dòngĐầu" and the whitespace-normalized quote would miss.
    const items = [item("nội dung cuối dòng", true), item("Đầu dòng sau")];
    const m = mapQuoteToItemRanges(items, "cuối dòng Đầu dòng");
    expect([...m.keys()]).toEqual([0, 1]);
  });

  test("whitespace differences between quote and items are tolerated", () => {
    const items = [item("khoản  2   Điều 5")];
    const m = mapQuoteToItemRanges(items, "khoản 2 Điều 5");
    expect(m.get(0)).toEqual({ start: 0, end: 17 });
  });

  test("no match returns null", () => {
    expect(mapQuoteToItemRanges([item("abc")], "xyz")).toBeNull();
  });

  test("empty/absent items return null", () => {
    expect(mapQuoteToItemRanges([], "abc")).toBeNull();
    expect(mapQuoteToItemRanges(null, "abc")).toBeNull();
    expect(mapQuoteToItemRanges([{ notStr: 1 }], "abc")).toBeNull();
  });
});
