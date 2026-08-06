// src/features/documents/components/viewer/PdfCitationView.js
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Document, Page } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";

import "./pdfjsWorker";
import "./PdfCitationView.css";
import { mapQuoteToItemRanges } from "./viewerUtils";

/**
 * PdfCitationView — PDF.js-rendered citation view (spec 2026-07-17).
 *
 * Used ONLY when a PDF opens with a citation quote (CitationCard flow); the
 * plain "File gốc" tab keeps the native iframe (story 57/58). Renders the
 * whole document as a virtualized page list, auto-scrolls to the cited page
 * once, and wraps the quote match in <mark class="fov-cite-highlight"> on
 * that page's text layer.
 *
 * @param {object}   props
 * @param {Blob}     props.blob              the PDF blob (already fetched)
 * @param {string}   [props.name]            display name (title/aria only)
 * @param {{page?: number|null, quote?: string}} [props.citation]
 * @param {(found: boolean) => void} [props.onHighlightResult]
 *   fired once per load: true → a visual mark landed (ribbon redundant),
 *   false → no match (caller keeps the ribbon).
 * @param {() => void} [props.onLoadError]   pdfjs failed → caller falls back
 *   to the native iframe.
 */
// A4 height/width; placeholder aspect until a page reports its real one.
const DEFAULT_ASPECT = 1.414;
// Pages within this margin of the viewport get (and keep) a real render.
const IO_MARGIN = "200% 0px";
// jsdom/test fallback width when the container reports 0.
const FALLBACK_WIDTH = 600;

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function PdfCitationView({ blob, name, citation, onHighlightResult, onLoadError }) {
  const containerRef = useRef(null);
  const pageElsRef = useRef(new Map()); // pageNumber -> wrapper element
  const scrolledRef = useRef(false);
  // Bug 4 (2026-07-31): true while the PROGRAMMATIC citation focus owns the
  // scroll (same convention as DocumentViewer's focusLockRef, story 138 / bug 3).
  // Released on the first real user gesture; while held, every layout change
  // re-applies the focus — see the re-align effect below.
  const focusLockRef = useRef(true);
  const ioRef = useRef(null);

  const [numPages, setNumPages] = useState(0);
  const [width, setWidth] = useState(0);
  const [aspects, setAspects] = useState({}); // pageNumber -> height/width
  const [visible, setVisible] = useState(() => new Set());
  const [ranges, setRanges] = useState(null); // Map<itemIndex,{start,end}>

  const quote = citation?.quote;
  const citedPage =
    citation?.page && citation.page > 0 ? citation.page : null;
  const ioSupported = typeof IntersectionObserver !== "undefined";

  // Fit-width (mirrors the iframe's zoom=page-width). ResizeObserver keeps
  // it in sync with the pane; jsdom (no RO, clientWidth 0) falls back.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const measure = () => setWidth(el.clientWidth || FALLBACK_WIDTH);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Locate the quote on the cited page as soon as the document loads.
  const handleLoadSuccess = useCallback(
    async (pdf) => {
      setNumPages(pdf.numPages);
      if (!quote || !citedPage || citedPage > pdf.numPages) {
        onHighlightResult?.(false);
        return;
      }
      try {
        const page = await pdf.getPage(citedPage);
        const tc = await page.getTextContent();
        const m = mapQuoteToItemRanges(tc.items, quote);
        setRanges(m);
        onHighlightResult?.(Boolean(m));
      } catch {
        onHighlightResult?.(false);
      }
    },
    [quote, citedPage, onHighlightResult]
  );

  // Virtualization: pages near the viewport render; the rest stay
  // placeholders. Without IO (jsdom) every page renders eagerly.
  useEffect(() => {
    if (!ioSupported || numPages === 0) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const n = Number(e.target.dataset.pcvPage);
            if (e.isIntersecting) next.add(n);
            else next.delete(n);
          }
          return next;
        });
      },
      { root: containerRef.current, rootMargin: IO_MARGIN }
    );
    ioRef.current = io;
    pageElsRef.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [ioSupported, numPages]);

  // One-shot jump to the cited page (scrolledRef pattern from
  // FileOriginalView; guarded — jsdom lacks scrollIntoView).
  useEffect(() => {
    if (numPages === 0 || scrolledRef.current) return;
    const target = citedPage && citedPage <= numPages ? citedPage : null;
    if (!target) {
      scrolledRef.current = true;
      return;
    }
    const el = pageElsRef.current.get(target);
    if (el) {
      scrolledRef.current = true;
      el.scrollIntoView?.({ block: "start" });
    }
  }, [numPages, citedPage]);

  // Bug 4: RE-apply the focus after layout shifts, for as long as the
  // programmatic focus still owns the scroll.
  //
  // The one-shot above fires while every page is still a placeholder whose
  // height is a GUESS (`DEFAULT_ASPECT`). Real pages then render and report
  // their true aspect (`onLoadSuccess` → setAspects), and the pane width can
  // settle late too — each correction above the cited page shifts the whole
  // column while the scroll position stays put. On a long document those
  // errors accumulate to entire screens, which is how a citation to a middle
  // page opened reading "the end of the document" in the CitationCard popup.
  //
  // `aspects`/`width` in the deps are exactly the signals that reflow the
  // column. The first real user gesture releases the lock (they have taken the
  // scroll over), after which reflows must never yank them around.
  useEffect(() => {
    if (!scrolledRef.current || !focusLockRef.current) return;
    const target = citedPage && citedPage <= numPages ? citedPage : null;
    if (!target) return;
    pageElsRef.current.get(target)?.scrollIntoView?.({ block: "start" });
  }, [aspects, width, numPages, citedPage]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const release = () => {
      focusLockRef.current = false;
    };
    const GESTURES = ["wheel", "touchstart", "mousedown", "keydown"];
    GESTURES.forEach((evt) =>
      el.addEventListener(evt, release, { passive: true })
    );
    return () =>
      GESTURES.forEach((evt) => el.removeEventListener(evt, release));
  }, []);

  // Wrap the matched slices of the cited page's text items in <mark>.
  // react-pdf treats the return value as HTML → everything must be escaped.
  const highlightRenderer = useCallback(
    ({ str, itemIndex }) => {
      const r = ranges?.get(itemIndex);
      if (!r) return escapeHtml(str);
      return (
        escapeHtml(str.slice(0, r.start)) +
        '<mark class="fov-cite-highlight">' +
        escapeHtml(str.slice(r.start, r.end)) +
        "</mark>" +
        escapeHtml(str.slice(r.end))
      );
    },
    [ranges]
  );

  const registerPageEl = useCallback((n, el) => {
    const prev = pageElsRef.current.get(n);
    if (prev && ioRef.current) ioRef.current.unobserve(prev);
    if (el) {
      pageElsRef.current.set(n, el);
      if (ioRef.current) ioRef.current.observe(el);
    } else {
      pageElsRef.current.delete(n);
    }
  }, []);

  const loading = (
    <div className="dv-state">
      <span className="ds-spinner" />
      <p>Đang tải file gốc…</p>
    </div>
  );

  return (
    <div
      className="pcv-scroll"
      ref={containerRef}
      aria-label={`File gốc: ${name || ""}`}
    >
      <Document
        file={blob}
        onLoadSuccess={handleLoadSuccess}
        onLoadError={onLoadError}
        loading={loading}
        error={null}
      >
        {Array.from({ length: numPages }, (_, i) => {
          const n = i + 1;
          const aspect = aspects[n] || DEFAULT_ASPECT;
          const show = !ioSupported || visible.has(n);
          return (
            <div
              key={n}
              data-pcv-page={n}
              className="pcv-page"
              ref={(el) => registerPageEl(n, el)}
              style={{
                width: width || undefined,
                minHeight: width ? Math.round(width * aspect) : undefined,
              }}
            >
              {show && width > 0 ? (
                <Page
                  pageNumber={n}
                  width={width}
                  renderAnnotationLayer={false}
                  onLoadSuccess={(p) =>
                    setAspects((a) =>
                      a[n] ? a : { ...a, [n]: p.height / p.width }
                    )
                  }
                  customTextRenderer={
                    n === citedPage && ranges ? highlightRenderer : undefined
                  }
                />
              ) : null}
            </div>
          );
        })}
      </Document>
    </div>
  );
}

export default React.memo(PdfCitationView);
