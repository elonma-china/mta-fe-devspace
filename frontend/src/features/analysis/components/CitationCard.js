// src/features/analysis/components/CitationCard.js
import React, { useCallback, useEffect, useRef, useState } from "react";
import "./CitationCard.css";
import "components/common/modals/share.css";
import FileOriginalView from "features/documents/components/viewer/FileOriginalView";
import { fetchDocumentFile } from "features/documents/api";
import useViewerCacheStore from "stores/useViewerCacheStore";
import useAuthStore from "stores/useAuthStore";
import useChatStore from "stores/useChatStore";

/**
 * CitationCard
 * Compact modal opened by a directive-review [n] citation chip. Wraps
 * FileOriginalView with the citation, so the cited document opens AT the
 * cited page (PDF: #page=N + yellow quote ribbon; text/docx: inline mark)
 * without swapping away the report the user is reading.
 *
 * The file blob comes through useViewerCacheStore — reopening the same
 * document (from a chip, or later from the full viewer) never refetches.
 *
 * `open` and `onClose` are injected by the global ModalRenderer.
 *
 * Props:
 * - open: boolean
 * - onClose: () => void
 * - docId: string      — reference document id
 * - docName: string    — display name (also drives FileOriginalView's kind)
 * - citation: {page?: number|null, quote?: string}
 */
export default function CitationCard({ open, onClose, docId, docName, citation }) {
  const { user } = useAuthStore();
  const { selectedConvId } = useChatStore();
  const getFile = useViewerCacheStore((s) => s.getFile);
  const backdropRef = useRef(null);
  const dialogRef = useRef(null);
  const [blob, setBlob] = useState(null);
  const [error, setError] = useState(false);

  const handleEsc = useCallback(
    (e) => {
      if (e.key === "Escape" && open) onClose?.();
    },
    [open, onClose]
  );

  useEffect(() => {
    if (!open) return undefined;
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open, handleEsc]);

  useEffect(() => {
    if (open && dialogRef.current) dialogRef.current.focus();
  }, [open]);

  useEffect(() => {
    if (!open || !docId || !user?.id || !selectedConvId) return undefined;
    let active = true;
    setBlob(null);
    setError(false);
    getFile(docId, () => fetchDocumentFile(user.id, selectedConvId, docId))
      .then((b) => {
        if (active) setBlob(b);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [open, docId, user?.id, selectedConvId, getFile]);

  if (!open) return null;

  function handleBackdropClick(e) {
    if (e.target === backdropRef.current) onClose?.();
  }

  const pageLabel = citation?.page != null ? ` — tr.${citation.page}` : "";

  return (
    <div className="modal-backdrop" ref={backdropRef} onMouseDown={handleBackdropClick}>
      <section
        className="cc-card"
        role="dialog"
        aria-label={`Trích dẫn: ${docName || ""}`}
        aria-modal="true"
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="cc-header">
          <h2 className="cc-title" title={docName}>
            {docName || "Tài liệu"}
            <span className="cc-page">{pageLabel}</span>
          </h2>
          <button type="button" className="cc-close" aria-label="Đóng" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="cc-body">
          {error ? (
            <div className="cc-error">
              <p>Không tải được tài liệu. Vui lòng thử lại sau.</p>
              {citation?.quote ? (
                <blockquote className="cc-quote">{citation.quote}</blockquote>
              ) : null}
            </div>
          ) : blob ? (
            <FileOriginalView blob={blob} name={docName} citation={citation} />
          ) : (
            <div className="dv-state">
              <span className="ds-spinner" />
              <p>Đang tải tài liệu…</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
