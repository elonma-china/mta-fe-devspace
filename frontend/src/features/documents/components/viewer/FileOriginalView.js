// src/features/documents/components/viewer/FileOriginalView.js
import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

import "./FileOriginalView.css";
import { fileKindFor, findQuoteRange, mergePdfFragment } from "./viewerUtils";

// PDF.js citation viewer (spec 2026-07-17) — lazy so the pdfjs chunk only
// loads when a PDF opens WITH a citation quote (CitationCard flow).
const PdfCitationView = React.lazy(() => import("./PdfCitationView"));

/**
 * FileOriginalView — renders the ORIGINAL document file inline by kind (story 23).
 *
 * The "File gốc" tab used to embed every file in an <iframe>, so only PDFs and
 * images displayed — docx/xlsx/txt were silently DOWNLOADED by the browser.
 * This component classifies the file (via {@link fileKindFor}) and picks the
 * right inline renderer:
 *   - pdf   → <iframe> (object URL)
 *   - image → <img> (object URL)
 *   - docx  → mammoth → HTML
 *   - sheet → SheetJS (xlsx) → HTML table
 *   - text  → plain <pre> / markdown
 *   - else  → a clear "không xem trực tiếp được" message + an explicit
 *             "Tải về" button (never a silent download)
 *
 * @param {object} props
 * @param {Blob}   props.blob          the original file blob (already fetched)
 * @param {string} [props.name]        the document name (drives the kind)
 * @param {string} [props.contentType] optional content-type fallback for the kind
 * @param {number} [props.page]        Story 109: 1-based page to open the PDF at
 *   (`#page=N`). This is the STABLE citation page set once at open — NOT the
 *   scroll-spy current page — so the src changes only on a deliberate open, not
 *   on scroll (preserves the story-57 anti-jank fix).
 *
 * @param {{page?: number|null, quote?: string}} [props.citation]
 *   Directive-review citation. Unlike `page` (chat sources, iframe-only focus)
 *   this also carries the quoted passage, which routes PDFs through
 *   `PdfCitationView` for a real text-layer highlight. When both are given
 *   `citation.page` wins — it is the more specific request.
 *
 * Story 57: the PDF iframe did NOT focus a page — coupling the src to the
 * (scroll-spy) current page reloaded the whole PDF on every page/tab change
 * (jank). Story 109 re-adds focus via the STABLE `page` prop only (memoized), so
 * scrolling never changes the src; the browser PDF viewer still owns in-doc nav.
 */
/**
 * CitationRibbon — yellow quote bar for kinds that cannot carry an inline
 * mark (the native PDF iframe above all). Shows the cited passage + page.
 *
 * @param {object} props
 * @param {{page?: number|null, quote?: string}} props.citation
 * @param {() => void} props.onDismiss
 */
function CitationRibbon({ citation, onDismiss }) {
  if (!citation?.quote) return null;
  const label =
    citation.page != null ? `Trích dẫn (tr.${citation.page}):` : "Trích dẫn:";
  return (
    <div className="fov-cite-ribbon" role="note">
      <span className="fov-cite-ribbon-label">📌 {label}</span>
      <span className="fov-cite-ribbon-quote">{citation.quote}</span>
      <button
        type="button"
        className="fov-cite-ribbon-close"
        aria-label="Đóng trích dẫn"
        onClick={onDismiss}
      >
        ✕
      </button>
    </div>
  );
}

