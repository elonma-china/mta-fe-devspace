// src/features/documents/components/viewer/ResizeHandle.js
import React, { useCallback, useEffect, useRef, useState } from "react";
import "./ResizeHandle.css";
import { ratioFromPointer } from "./viewerUtils";

/**
 * ResizeHandle — draggable vertical divider between the document list and the
 * viewer (story 15). Hovering shows a col-resize cursor.
 *
 * Story 60 — commit-on-release + iframe shield (fixes the PDF preview drag
 * lag/stutter, the layout "shove", and the critical "stuck drag"):
 *  - While dragging, a transparent full-window OVERLAY sits ABOVE the content
 *    (incl. the PDF `<iframe>`). Without it, moving the cursor over the iframe
 *    routes mouse events to the iframe's own document, so the parent `window`
 *    listeners stop firing → the divider freezes/lags behind the cursor, and a
 *    mouseup over the iframe never ends the drag (col-resize cursor stuck, the
 *    panel keeps resizing without the button held). The overlay keeps every
 *    pointer event in the parent document. CSS also sets the iframe to
 *    `pointer-events:none` while dragging (belt-and-suspenders).
 *  - The viewer width is committed ONCE on release — not on every mousemove. A
 *    lightweight GHOST line follows the cursor during the drag; the real width
 *    applies on mouseup. This stops the browser PDF viewer from re-fitting
 *    (`zoom=page-width`) and the host from re-rendering on every tick — the two
 *    residual jank sources story 58 left open.
 *  - The drag ends on mouseup OR window blur (robust end → never stuck), and on
 *    unmount (e.g. the viewer closes mid-drag) the listeners + body class are
 *    always cleaned up.
 *
 * Public props are UNCHANGED — `onResize(ratio)` is still called with the
 * clamped list-pane fraction (just on release now) — so both hosts (Chat,
 * DocumentManagement) need no change.
 *
 * @param {object} props
 * @param {(ratio:number) => void} props.onResize  called ON RELEASE with the
 *   clamped list-pane ratio (story 60: commit-on-release, was per-mousemove).
 * @param {() => DOMRect} props.getContainerRect    container bounds provider
 */
export default function ResizeHandle({ onResize, getContainerRect }) {
  const draggingRef = useRef(false);
  // Last clamped list-pane ratio seen during the drag; committed on release.
  const lastRatioRef = useRef(null);
  // Active listener refs so we always removeEventListener the SAME function.
  const moveRef = useRef(null);
  const upRef = useRef(null);
  const blurRef = useRef(null);
  // Ghost-line left offset (viewport px) while dragging; null = not dragging
  // (also drives whether the shield overlay renders).
  const [ghostLeft, setGhostLeft] = useState(null);

  const cleanup = useCallback(() => {
    if (moveRef.current) window.removeEventListener("mousemove", moveRef.current);
    if (upRef.current) window.removeEventListener("mouseup", upRef.current);
    if (blurRef.current) window.removeEventListener("blur", blurRef.current);
    moveRef.current = null;
    upRef.current = null;
    blurRef.current = null;
    document.body.classList.remove("dv-resizing");
  }, []);

  const endDrag = useCallback(
    (commit) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      cleanup();
      setGhostLeft(null);
      // Commit the final width once (story 60: commit-on-release).
      if (commit && lastRatioRef.current != null) onResize(lastRatioRef.current);
      lastRatioRef.current = null;
    },
    [cleanup, onResize]
  );

  const start = useCallback(
    (e) => {
      e.preventDefault();
      if (draggingRef.current) return;
      draggingRef.current = true;
      lastRatioRef.current = null;
      document.body.classList.add("dv-resizing");

      const onMove = (ev) => {
        const rect = getContainerRect?.();
        if (!rect) return;
        const ratio = ratioFromPointer(ev.clientX, rect.left, rect.width);
        lastRatioRef.current = ratio;
        // Ghost previews the clamped landing spot (px within the container).
        setGhostLeft(rect.left + ratio * rect.width);
      };
      const onUp = () => endDrag(true);
      const onBlur = () => endDrag(true);

      moveRef.current = onMove;
      upRef.current = onUp;
      blurRef.current = onBlur;
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      window.addEventListener("blur", onBlur);

      // Seed the ghost + ratio from the mousedown position so the shield shows
      // immediately and a click-without-move commits the current boundary.
      onMove(e);
    },
    [getContainerRect, endDrag]
  );

  // Safety: if the handle unmounts mid-drag (e.g. the viewer closes), always
  // remove the listeners + the body class so nothing gets stuck.
  useEffect(() => () => {
    draggingRef.current = false;
    cleanup();
  }, [cleanup]);

  return (
    <>
      <div
        className="dv-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Kéo để co duỗi khung"
        onMouseDown={start}
      />
      {ghostLeft != null && (
        <div className="dv-resize-overlay" aria-hidden="true">
          <div className="dv-resize-ghost" style={{ left: `${ghostLeft}px` }} />
        </div>
      )}
    </>
  );
}
