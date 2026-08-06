// src/features/documents/components/viewer/DocumentViewer.js
import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import "./DocumentViewer.css";
import { ReactComponent as X } from "assets/images/x.svg";
import { getDocumentPages, fetchDocumentFile } from "features/documents/api";
import {
  VIEWER_TABS,
  isUnprocessed,
  fileKindFor,
  clampPage,
  pageTextFor,
  pageEntryFor,
  pageAtScroll,
} from "./viewerUtils";
import {
  computePageHighlight,
  rangeFromCharSpan,
  segmentByRanges,
} from "./viewerHighlight";
import FileOriginalView from "./FileOriginalView";
import ErrorBoundary from "components/common/ErrorBoundary";
import useViewerCacheStore from "stores/useViewerCacheStore";

/**
 * DocumentViewer — document viewer used by the chat right column and the admin
 * repository preview (story 15/39).
 *
 * File-kind aware (story 51) + crash-safe (story 52):
 *   - PDF: two tabs. "File gốc" renders the PDF in the browser's built-in viewer
 *     (FileOriginalView pdf branch, iframe, fit-to-width — story 52 reverted the
 *     @react-pdf-viewer library which crashed on React 19). "Nội dung đã số hóa"
 *     shows the digitized OCR text per page.
 *   - Non-PDF (docx/xlsx/image/text): ONLY the original file content
 *     (FileOriginalView). No digitized tab, no tab bar, no thumbnail.
 *
 * The custom thumbnail rail (page-image / text-card) was removed in story 51.
 * The content area is wrapped in an ErrorBoundary (story 52) so a viewer error
 * never white-screens the whole app.
 *
 * Keeps no global state; the host owns open/close.
 *
 * @param {object}   props
 * @param {string}   props.documentId
 * @param {string}   [props.documentName]
 * @param {string|number} [props.userId]
 * @param {string|number} [props.conversationId]
 * @param {() => void} [props.onClose]
 * @param {object} [props.loaders] — Story 39: optional data-loader injection so
 *   the SAME viewer works outside chat (admin repository screen). When omitted,
 *   the viewer reads via the chat routes (userId + conversationId + documentId).
 *   When provided: `{ pages: () => Promise, file: () => Promise<Blob> }`.
 *   (`pageImage` is accepted for backward compatibility but no longer used —
 *   the thumbnail rail was removed in story 51.)
 * @param {number} [props.initialPage] — Story 109: 1-based page to focus when the
 *   viewer opens from a chat citation. PDF focuses the "File gốc" tab via the
 *   iframe `#page`; a non-PDF (docx/xlsx/txt) has no page anchors in its original
 *   view, so it focuses the "Nội dung đã số hóa" per-page text instead. Omitted
 *   (list-preview / admin / user repo) → opens at page 1 on the default tab.
 * @param {number} [props.highlightCharStart] — where the cited chunk starts in
 *   the document's source text, and {@link props.highlightCharEnd} where it
 *   ends. Each page carries its own span in that same text, so the range to
 *   mark is a subtraction: exact, and unaffected by the OCR/markdown drift that
 *   makes text matching miss. Omitted, or landing outside the focused page →
 *   the viewer falls back to matching `highlightText`, exactly as before.
 * @param {number} [props.highlightCharEnd] — see {@link props.highlightCharStart}.
 * @param {string} [props.highlightAnswer] — the answer text this citation came
 *   from, used only by the matching fallback: without offsets `highlightText`
 *   can cover the whole of a short document, so marking everything it contains
 *   lit up ~93% of the page, and the answer is what narrows it to the part
 *   actually used. Omitted (admin/repo preview, old data) → the citation alone
 *   decides, as before.
 * @param {Array<{page_number:number, text:string}>} [props.highlightSegments] —
 *   cross-page citation fix: a window-enriched citation can span more than one
 *   page. Each segment ADDS a mark on its own page (computed the same way as
 *   `focusHl`) — it never changes the focus page, which always keeps using
 *   `highlightText`/`focusHl` even when a segment also targets that page.
 *   Omitted (old data / non-citation opens) → behaves exactly as before.
 * @param {number} [props.focusNonce] — Story 135: a value the host bumps on every
 *   citation click. It re-arms the one-shot page focus so a click always jumps to
 *   the cited page + highlight, even when the viewer is already open on the same
 *   document + page (the user may have scrolled away). Omitted → no extra re-arm
 *   (admin/repo consumers that never pass a citation are unaffected).
 */
