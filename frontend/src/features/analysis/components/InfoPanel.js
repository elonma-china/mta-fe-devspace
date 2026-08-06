// src/features/analysis/components/InfoPanel.js
import React, { useEffect, useMemo, useRef, useState, useCallback, Suspense, lazy } from "react";
import "./InfoPanel.css";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { ReactComponent as DeleteIcon } from "assets/images/delete.svg";
import { ReactComponent as CopyIcon } from "assets/images/copy.svg";
import { ReactComponent as DownloadIcon } from "assets/images/download.svg";
import { ReactComponent as ExpandIcon } from "assets/images/expand.svg";
import { DeleteModal } from "components/common";
import useModalStore from "stores/useModalStore";
import { exportDraftDocx, exportDirectiveReviewDocx } from "../api/tools";
import {
  downloadBlob,
  resolveTemplateId,
  selectedDocumentIds,
} from "../utils/reportExport";
import {
  reportCitationSources,
  reportCitationsFromItem,
  stripUnsupportedMarkers,
  toReportCitationLinks,
} from "../utils/citations";
import {
  directiveCitationsFromItem,
  toDirectiveCitationLinks,
  DR_CITATION_PREFIX,
} from "../utils/directiveCitations";
import SourceCard from "features/documents/components/SourceCard";
import CitationCard from "./CitationCard";
// DetachableMindmap is lazy loaded below
import { copyTextToClipboard, preprocessLaTeX } from "utils/helpers";

/** 
 * InfoPanel 
 * Props: 
 * - item: { id, type, name, content, selected?: string[], date_created?: string } 
 * - onClose: () => void 
 * - onDelete?: (id: string) => void 
*/
const DetachableMindmap = lazy(() => import("./DetachableMindmap"));

