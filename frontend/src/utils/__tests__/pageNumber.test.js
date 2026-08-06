import { resolvePageNumber } from "utils/pageNumber";

test("pageNumber_resolvePageNumber_usesPageNumberKey", () => {
  expect(resolvePageNumber({ page_number: 3 })).toBe(3);
});

test("pageNumber_resolvePageNumber_fallsBackToLegacyPageKey", () => {
  expect(resolvePageNumber({ page: 7 })).toBe(7);
});

test("pageNumber_resolvePageNumber_legacyPageListTakesFirstEntry", () => {
  expect(resolvePageNumber({ page: [4, 5] })).toBe(4);
});

test("pageNumber_resolvePageNumber_fallsBackToOriginalPageNumberKey", () => {
  expect(resolvePageNumber({ original_page_number: 5 })).toBe(5);
});

test("pageNumber_resolvePageNumber_keepsPageZero", () => {
  expect(resolvePageNumber({ page_number: 0 })).toBe(0);
});

test("pageNumber_resolvePageNumber_returnsUndefinedWhenAbsent", () => {
  expect(resolvePageNumber({})).toBeUndefined();
  expect(resolvePageNumber(null)).toBeUndefined();
});