export default function DocumentViewer({
  documentId,
  documentName,
  userId,
  conversationId,
  onClose,
  loaders,
  initialPage,
  highlightText,
  highlightCharStart,
  highlightCharEnd,
  highlightAnswer,
  highlightSegments,
  focusNonce,
}) {
  const [activeTab, setActiveTab] = useState(VIEWER_TABS.ORIGINAL);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // The original file blob; FileOriginalView turns it into the right inline view
  // by kind (pdf → iframe). ``fileFailed`` when the file 404s/errs.
  const [fileBlob, setFileBlob] = useState(null);
  const [fileFailed, setFileFailed] = useState(false);
  // Refs to each digitized page section so the scroll-spy can track the page.
  const pageRefs = useRef({});
  const mainRef = useRef(null);
  // Story 109: guard so the citation page is focused ONCE per open (a new doc or
  // a new initialPage resets it), not re-triggered by every re-render.
  const focusedRef = useRef(false);
  // Story 135: the documentId whose pages are CURRENTLY in `pages`. When the
  // viewer is already open and switches to another document, `pages` still holds
  // the previous doc for a render or two while the new one loads; the focus
  // effect must NOT act until the loaded pages match the current document, or it
  // focuses the wrong (stale) page and locks the one-shot before the real pages
  // arrive (→ the new doc opened stuck on page 1).
  const loadedDocIdRef = useRef(null);
  // Story 138: true while a PROGRAMMATIC citation focus owns the page counter.
  // The scroll-spy below must not overwrite `currentPage` from the scroll events
  // the focus itself raises — its bottom-guard reports the LAST page whenever the
  // container lands within a few px of the end, which is how a citation to page
  // 69 ended up showing "85/85". Released on the first real user gesture, so the
  // spy (story 133) keeps working exactly as before once the user scrolls.
  const focusLockRef = useRef(false);

  // Story 39: resolve the data loaders. With injected `loaders` (admin repo
  // screen) the viewer needs no chat conversation context; without them it uses
  // the chat routes bound to (userId, conversationId, documentId) — unchanged.
  const loadPages = loaders
    ? loaders.pages
    : () => getDocumentPages(userId, conversationId, documentId);
  const loadFile = loaders
    ? loaders.file
    : () => fetchDocumentFile(userId, conversationId, documentId);

  // Story 51: PDFs get the two-tab view; everything else shows only its original
  // content (no tab bar). Story 109: a non-PDF opened FROM A CITATION (a page to
  // focus + digitized pages, and not an image) also gets the tabs so it can show
  // the focused per-page text — its "File gốc" is a continuous blob with no page
  // anchors to scroll to.
  const kind = fileKindFor(documentName, fileBlob?.type);
  const pdf = kind === "pdf";
  const image = kind === "image";
  const wantFocus = Number.isFinite(initialPage) && initialPage >= 1;
  const digitizedFocusMode = wantFocus && !pdf && !image && pages.length > 0;
  const showTabs = pdf || digitizedFocusMode;

  // Story 132: trust the API-provided identity in strict priority — document
  // (document_id) → page (page_number) → text. We focus the AI-claimed
  // `page_number` (clamped into range) and NEVER scan the whole document to
  // "guess" a better page: the old whole-doc scan (bestPageForText, story
  // 113/131) both hurt performance and dragged the highlight onto a wrong page
  // when generic sentences repeat across pages/documents. The highlight below is
  // computed on THIS page only; if the cited text isn't here we mark nothing
  // (a wrong page_number surfaces as no-highlight — an AI data bug, not a place
  // to guess). Non-citation consumers keep `initialPage`.
  const resolvedPage = useMemo(() => {
    if (!wantFocus) return initialPage;
    return clampPage(initialPage, pageCount || pages.length || initialPage);
  }, [wantFocus, initialPage, pages.length, pageCount]);

  // Story 110/113: decide how to highlight the CITED content on the focused page —
  // scoped to that ONE page's text (scales to large docs). "spans" marks the
  // matching segments; "none" leaves it plain (story 113 removed the whole-page
  // tint — mark the matching sentences instead).
  //
  // Offsets first: when the citation and the page both carry their position in
  // the document's source text, the range is a subtraction — exact, and immune
  // to the OCR/markdown differences that make matching miss. Matching stays as
  // the fallback for citations and documents indexed before the offsets, and
  // for an offset that does not land on this page (stale data must not blank
  // the highlight).
  const focusHl = useMemo(() => {
    if (!wantFocus || !highlightText) return { mode: "none" };
    const exact = rangeFromCharSpan(
      pageEntryFor(pages, resolvedPage),
      highlightCharStart, highlightCharEnd, highlightText
    );
    if (exact.mode === "spans") return exact;
    return computePageHighlight(
      pageTextFor(pages, resolvedPage), highlightText, { answerText: highlightAnswer }
    );
  }, [
    wantFocus, highlightText, highlightAnswer, pages, resolvedPage,
    highlightCharStart, highlightCharEnd,
  ]);

  // Cross-page citation fix: a window-enriched citation can span more than one
  // page. Each segment is matched against its OWN page's text (same algorithm
  // as focusHl, just per-page) — the focus page keeps using focusHl above,
  // never this map (see the `!isFocus` guard in renderDigitized below).
  const highlightSegmentsByPage = useMemo(() => {
    const map = new Map();
    if (!Array.isArray(highlightSegments)) return map;
    for (const seg of highlightSegments) {
      const pn = seg?.page_number;
      if (pn == null || !seg?.text) continue;
      const hl = computePageHighlight(
        pageTextFor(pages, pn), seg.text, { answerText: highlightAnswer }
      );
      if (hl.mode === "spans") map.set(Number(pn), hl);
    }
    return map;
  }, [highlightSegments, highlightAnswer, pages]);

  useEffect(() => {
    if (!documentId) return undefined;
    // Chat path needs the conversation context; the injected (admin) path does not.
    if (!loaders && (!userId || !conversationId)) return undefined;
    let active = true;
    setLoading(true);
    setError(null);
    setFileFailed(false);
    setFileBlob(null);
    focusedRef.current = false;
    focusLockRef.current = false;
    // Story 111: a citation opens the "Nội dung đã số hóa" tab for EVERY kind
    // (PDF included), so the highlighted cited passage (story 110) is visible
    // immediately. The PDF "File gốc" tab still focuses `#page` when the user
    // switches to it. (Story 109 used to open a PDF citation on "File gốc".) A
    // non-citation open keeps the default "File gốc" tab.
    const focusPage = Number.isFinite(initialPage) && initialPage >= 1;
    setActiveTab(focusPage ? VIEWER_TABS.DIGITIZED : VIEWER_TABS.ORIGINAL);
    setCurrentPage(focusPage ? initialPage : 1);

    // Both fetches go through the per-document viewer cache: reopening a
    // document (or opening a citation card onto it) must not refetch — a
    // reload costs seconds through the AI-service proxy and fails outright
    // when the upstream is unreachable.
    const { getPages: cachedPages, getFile: cachedFile } =
      useViewerCacheStore.getState();

    cachedPages(documentId, loadPages)
      .then((res) => {
        if (!active) return;
        const list = res?.pages || [];
        // Story 135: mark that `pages` now belongs to THIS document, so the
        // focus effect knows the loaded pages are the current doc's (not stale).
        loadedDocIdRef.current = documentId;
        setPages(list);
        setPageCount(res?.page_count || list.length || 0);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err?.message || "Không thể tải tài liệu.");
        setLoading(false);
      });

    cachedFile(documentId, loadFile)
      .then((blob) => {
        if (active) setFileBlob(blob);
      })
      .catch(() => {
        if (active) setFileFailed(true);
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loaders derived per-doc
  }, [documentId, userId, conversationId, loaders]);

  const scrollToPage = useCallback((n) => {
    const node = pageRefs.current[n];
    if (node && node.scrollIntoView) {
      node.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, []);

  // Story 110: prefer scrolling the highlighted `<mark>` into view (so the cited
  // passage is centered); fall back to the page section top.
  //
  // Story 138: the mark is looked up INSIDE the cited page's own section. It used
  // to be `mainRef.querySelector(".dv-hl")` — the first mark in the WHOLE column.
  // A cross-page citation (`highlightSegments`) also marks other pages, so when
  // the cited page's own text didn't match (story 132 leaves it unmarked), the
  // first mark could sit on a far later — even the last — page and the viewer
  // scrolled there instead. Returns whether the focus actually landed on a node,
  // so the caller only latches its one-shot on a real scroll.
  const scrollToFocus = useCallback((n) => {
    const section = pageRefs.current[n];
    if (!section || !section.scrollIntoView) return false;
    const mark = section.querySelector(".dv-hl");
    // Instant, not smooth: a programmatic focus must land deterministically —
    // an animation keeps firing scroll events (and can be cut short by a second
    // scroll request) while the one-shot has already latched.
    if (mark && mark.scrollIntoView) mark.scrollIntoView({ block: "center" });
    else section.scrollIntoView({ block: "start" });
    return true;
  }, []);

  // When the digitized tab opens, scroll to the current page (kept in sync with
  // the "n/N trang" counter).
  useEffect(() => {
    if (activeTab !== VIEWER_TABS.DIGITIZED) return;
    // Story 138: a citation focus that has not fired yet OWNS the scroll — it
    // targets the cited mark, this one only targets the page top. Both used to
    // run in the same commit whenever the document came from the viewer cache
    // (i.e. every reopen), leaving two competing scrolls in one frame.
    if (wantFocus && !focusedRef.current) return;
    scrollToPage(currentPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on tab change
  }, [activeTab]);

  // Story 109/111: focus the cited page once the doc is loaded. Story 111 opens
  // the digitized tab and scrolls to the cited page for BOTH pdf and non-pdf when
  // there is digitized text — so the highlight (story 110) shows immediately; the
  // PDF "File gốc" tab keeps its own `#page` focus (FileOriginalView) when the
  // user switches to it. An image, or a doc with no digitized pages, falls back to
  // the "File gốc" view. A new doc or a new `initialPage` re-arms the focus.
  // Re-arm the one-shot focus whenever the citation target changes. Story 135
  // adds `focusNonce`: the host bumps it on EVERY citation click, so re-clicking
  // the SAME document + page (after the user scrolled away) re-arms and scrolls
  // back — otherwise `[documentId, initialPage]` alone never changes and the
  // click looks dead.
  useEffect(() => {
    focusedRef.current = false;
  }, [documentId, initialPage, focusNonce]);

  useEffect(() => {
    if (loading || focusedRef.current || !wantFocus) return;
    // Story 135: only focus once the loaded `pages` belong to the CURRENT
    // document. While switching docs, `pages` briefly still holds the previous
    // doc; focusing then would lock the one-shot on the wrong (stale) page and
    // the new doc would open stuck on page 1.
    if (loadedDocIdRef.current !== documentId) return;
    const target = clampPage(resolvedPage, pageCount || pages.length || resolvedPage);
    if (!image && pages.length > 0) {
      setActiveTab(VIEWER_TABS.DIGITIZED);
      setCurrentPage(target);
      // Story 138: latch the one-shot only when the scroll really landed. When
      // the digitized column is not mounted yet (the tab is switching in this
      // very commit) there is no node to scroll to; latching anyway silently
      // dropped the focus. `activeTab` is in the deps below so the next commit
      // — the one that mounts the column — retries.
      if (!scrollToFocus(target)) return;
      focusLockRef.current = true;
      focusedRef.current = true;
    } else if (pdf) {
      // PDF with no digitized pages: focus the page in the "File gốc" iframe.
      setActiveTab(VIEWER_TABS.ORIGINAL);
      setCurrentPage(target);
      focusedRef.current = true;
    }
  }, [
    loading,
    pages,
    pdf,
    image,
    resolvedPage,
    pageCount,
    wantFocus,
    scrollToFocus,
    documentId,
    focusNonce,
    activeTab,
  ]);

  // Bug 3 (2026-07-30): re-apply the citation focus after ANY reflow that moves
  // the cited mark, for as long as the programmatic focus still owns the scroll.
  //
  // The host panel ANIMATES its width when the viewer opens — Chat.css
  // `.analysis-panel { transition: flex-basis 200ms ease }`. With a COLD viewer
  // cache the pages arrive from the network long after those 200ms, so the focus
  // scrolls against the settled layout and lands right. With a WARM cache — i.e.
  // every time the user closes the viewer and clicks the SAME citation again —
  // the pages render in the FIRST frame and the focus scrolls while the pane is
  // still narrow. Measured on the real stack: 360px wide / 9823px tall at scroll
  // time vs 696px / 6800px once the animation lands. The `<pre>` re-wraps, the
  // cited mark moves from y=3369 to y=2238 while the scroll stays at 2602, and
  // the reader ends up a page further on with no highlight in sight.
  //
  // Anything that reflows after the scroll does this (the width animation, a font
  // swap, a drag on the split handle), so don't special-case the animation:
  // observe the scroll container and re-focus while `focusLockRef` is still set —
  // story 138 already releases it on the first real user gesture, which is
  // exactly "the user has taken the scroll over, leave it alone".
  useEffect(() => {
    if (activeTab !== VIEWER_TABS.DIGITIZED || !pages.length) return undefined;
    const container = mainRef.current;
    if (!container || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => {
      if (!wantFocus || !focusedRef.current || !focusLockRef.current) return;
      scrollToFocus(resolvedPage);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [activeTab, pages, wantFocus, resolvedPage, scrollToFocus]);

  // Story 27/51/133: scroll-spy — keep the "n/N trang" counter on the page
  // actually in view in the digitized column. Story 133 replaced the old
  // IntersectionObserver, which picked the TOPMOST still-intersecting section
  // and so lagged one page behind (reading page 10 showed "9/10"). We now
  // compute the page from geometry via `pageAtScroll` (page past the reading
  // line, with a bottom-guard so a short last page reads N/N), throttled with
  // requestAnimationFrame. Runs on scroll only — never on mount/tab-open — so a
  // zero-geometry environment (jsdom) never mis-sets the page.
  useEffect(() => {
    if (activeTab !== VIEWER_TABS.DIGITIZED || !pages.length) return undefined;
    const container = mainRef.current;
    if (!container) return undefined;
    let raf = 0;
    const compute = () => {
      raf = 0;
      // Story 138: a programmatic citation focus owns the counter until the user
      // scrolls themselves — otherwise the scroll events it raises immediately
      // overwrite the cited page (bottom-guard → "N/N").
      if (focusLockRef.current) return;
      const cTop = container.getBoundingClientRect().top;
      const sections = [];
      pages.forEach((pg) => {
        const node = pageRefs.current[pg.page_number];
        if (!node) return;
        const r = node.getBoundingClientRect();
        sections.push({
          page: pg.page_number,
          top: r.top - cTop + container.scrollTop,
        });
      });
      const n = pageAtScroll(
        sections,
        container.scrollTop,
        container.clientHeight,
        container.scrollHeight
      );
      if (n) setCurrentPage(n);
    };
    const onScroll = () => {
      if (raf) return;
      raf =
        typeof requestAnimationFrame === "function"
          ? requestAnimationFrame(compute)
          : (compute(), 0);
    };
    // Story 138: any real user gesture hands the counter back to the spy.
    const releaseFocusLock = () => {
      focusLockRef.current = false;
    };
    const GESTURES = ["wheel", "touchstart", "mousedown", "keydown"];
    container.addEventListener("scroll", onScroll, { passive: true });
    GESTURES.forEach((evt) =>
      container.addEventListener(evt, releaseFocusLock, { passive: true })
    );
    return () => {
      container.removeEventListener("scroll", onScroll);
      GESTURES.forEach((evt) =>
        container.removeEventListener(evt, releaseFocusLock)
      );
      if (raf && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(raf);
      }
    };
  }, [activeTab, pages]);

  const displayName = documentName || "Tài liệu";
  const totalPages = pageCount || 0;
  // No digitized pages AND no original file → the doc (typically a repo doc) is
  // not processed yet. Show one clear "đang chờ xử lý" message.
  const unprocessed = isUnprocessed({ pageCount: totalPages, fileFailed });

  // The "File gốc" content area (PDF library view or the original-file view).
  const renderOriginal = () =>
    fileFailed ? (
      <div className="dv-state dv-fallback">
        <p>
          Không tải được file gốc. Hãy dùng tab “Nội dung đã số hóa” để xem nội
          dung tài liệu.
        </p>
      </div>
    ) : fileBlob ? (
      // Story 52: PDF reverted to the browser's iframe viewer (FileOriginalView
      // pdf branch, fit-to-width) — the @react-pdf-viewer library crashed on
      // React 19. PDF fills + resizes with the pane; non-PDF keeps the scrollable
      // original view.
      <div className={pdf ? "dv-pdf-wrap" : "dv-main dv-scroll"}>
        {/* Story 57/109: pass the STABLE `initialPage` (the citation page), NOT
            the scroll-spy currentPage. FileOriginalView memoizes the PDF src on
            [objectUrl, page], so scrolling never reloads the PDF; the src only
            changes when a citation opens a new page. */}
        <FileOriginalView blob={fileBlob} name={displayName} page={resolvedPage} />
      </div>
    ) : (
      <div className="dv-state">
        <span className="ds-spinner" />
        <p>Đang tải file gốc…</p>
      </div>
    );

  const renderDigitized = () =>
    totalPages > 0 ? (
      <div className="dv-main dv-scroll" ref={mainRef}>
        <div className="dv-digitized">
          {pages.map((pg) => {
            const n = pg.page_number;
            // Story 110/113: highlight the cited content on the FOCUSED page only
            // (resolved from content, bug 1). No whole-page tint anymore.
            const isFocus = wantFocus && n === resolvedPage;
            // Cross-page citation fix: non-focus pages can ALSO get a mark when
            // a highlightSegments entry matches their own content. The focus
            // page never consults this — it always uses focusHl above.
            const segHl = !isFocus ? highlightSegmentsByPage.get(n) : undefined;
            return (
              <section
                key={n}
                className="dv-page-section"
                data-page={n}
                ref={(el) => {
                  pageRefs.current[n] = el;
                }}
              >
                <div className="dv-page-label">Trang {n}</div>
                <pre className="dv-page-text">
                  {isFocus && focusHl.mode === "spans"
                    ? segmentByRanges(pg.content || "", focusHl.ranges).map(
                        (seg, i) =>
                          seg.marked ? (
                            <mark key={i} className="dv-hl">
                              {seg.text}
                            </mark>
                          ) : (
                            <React.Fragment key={i}>{seg.text}</React.Fragment>
                          )
                      )
                    : segHl
                    ? segmentByRanges(pg.content || "", segHl.ranges).map(
                        (seg, i) =>
                          seg.marked ? (
                            <mark key={i} className="dv-hl">
                              {seg.text}
                            </mark>
                          ) : (
                            <React.Fragment key={i}>{seg.text}</React.Fragment>
                          )
                      )
                    : pg.content || "(Trang này chưa có nội dung)"}
                </pre>
              </section>
            );
          })}
        </div>
      </div>
    ) : (
      <div className="dv-state dv-fallback">
        <p>
          Tài liệu chưa được số hoá. Quản trị viên có thể số hoá tài liệu trong
          màn Quản lý kho tài liệu.
        </p>
      </div>
    );

  return (
    <div className="doc-viewer" role="region" aria-label="Xem tài liệu">
      {/* Story 51/109: tab row when there are two views to switch between — a
          PDF always, or a non-PDF citation focusing its digitized text. For a
          plain non-PDF there is no tab bar — just the close button. */}
      <div className="dv-tabs" role={showTabs ? "tablist" : undefined}>
        {showTabs && (
          <>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === VIEWER_TABS.ORIGINAL}
              className={`dv-tab ${activeTab === VIEWER_TABS.ORIGINAL ? "is-active" : ""}`}
              onClick={() => setActiveTab(VIEWER_TABS.ORIGINAL)}
            >
              File gốc
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === VIEWER_TABS.DIGITIZED}
              className={`dv-tab ${activeTab === VIEWER_TABS.DIGITIZED ? "is-active" : ""}`}
              onClick={() => setActiveTab(VIEWER_TABS.DIGITIZED)}
            >
              Nội dung đã số hóa
            </button>
          </>
        )}
        <button
          type="button"
          className="dv-close"
          onClick={onClose}
          aria-label="Đóng"
        >
          <X />
        </button>
      </div>

      <div className="dv-titlebar">
        <h3 className="dv-title" title={displayName}>
          {displayName}
        </h3>
        {showTabs && totalPages > 0 && (
          // Story 133: the counter follows the page in view ONLY on the
          // digitized tab, where the scroll-spy can track it. The "File gốc"
          // PDF renders in the browser's native iframe viewer, whose internal
          // page scroll React cannot observe — showing "1/N" there froze on the
          // opened page and looked wrong when the user paged through the PDF, so
          // that tab shows the TOTAL only.
          <div className="dv-pagecount">
            {activeTab === VIEWER_TABS.DIGITIZED
              ? `${currentPage}/${totalPages} trang`
              : `${totalPages} trang`}
          </div>
        )}
      </div>

      <div className="dv-body">
        {loading && (
          <div className="dv-state">
            <span className="ds-spinner" />
            <p>Đang tải tài liệu…</p>
          </div>
        )}

        {!loading && error && (
          <div className="dv-state dv-error">
            <p>{error}</p>
          </div>
        )}

        {!loading && !error && unprocessed && (
          <div className="dv-state dv-fallback">
            <p>Tài liệu đang chờ xử lý, chưa thể xem. Vui lòng thử lại sau.</p>
          </div>
        )}

        {!loading && !error && !unprocessed && (
          // Story 52: contain any render error in the content (e.g. a PDF/parse
          // failure) so it shows a local fallback instead of white-screening the
          // whole app. The header/tabs/close stay OUTSIDE the boundary so the
          // user can always close. Resets when a different document opens.
          <ErrorBoundary
            resetKey={documentId}
            fallback={
              <div className="dv-state dv-fallback">
                <p>
                  Không hiển thị được tài liệu này. Vui lòng thử lại hoặc tải về.
                </p>
                {onClose && (
                  <button
                    type="button"
                    className="dv-downloadbtn"
                    onClick={onClose}
                  >
                    Đóng
                  </button>
                )}
              </div>
            }
          >
            <div className="dv-content">
              {/* Tabbed (File gốc + digitized) for a PDF or a focused non-PDF
                  citation; otherwise only the original file content. */}
              {showTabs
                ? activeTab === VIEWER_TABS.ORIGINAL
                  ? renderOriginal()
                  : renderDigitized()
                : renderOriginal()}
            </div>
          </ErrorBoundary>
        )}
      </div>
    </div>
  );
}