export default function InfoPanel({ item, onClose, onDelete }) {
  // Story 137: null | "ok" | "fail" — a failed copy used to be invisible.
  const [copyStatus, setCopyStatus] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [srcPopup, setSrcPopup] = useState({ open: false, srcIdx: 0, x: 0, y: 0 });
  const contentRef = useRef(null);
  const [expanded, setExpanded] = useState(true); // drives DetachableMindmap modal
  const containerRef = useRef(null);
  const { showModal, hideModal } = useModalStore();

  const meta = useMemo(() => {
    if (!item) return { title: "Chi tiết", docCount: 0, date: null, type: "" };
    const docIds = selectedDocumentIds(item.selected);
    return {
      type: item.type,
      title: item.name || "(không tên)",
      docCount: docIds.length,
      date: item.date_created ? new Date(item.date_created) : null,
    };
  }, [item]);

  const reportSources = useMemo(() => reportCitationSources(item), [item]);

  const reportMarkdown = useMemo(() => {
    if (!item?.content || meta.type !== "report") {
      return preprocessLaTeX(item?.content) || "";
    }
    // Reports stored before the backend stopped emitting it still carry `[?]`.
    const raw = stripUnsupportedMarkers(preprocessLaTeX(item.content));
    return toReportCitationLinks(raw, reportCitationsFromItem(item));
  }, [item, meta.type]);

  // ── Directive-review citation chips ─────────────────────────────────
  // The review's markdown carries bare [n] markers that agree with the
  // persisted selected.citations lookup (see utils/directiveCitations.js).
  // Rewrite the known ones into chip links; items completed before the
  // lookup existed keep plain-text markers (empty map → no rewrite).
  const directiveCitations = useMemo(
    () =>
      meta.type === "directive_review"
        ? directiveCitationsFromItem(item)
        : new Map(),
    [item, meta.type]
  );

  const directiveMarkdown = useMemo(() => {
    if (meta.type !== "directive_review" || !item?.content) {
      return preprocessLaTeX(item?.content) || "";
    }
    return toDirectiveCitationLinks(
      preprocessLaTeX(item.content),
      directiveCitations
    );
  }, [item, meta.type, directiveCitations]);

  const directiveMarkdownComponents = useMemo(
    () => ({
      a: ({ href, children }) => {
        if (href?.startsWith(DR_CITATION_PREFIX)) {
          const marker = parseInt(href.slice(DR_CITATION_PREFIX.length), 10);
          const c = directiveCitations.get(marker);
          if (c) {
            return (
              <button
                type="button"
                className="ci-src-chip"
                onClick={() =>
                  // Compact card over the report (the report stays visible
                  // behind it) — deliberately NOT the full viewer panel swap.
                  showModal(CitationCard, {
                    docId: c.doc_id,
                    docName: c.doc_name,
                    citation: { page: c.page ?? null, quote: c.quote || "" },
                  })
                }
              >
                {children}
              </button>
            );
          }
        }
        return (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        );
      },
    }),
    [directiveCitations, showModal]
  );

  const openReportSourceCard = useCallback((srcIdx, e) => {
    e?.preventDefault?.();
    setSrcPopup({ open: true, srcIdx, x: e.clientX, y: e.clientY });
  }, []);

  const closeSourceCard = useCallback(() => {
    setSrcPopup((p) => ({ ...p, open: false }));
  }, []);

  useEffect(() => {
    if (!srcPopup.open) return undefined;
    const onKey = (ev) => {
      if (ev.key === "Escape") closeSourceCard();
    };
    const onClick = (ev) => {
      if (
        !ev.target.closest?.(".ci-src-card") &&
        !ev.target.closest?.(".ci-src-chip")
      ) {
        closeSourceCard();
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [srcPopup.open, closeSourceCard]);

  const reportMarkdownComponents = useMemo(
    () => ({
      a: ({ href, children }) => {
        if (href?.startsWith("#report-source-")) {
          const marker = parseInt(href.replace("#report-source-", ""), 10);
          const idx = reportSources.findIndex((s) => s.marker === marker);
          const srcIdx = idx >= 0 ? idx : Math.max(0, marker - 1);
          return (
            <button
              type="button"
              className="ci-src-chip"
              onClick={(e) => openReportSourceCard(srcIdx, e)}
            >
              {children}
            </button>
          );
        }
        return (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        );
      },
    }),
    [reportSources, openReportSourceCard]
  );

  const copyContent = useCallback(async () => {
    if (!item) return;
    // Copy what the reader sees: the on-screen render (above) and the DOCX
    // payload (below) both drop the legacy `[?]` marker from stored reports,
    // so the clipboard agrees with them instead of pasting a third variant.
    const text =
      meta.type === "report"
        ? stripUnsupportedMarkers(item.content || "")
        : item.content || "";
    if (!text) return;

    const ok = await copyTextToClipboard(text);
    setCopyStatus(ok ? "ok" : "fail");
    setTimeout(() => setCopyStatus(null), 1200);
  }, [item, meta.type]);

  const exportDocx = useCallback(async () => {
    if (!item?.content || meta.type !== "report") return;
    setExporting(true);
    try {
      const templateId = resolveTemplateId(item);
      const payload = {
        draft_markdown: stripUnsupportedMarkers(item.content),
        template_id: templateId,
      };
      if (Array.isArray(item?.selected?.citations)) {
        payload.citations = item.selected.citations;
      }
      // The server names the file; a title-derived name loses its diacritics.
      const { blob, filename } = await exportDraftDocx(payload);
      downloadBlob(blob, filename || `${templateId}.docx`);
    } catch (e) {
      console.error("DOCX export failed:", e);
    } finally {
      setExporting(false);
    }
  }, [item, meta.type]);

  const exportDirectiveReview = useCallback(async () => {
    if (!item?.content || meta.type !== "directive_review") return;
    setExporting(true);
    try {
      // One fixed 3-section report shape — no template_id, and no citations
      // field: the markdown already carries its own "Nguồn trích dẫn" appendix.
      const { blob, filename } = await exportDirectiveReviewDocx({
        report_markdown: item.content,
      });
      downloadBlob(blob, filename || "rasoat.docx");
    } catch (e) {
      console.error("Directive review DOCX export failed:", e);
    } finally {
      setExporting(false);
    }
  }, [item, meta.type]);

  const handleDelete = useCallback(() => {
    if (!item?.id || !onDelete) return;
    showModal(DeleteModal, {
      title: "Xoá mục phân tích",
      message: `Bạn chắc chắn muốn xoá "${meta.title}"? Hành động này không thể hoàn tác.`,
      cancelLabel: "Huỷ",
      confirmLabel: "Đồng ý",
      onConfirm: () => {
        onDelete(item.id);
        hideModal();
      }
    });
  }, [item, onDelete, showModal, hideModal, meta.title]);

  const dispatchCompose = useCallback(({ current, parent }) => {
    const text = `Thảo luận trong những nguồn này cho biết thông tin gì về "${current}", trong bối cảnh rộng hơn "${parent}"`;
    // Defer to next tick so we don’t block d3-zoom’s click/gesture handling
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("im-compose", {
          detail: { 
            text, 
            source: "mindmap", 
            node: current, 
            parent, 
            timestamp: Date.now(),
            documentIds: selectedDocumentIds(item?.selected),
          },
        })
      );
    }, 0);
  }, [item?.selected]);

  const onKeyDown = useCallback((e) => {
    const isMod = e.metaKey || e.ctrlKey;
    const key = e.key?.toLowerCase?.();

    const ae = document.activeElement;
    if (ae && (
      ae.tagName === "INPUT" ||
      ae.tagName === "TEXTAREA" ||
      ae.isContentEditable
    )) return;

    if (!containerRef.current?.contains(ae)) return;

    if (key === "escape") {
      e.preventDefault();
      onClose?.();
      return;
    }

    if (isMod && key === "c") {
      const sel = window.getSelection?.();
      if (sel && !sel.isCollapsed) return;
      e.preventDefault();
      copyContent();
      return;
    }

    if (isMod && key === "e" && meta.type === "mindmap") {
      e.preventDefault();
      setExpanded(v => !v);
    }
  }, [onClose, copyContent, meta.type]);

  if (!item) {
    return (
      <div className="info-panel">
        <div className="ip-header">
          <button className="ip-btn" onClick={onClose} aria-label="Quay lại">
            ← Quay lại
          </button>
          <div className="ip-title">(không có dữ liệu)</div>
          <div className="ip-actions" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="info-panel" ref={containerRef} tabIndex={0} onKeyDown={onKeyDown} >
        <div className="ip-header">
          <button className="ip-btn" onClick={onClose} aria-label="Quay lại phân tích">
            ← Quay lại
          </button>

          <div className="ip-title" title={meta.title}>
            {meta.title}
          </div>

          <div className="ip-actions">
            {meta.type === "mindmap" && (
              <ExpandIcon
                onClick={() => setExpanded((v) => !v)}
                aria-label="Mở rộng"
                title="Mở rộng"
              />
            )}
            {meta.type === "report" && (
              <DownloadIcon
                onClick={exporting ? undefined : exportDocx}
                aria-label="Tải DOCX"
                title={exporting ? "Đang xuất..." : "Tải DOCX"}
                style={exporting ? { opacity: 0.5, pointerEvents: "none" } : undefined}
              />
            )}
            {meta.type === "directive_review" && (
              <DownloadIcon
                onClick={exporting ? undefined : exportDirectiveReview}
                aria-label="Tải DOCX"
                title={exporting ? "Đang xuất..." : "Tải DOCX"}
                style={exporting ? { opacity: 0.5, pointerEvents: "none" } : undefined}
              />
            )}
            {copyStatus && (
              <span
                className={`ip-copy-status ip-copy-status--${copyStatus}`}
                role="status"
              >
                {copyStatus === "ok" ? "Đã sao chép" : "Không sao chép được"}
              </span>
            )}
            <CopyIcon
              onClick={copyContent}
              aria-label="Sao chép nội dung"
              title="Sao chép"
            />
            {onDelete && (
              <DeleteIcon
                onClick={handleDelete}
                aria-label="Xoá"
                title="Xoá"
              />
            )}
          </div>
        </div>

        {(meta.docCount || meta.date) && (
          <div className="ip-submeta">
            {meta.docCount ? <span>{meta.docCount} tài liệu</span> : null}
            {meta.docCount && meta.date ? <span className="ip-dot">•</span> : null}
            {meta.date ? <span>{meta.date.toLocaleString()}</span> : null}
          </div>
        )}

        <div className="ip-content" ref={contentRef}>
          {meta.type === "mindmap" ? (
            <Suspense fallback={<div className="ip-loading">Đang tải...</div>}>
              <DetachableMindmap
                markdown={item.content || "# (trống)"}
                title={meta.title || "Mindmap"}
                expanded={expanded}
                onClose={() => setExpanded(false)}
                compactHeight={500}
                onNodeClick={dispatchCompose}
              />
            </Suspense>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeHighlight, rehypeRaw, rehypeKatex]}
              components={
                meta.type === "report"
                  ? reportMarkdownComponents
                  : meta.type === "directive_review"
                  ? directiveMarkdownComponents
                  : undefined
              }
            >
              {meta.type === "report"
                ? reportMarkdown || "_(trống)_"
                : meta.type === "directive_review"
                ? directiveMarkdown || "_(trống)_"
                : preprocessLaTeX(item.content) || "_(trống)_"}
            </ReactMarkdown>
          )}
        </div>
      </div>
      {srcPopup.open && reportSources[srcPopup.srcIdx] ? (
        <SourceCard
          srcPopup={srcPopup}
          srcIdx={srcPopup.srcIdx}
          closeSourceCard={closeSourceCard}
          src={reportSources[srcPopup.srcIdx]}
        />
      ) : null}
    </>
  );
}
