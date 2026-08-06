// src/features/analysis/components/DetachableMindmap.js
import React, { useEffect, useRef } from "react";
import { Markmap } from "markmap-view";
import { Transformer } from "markmap-lib";
import { Toolbar } from "markmap-toolbar";
import "markmap-toolbar/dist/style.css";
import "./DetachableMindmap.css";
import { ReactComponent as CloseIcon } from "assets/images/close.svg";

const transformer = new Transformer();

/**
 * DetachableMindmap
 * - Inline (shrinked) and modal (expanded) view
 * - Uses official Markmap Toolbar (full)
 */
export default function DetachableMindmap({
  markdown = "# (trống)\n- ví dụ\n  - node con",
  title = "Mindmap",
  expanded = false,
  onClose,
  compactHeight = 540,
  onNodeClick,
}) {
  const inlineSlotRef = useRef(null);
  const modalSlotRef = useRef(null);
  const hostRef = useRef(null);
  const svgRef = useRef(null);
  const barRef = useRef(null);

  const mmRef = useRef(null);
  const roRef = useRef(null);
  const teardownRef = useRef(() => { });

  const expandedRef = useRef(expanded);
  const onCloseRef = useRef(onClose);

  useEffect(() => { expandedRef.current = expanded; }, [expanded]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // Build host, svg, toolbar container once
  if (!hostRef.current) {
    const host = document.createElement("div");
    host.className = "mm-host";

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("mm-canvas");
    host.appendChild(svg);

    const bar = document.createElement("div");
    bar.className = "mm-toolbar";
    host.appendChild(bar);

    hostRef.current = host;
    svgRef.current = svg;
    barRef.current = bar;
  }

  // Initialize Markmap + Toolbar once
  useEffect(() => {
    if (!svgRef.current || mmRef.current) return;
    const mm = Markmap.create(svgRef.current, {
      initialExpandLevel: 0
    });
    mmRef.current = mm;

    // attach full toolbar
    renderToolbar(mm, barRef.current);

    // Delegated click handler for node text
    const LABEL_SEL = "g.markmap-node > foreignObject div div";
    const readNodeText = (el) => {
      const gNode =
        el?.closest?.("g.markmap-node") ||
        (el?.tagName?.toLowerCase() === "g" ? el : null);
      if (!gNode) return "";
      return gNode.querySelector("foreignObject div div")?.textContent?.trim() || "";
    };

    const handleClick = (e) => {
      const label = e.target.closest?.(LABEL_SEL);
      if (!label || !svgRef.current.contains(label)) return;
      e.stopPropagation();
      // e.preventDefault();

      const g = label.closest("g.markmap-node");
      const current = readNodeText(label);

      const path = g?.getAttribute("data-path") || "";
      const parts = path.split(".").filter(Boolean);
      parts.pop();
      const parentPath = parts.join(".");
      let parent = "";
      if (parentPath) {
        const parentNode = svgRef.current.querySelector(
          `g.markmap-node[data-path="${parentPath}"]`
        );
        parent = readNodeText(parentNode);
      } else parent = "(root)";

      // Defer to next tick so d3-zoom finishes its internal processing
      if (onNodeClick) setTimeout(() => onNodeClick({ current, parent, gNode: g }), 0);
      else setTimeout(() => alert(`parent: ${parent}, child: ${current}`), 0);

      if (expandedRef.current && typeof onCloseRef.current === "function") setTimeout(() => { try { onCloseRef.current(); } catch { } }, 0);
    };

    svgRef.current.addEventListener("click", handleClick);

    // Auto-fit on resize
    if ("ResizeObserver" in window) {
      roRef.current = new ResizeObserver(() => {
        requestAnimationFrame(() => mmRef.current?.fit());
      });
      roRef.current.observe(svgRef.current.parentElement);
    }

    teardownRef.current = () => {
      try { svgRef.current?.removeEventListener("click", handleClick); } catch { }
      try { roRef.current?.disconnect(); } catch { }
    };

    return () => {
      teardownRef.current?.();
      mmRef.current = null;
    };
  }, [onNodeClick]);

  // Update when markdown changes
  useEffect(() => {
    if (!mmRef.current) return;
    const { root, features } = transformer.transform(markdown || "# (trống)");
    if (features?.length) transformer.initialize(mmRef.current, { features });
    mmRef.current.setData(root).then(() => mmRef.current?.fit());
  }, [markdown]);

  // Move host (inline ↔ modal)
  useEffect(() => {
    const target = expanded ? modalSlotRef.current : inlineSlotRef.current;
    if (!target || !hostRef.current) return;
    if (hostRef.current.parentElement !== target) {
      target.appendChild(hostRef.current);
      requestAnimationFrame(() => mmRef.current?.fit());
    }
  }, [expanded]);

  return (
    <>
      {/* Inline (shrinked) */}
      <div className="mm-inline-wrapper" style={{ height: compactHeight }}>
        <div className="mm-inline-top" />
        <div className="mm-inline-canvas-slot" ref={inlineSlotRef} />
      </div>

      {/* Modal (expanded) */}
      {expanded && (
        <div className="mm-modal" role="dialog" aria-modal="true">
          <div className="mm-backdrop" onClick={onClose} />
          <div className="mm-card">
            <div className="mm-topbar">
              <div className="mm-title">{title}</div>
              <button className="mm-close" onClick={onClose} aria-label="Đóng">
                <CloseIcon />
              </button>
            </div>
            <div className="mm-view-only">
              <div className="mm-modal-canvas-slot" ref={modalSlotRef} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- helpers ---------- */
function renderToolbar(mm, wrapper) {
  if (!mm || !wrapper) return;
  while (wrapper.firstChild) wrapper.firstChild.remove();
  const toolbar = new Toolbar();
  toolbar.attach(mm);
  toolbar.setItems(["zoomIn", "zoomOut"]); // full toolbar
  wrapper.append(toolbar.render());
}
