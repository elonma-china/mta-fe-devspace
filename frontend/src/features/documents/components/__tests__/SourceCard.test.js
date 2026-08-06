// src/features/documents/components/__tests__/SourceCard.test.js
// Story 131: the citation preview card maps document_id → document NAME, shows
// the page, renders enriched_content, and (when given onOpen) offers a "Mở tài
// liệu" action. ReactMarkdown + remark/rehype plugins are ESM — mock them so the
// card's own logic renders under jest.
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

jest.mock("react-markdown", () => (props) => <div>{props.children}</div>);
jest.mock("remark-gfm", () => ({ __esModule: true, default: () => {} }));
jest.mock("rehype-highlight", () => ({ __esModule: true, default: () => {} }));
jest.mock("stores/useDocumentStore", () => (selector) =>
  selector({
    documents: [{ id: "c6e2412a", name: "Tải Xuống.pdf" }],
  })
);

// eslint-disable-next-line import/first
import SourceCard from "../SourceCard";

const src = {
  document_id: "c6e2412a",
  metadata: { page_number: 1 },
  enriched_content:
    "Các quan điểm chỉ đạo của trung ương về đột phá quan trọng hàng đầu.",
};

test("sourceCard_mapsDocumentNamePageAndContent", () => {
  render(
    <SourceCard
      srcPopup={{ x: 0, y: 0 }}
      srcIdx={0}
      closeSourceCard={() => {}}
      src={src}
    />
  );
  expect(screen.getByText(/Tải Xuống\.pdf/)).toBeInTheDocument();
  expect(screen.getByText(/Trang 1/)).toBeInTheDocument();
  expect(
    screen.getByText(/Các quan điểm chỉ đạo/)
  ).toBeInTheDocument();
});

test("sourceCard_openButton_callsOnOpen", () => {
  const onOpen = jest.fn();
  render(
    <SourceCard
      srcPopup={{ x: 0, y: 0 }}
      srcIdx={0}
      closeSourceCard={() => {}}
      src={src}
      onOpen={onOpen}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: /mở tài liệu/i }));
  expect(onOpen).toHaveBeenCalledTimes(1);
});

test("sourceCard_noOnOpen_hidesOpenButton", () => {
  render(
    <SourceCard
      srcPopup={{ x: 0, y: 0 }}
      srcIdx={0}
      closeSourceCard={() => {}}
      src={src}
    />
  );
  expect(
    screen.queryByRole("button", { name: /mở tài liệu/i })
  ).not.toBeInTheDocument();
});

// ── Story 139: the card must stay inside the viewport ────────────────────────
// A citation chip in the right-hand "Bảng thông tin" column sits close to the
// right edge, so placing the card at `clientX + 8` pushed it off screen and the
// content was unreadable. The old code only corrected that below 768px.

const CARD_W = 360; // .ci-src-card max-width (jsdom reports 0 → same fallback)
const CARD_H = 300; // .ci-src-card max-height

const setViewport = (w, h) => {
  window.innerWidth = w;
  window.innerHeight = h;
};

test("sourceCard_anchorNearRightEdge_desktop_staysInsideViewport", () => {
  setViewport(1920, 1080);
  render(
    <SourceCard
      srcPopup={{ x: 1890, y: 400 }}
      srcIdx={0}
      closeSourceCard={() => {}}
      src={src}
    />
  );
  const card = screen.getByRole("dialog");
  const left = parseFloat(card.style.left);
  // Flipped to the left of the cursor instead of running past 1920.
  expect(left).toBe(1890 - 8 - CARD_W);
  expect(left + CARD_W).toBeLessThanOrEqual(1920 - 8);
});

test("sourceCard_anchorNearTopEdge_doesNotGoNegative", () => {
  // Not enough room below (short viewport) AND flipping above would be negative.
  setViewport(1280, 320);
  render(
    <SourceCard
      srcPopup={{ x: 200, y: 260 }}
      srcIdx={0}
      closeSourceCard={() => {}}
      src={src}
    />
  );
  const card = screen.getByRole("dialog");
  const top = parseFloat(card.style.top);
  // Old behaviour: 260 - 8 - 300 = -48, i.e. clipped by the top of the screen.
  // Now it is pinned inside the margins instead (320 - 8 - 300).
  expect(top).toBeGreaterThanOrEqual(0);
  expect(top).toBe(12);
  expect(top + CARD_H).toBeLessThanOrEqual(320 - 8);
});

test("sourceCard_windowResizeWhileOpen_repositionsInsideViewport", () => {
  setViewport(1920, 1080);
  render(
    <SourceCard
      srcPopup={{ x: 1200, y: 400 }}
      srcIdx={0}
      closeSourceCard={() => {}}
      src={src}
    />
  );
  const card = screen.getByRole("dialog");
  expect(parseFloat(card.style.left)).toBe(1208);

  // Shrinking the window used to leave the card stranded outside it.
  setViewport(1300, 1080);
  fireEvent(window, new Event("resize"));
  const left = parseFloat(card.style.left);
  expect(left + CARD_W).toBeLessThanOrEqual(1300 - 8);
  expect(parseFloat(card.style.top) + CARD_H).toBeLessThanOrEqual(1080 - 8);
});
