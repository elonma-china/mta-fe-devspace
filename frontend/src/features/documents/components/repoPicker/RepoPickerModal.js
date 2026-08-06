// src/features/documents/components/repoPicker/RepoPickerModal.js
import React, { useEffect, useMemo, useRef, useState } from "react";
import "./RepoPickerModal.css";
import { ReactComponent as X } from "assets/images/x.svg";
import useChatRepoStore from "stores/useChatRepoStore";
import { flatDocs, docsInGroup, groupState, allState } from "./repoTree";

/**
 * RepoPickerModal — "Kho tài liệu" picker on the chat screen (story 16).
 *
 * Two-column tree: left column has a search box, a "Chọn tất cả" master row,
 * the flat (ungrouped) documents, and the folders (groups); clicking a folder
 * fills the right column with its documents. Selected docs are linked into the
 * active conversation by reference on "Tải lên".
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {string} [props.unitName]  the unit shown in the title
 * @param {number} [props.unitId]    story 35: focused unit (super-admin) — scopes
 *   the repository list + import; omit for a unit user/admin (own unit).
 * @param {string|number} props.userId
 * @param {string|number} props.conversationId
 * @param {() => void} [props.onImported]  called after a successful import
 * @param {() => void} props.onClose
 */
export default function RepoPickerModal({
  open,
  unitName,
  unitId,
  userId,
  conversationId,
  onImported,
  onClose,
}) {
  const {
    groups,
    documents,
    openFolderId,
    selectedIds,
    loading,
    error,
    importing,
    searchResults,
    searching,
    searchError,
    fetchRepo,
    openFolder,
    toggleDocSelection,
    toggleFolderSelection,
    toggleSelectAll,
    importSelected,
    searchRepo,
    clearSearch,
    resetPicker,
  } = useChatRepoStore();

  const [search, setSearch] = useState("");
  const masterRef = useRef(null);

  useEffect(() => {
    if (open) {
      resetPicker();
      setSearch("");
      fetchRepo(unitId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, unitId]);

  // Story 107: debounce the query → semantic search (name + content). Below the
  // threshold (or empty) we clear results and show the 2-level tree instead.
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      clearSearch();
      return undefined;
    }
    const t = setTimeout(() => searchRepo(q, unitId), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, unitId]);

  const matches = (name) =>
    !search.trim() || name.toLowerCase().includes(search.trim().toLowerCase());

  const visibleFlat = useMemo(
    () => flatDocs(documents).filter((d) => matches(d.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [documents, search]
  );
  const rightDocs = useMemo(
    () =>
      openFolderId == null
        ? []
        : docsInGroup(documents, openFolderId).filter((d) => matches(d.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [documents, openFolderId, search]
  );

  const master = allState(selectedIds, documents);
  useEffect(() => {
    if (masterRef.current) masterRef.current.indeterminate = master === "some";
  }, [master]);

  if (!open) return null;

  const selectedSet = new Set(selectedIds.map(String));
  const hasSelection = selectedIds.length > 0;

  // Story 107: a query ≥2 chars switches the body to a flat, ranked result list
  // (name + content). On an AI error we fall back to a client-side filename
  // filter over the already-fetched docs so search still works.
  const isSearching = search.trim().length >= 2;
  const searchList = searchError
    ? documents.filter((d) => matches(d.name))
    : searchResults;

  const handleImport = async () => {
    const ok = await importSelected(userId, conversationId, unitId);
    if (ok) {
      onImported?.();
      onClose?.();
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose?.();
    }}>
      <section className="modal-shell repo-picker-shell" role="dialog">
        <div className="rp-header">
          <h2 className="modal-title" title={`Kho tài liệu - ${unitName || ""}`}>
            Kho tài liệu{unitName ? ` - ${unitName}` : ""}
          </h2>
          <button type="button" className="rp-close" onClick={onClose} aria-label="Đóng">
            <X />
          </button>
        </div>

        <div className="rp-search">
          <input
            type="text"
            placeholder="Tìm kiếm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {/* Story 95: magnifier icon on the right (Figma 841:48818). */}
          <svg
            className="rp-search-icon"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </div>

        <div className="rp-body">
          {isSearching ? (
            <div className="rp-columns rp-columns--search">
              <div className="rp-col rp-col-left">
                {searching ? (
                  <div className="rp-state">
                    <span className="ds-spinner" />
                    <p>Đang tìm kiếm…</p>
                  </div>
                ) : searchList.length === 0 ? (
                  <p className="rp-hint">Không tìm thấy tài liệu phù hợp.</p>
                ) : (
                  searchList.map((d) => (
                    <label className="rp-row" key={d.id}>
                      <input
                        type="checkbox"
                        checked={selectedSet.has(String(d.id))}
                        onChange={() => toggleDocSelection(d.id)}
                      />
                      <span className="rp-label" title={d.name}>{d.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          ) : loading ? (
            <div className="rp-state"><span className="ds-spinner" /><p>Đang tải kho tài liệu…</p></div>
          ) : error ? (
            <div className="rp-state rp-error"><p>{error}</p></div>
          ) : documents.length === 0 && groups.length === 0 ? (
            <div className="rp-state"><p>Kho đơn vị chưa có tài liệu.</p></div>
          ) : (
            <div className="rp-columns">
              <div className="rp-col rp-col-left">
                <label className="rp-row rp-master">
                  <input
                    ref={masterRef}
                    type="checkbox"
                    checked={master === "all"}
                    onChange={toggleSelectAll}
                  />
                  <span className="rp-label">Chọn tất cả</span>
                </label>

                {visibleFlat.map((d) => (
                  <label className="rp-row" key={d.id}>
                    <input
                      type="checkbox"
                      checked={selectedSet.has(String(d.id))}
                      onChange={() => toggleDocSelection(d.id)}
                    />
                    <span className="rp-label" title={d.name}>{d.name}</span>
                  </label>
                ))}

                {groups.map((g) => {
                  const st = groupState(selectedIds, documents, g.id);
                  return (
                    <div
                      className={`rp-row rp-folder ${openFolderId === g.id ? "is-open" : ""}`}
                      key={g.id}
                    >
                      <input
                        type="checkbox"
                        checked={st === "all"}
                        ref={(el) => { if (el) el.indeterminate = st === "some"; }}
                        onChange={() => toggleFolderSelection(g.id)}
                        aria-label={`Chọn nhóm ${g.name}`}
                      />
                      <button
                        type="button"
                        className="rp-folder-btn"
                        onClick={() => openFolder(g.id)}
                      >
                        {/* Story 95: folder rows are text + chevron only — no
                            folder glyph (Figma 841:48818). Reverses story 44. */}
                        <span className="rp-label" title={g.name}>
                          {g.name}
                        </span>
                        <span className="rp-chevron">›</span>
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="rp-col rp-col-right">
                {openFolderId == null ? (
                  <p className="rp-hint">Chọn một thư mục để xem tài liệu.</p>
                ) : rightDocs.length === 0 ? (
                  <p className="rp-hint">Thư mục trống.</p>
                ) : (
                  rightDocs.map((d) => (
                    <label className="rp-row" key={d.id}>
                      <input
                        type="checkbox"
                        checked={selectedSet.has(String(d.id))}
                        onChange={() => toggleDocSelection(d.id)}
                      />
                      <span className="rp-label" title={d.name}>{d.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="modal-actions rp-actions">
          <button type="button" className="btn-base btn-outline" onClick={onClose}>Huỷ bỏ</button>
          <button
            type="button"
            className="btn-base btn-filled"
            disabled={!hasSelection || importing}
            onClick={handleImport}
          >
            {importing ? "Đang thêm…" : "Tải lên"}
          </button>
        </div>
      </section>
    </div>
  );
}