function FileOriginalView({ blob, name, contentType, citation, page }) {
  const kind = fileKindFor(name, contentType || blob?.type);

  // Object URL for pdf/image/download — created once per blob, revoked on unmount.
  const [objectUrl, setObjectUrl] = useState(null);
  // Parsed inline content for docx/sheet/text.
  const [html, setHtml] = useState(null);
  const [text, setText] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState(false);
  const containerRef = useRef(null);

  // ── Citation highlight (directive review) ──────────────────────────
  // Quote ribbon for kinds whose content we cannot (or could not) mark
  // inline. Dismissal is local UI state — it must never touch the PDF
  // iframe (story 57). `inlineMarked` records that a real <mark> landed
  // (docx/sheet DOM walk), making the ribbon redundant.
  const [ribbonDismissed, setRibbonDismissed] = useState(false);
  const [inlineMarked, setInlineMarked] = useState(false);
  // PDF.js failed to load/parse the doc → fall back to the native iframe.
  const [pdfjsFailed, setPdfjsFailed] = useState(false);
  const markRef = useRef(null);
  const scrolledRef = useRef(false);

  // Plain-text kind can be marked declaratively; .md renders through
  // ReactMarkdown where a safe inline wrap isn't available (ribbon instead).
  const isMarkdownName = /\.(md|markdown)$/i.test(name || "");
  const plainTextQuoteRange =
    kind === "text" && !isMarkdownName && text != null && citation?.quote
      ? findQuoteRange(text, citation.quote)
      : null;

  // One-shot scroll to the inline mark (guarded: jsdom lacks scrollIntoView).
  useEffect(() => {
    if (markRef.current && !scrolledRef.current) {
      scrolledRef.current = true;
      markRef.current.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }
  });

  // Bug 4 (2026-07-31): re-center the mark after a layout shift, while the
  // programmatic focus still owns the scroll — same contract as
  // PdfCitationView/DocumentViewer. The docx/text content renders in one shot,
  // but embedded images (mammoth data-URIs) decode late and grow the column
  // under the reader. The first real user gesture releases the lock.
  const focusLockRef = useRef(true);
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
    let ro;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        if (!focusLockRef.current || !scrolledRef.current) return;
        markRef.current?.scrollIntoView?.({ block: "center" });
      });
      ro.observe(el);
    }
    return () => {
      GESTURES.forEach((evt) => el.removeEventListener(evt, release));
      if (ro) ro.disconnect();
    };
  }, []);

  // Inline-mark the quote inside parsed HTML (docx/sheet). Runs after the
  // HTML lands in the DOM. Only a match contained in a SINGLE text node is
  // wrapped — wrapping across element boundaries cannot be done safely on
  // foreign markup; those cases keep the ribbon.
  useEffect(() => {
    if ((kind !== "docx" && kind !== "sheet") || !html || !citation?.quote) {
      return;
    }
    const root = containerRef.current;
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const range = findQuoteRange(node.textContent, citation.quote);
      if (!range) continue;
      const target = node.splitText(range.start);
      target.splitText(range.end - range.start);
      const mark = document.createElement("mark");
      mark.className = "fov-cite-highlight";
      target.parentNode.replaceChild(mark, target);
      mark.appendChild(target);
      setInlineMarked(true);
      // Bug 4: keep the walker-created mark reachable for the re-center
      // effect above (it only knew the plain-text branch's declarative mark).
      markRef.current = mark;
      scrolledRef.current = true;
      mark.scrollIntoView?.({ block: "center", behavior: "smooth" });
      return; // first match only
    }
  }, [kind, html, citation?.quote]);

  useEffect(() => {
    if (!blob) return undefined;
    let active = true;
    let createdUrl = null;

    // New document/blob: citation UI starts clean.
    setRibbonDismissed(false);
    setInlineMarked(false);
    setPdfjsFailed(false);
    scrolledRef.current = false;

    // pdf/image/unsupported only need an object URL (no parsing).
    if (kind === "pdf" || kind === "image" || kind === "unsupported") {
      try {
        // Story 32: a .pdf whose blob carries a wrong/generic content-type (e.g.
        // application/octet-stream) makes the browser DOWNLOAD the iframe instead
        // of rendering it. Re-wrap as application/pdf so it views inline. (Guard
        // `instanceof Blob` so the jsdom test mocks — plain objects — pass through.)
        const source =
          kind === "pdf" &&
          typeof Blob !== "undefined" &&
          blob instanceof Blob &&
          blob.type !== "application/pdf"
            ? new Blob([blob], { type: "application/pdf" })
            : blob;
        createdUrl = URL.createObjectURL(source);
        setObjectUrl(createdUrl);
      } catch {
        setParseError(true);
      }
      return () => {
        active = false;
        if (createdUrl) URL.revokeObjectURL(createdUrl);
      };
    }

    // docx/sheet/text need to be parsed to inline HTML/text.
    setParsing(true);
    setParseError(false);
    setHtml(null);
    setText(null);

    const parse = async () => {
      if (kind === "docx") {
        const mod = await import("mammoth");
        const mammoth = mod.default || mod;
        const buf = await blob.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer: buf });
        return { html: result.value };
      }
      if (kind === "sheet") {
        const XLSX = await import("xlsx");
        const buf = await blob.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const first = wb.SheetNames[0];
        const table = first
          ? XLSX.utils.sheet_to_html(wb.Sheets[first])
          : "";
        return { html: table };
      }
      // text / markdown
      const raw = await blob.text();
      return { text: raw };
    };

    parse()
      .then((res) => {
        if (!active) return;
        if (res.html != null) setHtml(res.html);
        if (res.text != null) setText(res.text);
        setParsing(false);
      })
      .catch(() => {
        if (!active) return;
        setParseError(true);
        setParsing(false);
      });

    return () => {
      active = false;
    };
  }, [blob, kind]);

  // Story 57: a STABLE PDF iframe src — memoized on the object URL only, so it
  // never changes across parent re-renders (e.g. the digitized scroll-spy) and
  // the browser does not reload the PDF. `pagemode=none` is a best-effort hint
  // to keep the native thumbnail/nav pane collapsed (ignored by viewers that
  // don't support it).
  // Story 58: `zoom=page-width` fits the page to the pane WIDTH so the PDF shows
  // full-width and NEVER overflows horizontally. A fixed `zoom=85` made the page
  // wider than the pane on a narrow split → the native viewer grew an internal
  // horizontal scrollbar that was janky to drag (PDF-only — non-PDF HTML wraps).
  // Fit-width removes the horizontal overflow → removes that jank.
  // Story 109 + directive review: prepend `page=N` when a stable initial page
  // is given (citation focus). Two independent callers supply one:
  //   - `page`             — chat sources via DocumentViewer (story 109)
  //   - `citation.page`    — directive-review CitationCard
  // `citation.page` wins: it is the more specific request and arrives with the
  // quote that drives the PdfCitationView highlight path below.
  // Both are stable for the lifetime of an object URL (set before the viewer
  // opens, cleared on close), so the src is built once per (URL, page) pair and
  // never mutated during viewing — story 57/58 anti-jank behavior preserved.
  const focusPage = citation?.page ?? page;
  const pdfSrc = useMemo(
    () => (objectUrl ? mergePdfFragment(objectUrl, focusPage) : null),
    [objectUrl, focusPage]
  );

  // Ribbon shows for any kind carrying a citation quote, until dismissed or
  // superseded by a successful inline mark.
  const showRibbon =
    Boolean(citation?.quote) &&
    !ribbonDismissed &&
    !inlineMarked &&
    !plainTextQuoteRange;
  const ribbon = showRibbon ? (
    <CitationRibbon
      citation={citation}
      onDismiss={() => setRibbonDismissed(true)}
    />
  ) : null;

  const download = () => {
    if (!objectUrl) return;
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = name || "tai-lieu";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  if (parseError) {
    return (
      <div className="fov-cite-host">
        {ribbon}
        <div className="dv-state dv-fallback">
          <p>Không thể hiển thị nội dung file gốc. Hãy thử tab “Nội dung đã số hóa”.</p>
        </div>
      </div>
    );
  }

  if (kind === "pdf") {
    // Citation flow: PDF.js view with the in-page highlight (spec
    // 2026-07-17). Any pdfjs failure flips back to the native iframe below.
    if (citation?.quote && !pdfjsFailed && blob) {
      return (
        <div className="fov-cite-host">
          {ribbon}
          <React.Suspense
            fallback={
              <div className="dv-state">
                <span className="ds-spinner" />
                <p>Đang tải file gốc…</p>
              </div>
            }
          >
            <PdfCitationView
              blob={blob}
              name={name}
              citation={citation}
              onHighlightResult={setInlineMarked}
              onLoadError={() => setPdfjsFailed(true)}
            />
          </React.Suspense>
        </div>
      );
    }
    return pdfSrc ? (
      <div className="fov-cite-host">
        {ribbon}
        <iframe className="dv-file-frame" src={pdfSrc} title={`File gốc: ${name || ""}`} />
      </div>
    ) : (
      <div className="dv-state">
        <span className="ds-spinner" />
        <p>Đang tải file gốc…</p>
      </div>
    );
  }

  if (kind === "image") {
    return objectUrl ? (
      <div className="fov-cite-host">
        {ribbon}
        <img className="dv-page-image" src={objectUrl} alt={name || "Tài liệu"} />
      </div>
    ) : (
      <div className="dv-state">
        <span className="ds-spinner" />
        <p>Đang tải file gốc…</p>
      </div>
    );
  }

  if (kind === "unsupported") {
    return (
      <div className="fov-cite-host">
        {ribbon}
        <div className="dv-state dv-fallback">
          <p>
            Định dạng này không xem trực tiếp được trong trình duyệt. Bạn có thể
            tải về để mở, hoặc dùng tab “Nội dung đã số hóa”.
          </p>
          <button
            type="button"
            className="dv-downloadbtn"
            onClick={download}
            disabled={!objectUrl}
          >
            Tải về
          </button>
        </div>
      </div>
    );
  }

  if (parsing) {
    return (
      <div className="dv-state">
        <span className="ds-spinner" />
        <p>Đang tải file gốc…</p>
      </div>
    );
  }

  if (kind === "docx" || kind === "sheet") {
    return (
      <div className="fov-cite-host">
        {ribbon}
        <div
          ref={containerRef}
          className={kind === "sheet" ? "dv-file-sheet" : "dv-file-doc"}
          // eslint-disable-next-line react/no-danger -- parsed from a trusted
          // first-party document by mammoth/SheetJS; rendered read-only inline.
          dangerouslySetInnerHTML={{ __html: html || "" }}
        />
      </div>
    );
  }

  // text / markdown
  if (isMarkdownName) {
    // ReactMarkdown owns this DOM — no safe inline wrap; ribbon carries the quote.
    return (
      <div className="fov-cite-host">
        {ribbon}
        <div className="dv-file-md">
          <ReactMarkdown>{text || ""}</ReactMarkdown>
        </div>
      </div>
    );
  }
  return (
    <div className="fov-cite-host">
      {ribbon}
      <pre className="dv-page-text">
        {plainTextQuoteRange ? (
          <>
            {text.slice(0, plainTextQuoteRange.start)}
            <mark ref={markRef} className="fov-cite-highlight">
              {text.slice(plainTextQuoteRange.start, plainTextQuoteRange.end)}
            </mark>
            {text.slice(plainTextQuoteRange.end)}
          </>
        ) : (
          text || ""
        )}
      </pre>
    </div>
  );
}

// Story 57: memoize so a parent re-render (e.g. the DocumentViewer scroll-spy
// updating the page counter) does not re-render this subtree — keeping the PDF
// iframe stable (no reload/flicker). The blob is a stable ref per open document.
export default React.memo(FileOriginalView);
