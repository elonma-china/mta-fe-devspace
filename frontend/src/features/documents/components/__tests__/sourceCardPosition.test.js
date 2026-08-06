// src/features/documents/components/__tests__/sourceCardPosition.test.js
//
// Story 139: the citation preview card is placed at the cursor, so a chip near a
// screen edge used to push it out of view. The old code only corrected the
// horizontal overflow when the WINDOW was ≤768px wide — on a desktop the card
// simply ran off the right edge, which is what every citation in the right-hand
// "Bảng thông tin" column did. `clampCardPosition` is the pure geometry that
// keeps the card fully inside the viewport at ANY width (jsdom has no layout, so
// the rules live in a pure function that unit-tests without a DOM — ADR-008).
import { clampCardPosition } from "../sourceCardPosition";

// A roomy desktop viewport and a typical card.
const VW = 1920;
const VH = 1080;
const CARD = { cardWidth: 360, cardHeight: 300 };
const M = 8;

const at = (anchorX, anchorY, extra = {}) =>
  clampCardPosition({
    anchorX,
    anchorY,
    viewportWidth: VW,
    viewportHeight: VH,
    margin: M,
    ...CARD,
    ...extra,
  });

test("clampCardPosition_roomOnAllSides_keepsCardBelowRightOfCursor", () => {
  expect(at(600, 400)).toEqual({ left: 608, top: 408 });
});

test("clampCardPosition_nearRightEdge_flipsToLeftOfCursor", () => {
  // 1890 + 8 + 360 would end at 2258 — far past the 1920 viewport.
  const { left } = at(1890, 400);
  expect(left).toBe(1890 - M - 360); // 1522
  expect(left + 360).toBeLessThanOrEqual(VW - M);
});

test("clampCardPosition_narrowViewport_flipWouldGoNegative_pinsInsideMargins", () => {
  // Viewport barely wider than the card: there is no room after the cursor AND
  // flipping before it would land at -68, so the card is pinned inside instead.
  const { left } = at(300, 400, { viewportWidth: 400 });
  expect(left).toBe(400 - M - 360); // 32 — flush against the right margin
  expect(left).toBeGreaterThanOrEqual(M);
  expect(left + 360).toBeLessThanOrEqual(400 - M);
});

test("clampCardPosition_nearBottomEdge_flipsAboveCursor", () => {
  const { top } = at(600, 1000);
  expect(top).toBe(1000 - M - 300); // 692
  expect(top + 300).toBeLessThanOrEqual(VH - M);
});

test("clampCardPosition_nearTopAndBottom_flipUpWouldGoNegative_clampsToTopMargin", () => {
  // A short viewport: below doesn't fit, and flipping above goes negative.
  const { top } = at(600, 250, { viewportHeight: 300 });
  expect(top).toBe(M);
});

test("clampCardPosition_cardLargerThanViewport_pinsToMarginsNotNegative", () => {
  const pos = clampCardPosition({
    anchorX: 200,
    anchorY: 200,
    cardWidth: 900,
    cardHeight: 800,
    viewportWidth: 400,
    viewportHeight: 300,
    margin: M,
  });
  expect(pos.left).toBe(M);
  expect(pos.top).toBe(M);
});

test("clampCardPosition_missingOrInvalidInput_returnsMarginFallback_noThrow", () => {
  expect(() => clampCardPosition()).not.toThrow();
  expect(clampCardPosition()).toEqual({ left: M, top: M });
  expect(
    clampCardPosition({
      anchorX: NaN,
      anchorY: undefined,
      viewportWidth: VW,
      viewportHeight: VH,
      ...CARD,
    })
  ).toEqual({ left: M, top: M });
});
