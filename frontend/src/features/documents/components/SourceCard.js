// src/features/documents/components/SourceCard.js
import React, { useLayoutEffect, useRef, useState } from "react";
import "./SourceCard.css";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";
import useDocumentStore from "stores/useDocumentStore";
import { resolvePageNumber } from "utils/pageNumber";
import { clampCardPosition, CARD_MARGIN } from "./sourceCardPosition";

// Story 139: used until the card has been measured, and in environments with no
// layout (jsdom reports 0). Must mirror `.ci-src-card`'s max-width/max-height.
const FALLBACK_CARD_WIDTH = 360;
const FALLBACK_CARD_HEIGHT = 300;

export default function SourceCard({
  srcPopup,
  srcIdx,
  closeSourceCard,
  src,
  onOpen,
  onMouseEnter,
  onMouseLeave,
}) {
  const documents = useDocumentStore((s) => s.documents);

  // Resolve document_id → display name from the document store
  const docId = src?.document_id || "";
  const matchedDoc = docId
    ? documents.find((d) => String(d.id) === String(docId))
    : null;
  const rawName = matchedDoc?.name || docId || "";
  const displayName = rawName.replace(/^[^_]+_/, "");
  const pageNo = resolvePageNumber(src?.metadata);

  // --- Positioning (story 139) ---
  // The card is anchored at the click/hover point, so a citation near a screen
  // edge used to push it out of view — most of all in the right-hand "Bảng
  // thông tin" column, where every chip sits close to the right edge. The old
  // code corrected the horizontal overflow ONLY below 768px, so on a desktop
  // the card was simply clipped. `clampCardPosition` now keeps it inside the
  // viewport on both axes at every width, using the card's REAL size (the old
  // flip-up used a hardcoded height and could land on a negative `top`).
  const cardRef = useRef(null);
  const anchorX = srcPopup?.x;
  const anchorY = srcPopup?.y;
  const [placement, setPlacement] = useState(null);

  // Measure the rendered card, then clamp. `useLayoutEffect` runs before paint,
  // so the corrected position is what the user actually sees. The same handler
  // is bound to `resize`: shrinking the window used to strand an open card
  // outside it. Falls back to the CSS caps where there is no layout (jsdom).
  useLayoutEffect(() => {
    const measureAndPlace = () => {
      const rect = cardRef.current?.getBoundingClientRect();
      setPlacement(
        clampCardPosition({
          anchorX,
          anchorY,
          cardWidth: rect?.width || FALLBACK_CARD_WIDTH,
          cardHeight: rect?.height || FALLBACK_CARD_HEIGHT,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          margin: CARD_MARGIN,
        })
      );
    };
    measureAndPlace();
    window.addEventListener("resize", measureAndPlace);
    return () => window.removeEventListener("resize", measureAndPlace);
  }, [anchorX, anchorY]);

  // First render (before the measurement) already uses the clamped estimate, so
  // the card never flashes outside the viewport.
  const { left, top } =
    placement ||
    clampCardPosition({
      anchorX,
      anchorY,
      cardWidth: FALLBACK_CARD_WIDTH,
      cardHeight: FALLBACK_CARD_HEIGHT,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      margin: CARD_MARGIN,
    });

  return (
    <div
      className="ci-src-card"
      ref={cardRef}
      style={{
        position: "fixed",
        left,
        top,
        maxHeight: FALLBACK_CARD_HEIGHT,
        overflowY: "auto",
      }}
      role="dialog"
      aria-label={displayName || `Nguồn #${(srcIdx ?? 0) + 1}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="ci-src-card-head">
        <span className="ci-src-card-title" title={rawName || undefined}>
          {displayName || `Nguồn ${(srcIdx ?? 0) + 1}`}
          {Number.isFinite(pageNo) ? (
            <small style={{ marginLeft: 8, opacity: 0.8 }}>(Trang {pageNo})</small>
          ) : null}
        </span>
        <button
          className="ci-src-card-close"
          onClick={closeSourceCard}
          aria-label="Đóng"
        >
          ×
        </button>
      </div>
      <div className="ci-src-card-body markdown-body">
        {typeof src?.enriched_content === "string" && src.enriched_content.trim() ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
            {src.enriched_content}
          </ReactMarkdown>
        ) : (
          <em>(Không có nội dung nguồn)</em>
        )}
      </div>
      {onOpen ? (
        <div className="ci-src-card-foot">
          <button
            type="button"
            className="ci-src-card-open"
            onClick={onOpen}
          >
            Mở tài liệu →
          </button>
        </div>
      ) : null}
    </div>
  );
}