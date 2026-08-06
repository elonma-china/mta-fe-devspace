// src/features/documents/components/sourceCardPosition.js
//
// Story 139: pure placement geometry for the citation preview card (SourceCard).
// Kept framework/DOM-free so it unit-tests under jsdom, which has no layout
// (ADR-008 — same reason viewerUtils holds the viewer's geometry helpers).

/** Fallback gap between the cursor/anchor, the card, and the viewport edges. */
export const CARD_MARGIN = 8;

/**
 * Clamp a number into [min, max]; when the range is inverted (the card is
 * larger than the space) `min` wins, so the result is never negative.
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Place a floating card near an anchor point WITHOUT letting it leave the
 * viewport.
 *
 * Per axis the card is placed after the anchor (right of / below it, offset by
 * `margin`). When it would overflow, it flips to the other side of the anchor;
 * when the flip would overflow too — a viewport barely wider/taller than the
 * card — it is pinned inside the margins. This runs at EVERY viewport width:
 * the previous logic only corrected horizontal overflow below 768px, so on a
 * desktop a citation chip in the right-hand column pushed the card off screen.
 *
 * Keeping the card offset from the anchor on the vertical axis also keeps the
 * clicked chip itself visible.
 *
 * @param {object} [args]
 * @param {number} [args.anchorX]        cursor/chip x in viewport coordinates
 * @param {number} [args.anchorY]        cursor/chip y in viewport coordinates
 * @param {number} [args.cardWidth]      measured (or estimated) card width
 * @param {number} [args.cardHeight]     measured (or estimated) card height
 * @param {number} [args.viewportWidth]
 * @param {number} [args.viewportHeight]
 * @param {number} [args.margin=CARD_MARGIN]
 * @returns {{left: number, top: number}} viewport-fixed coordinates
 */
export function clampCardPosition({
  anchorX,
  anchorY,
  cardWidth,
  cardHeight,
  viewportWidth,
  viewportHeight,
  margin = CARD_MARGIN,
} = {}) {
  const m = Number.isFinite(margin) ? margin : CARD_MARGIN;
  // A missing/NaN anchor or viewport means we cannot reason about the position
  // (server render, an event without coordinates) — park the card in the corner
  // rather than emitting NaN styles.
  if (!Number.isFinite(anchorX) || !Number.isFinite(anchorY)) {
    return { left: m, top: m };
  }
  const vw = Number.isFinite(viewportWidth) ? viewportWidth : 0;
  const vh = Number.isFinite(viewportHeight) ? viewportHeight : 0;
  const w = Number.isFinite(cardWidth) ? cardWidth : 0;
  const h = Number.isFinite(cardHeight) ? cardHeight : 0;

  const place = (anchor, size, viewport) => {
    const maxStart = viewport - m - size; // last position that still fits
    const after = anchor + m;
    if (after <= maxStart) return after;
    const before = anchor - m - size;
    if (before >= m) return before;
    return clamp(after, m, maxStart);
  };

  return {
    left: place(anchorX, w, vw),
    top: place(anchorY, h, vh),
  };
}
