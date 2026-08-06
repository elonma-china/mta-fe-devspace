// src/features/documents/components/DocumentSelect.js
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import "./DocumentSelect.css";
import { ReactComponent as MoreVert } from "assets/images/more-vert.svg";
import { ActionMenu } from "components";
import { AlertModal, DeleteModal, EditModal, PreviewModal } from "components/common";
import useModalStore from "stores/useModalStore";
import { PROCESSING_STATUS, UPSTREAM_STATUS } from "constants/status";
import { getDocumentTaskStatus, updateDocumentStatus, unlinkRepositoryDoc } from "../api";
import { useTaskPoller } from "hooks/useTaskPoller";
import useAuthStore from "stores/useAuthStore";
import useChatStore from "stores/useChatStore";
import useDocumentStore from "stores/useDocumentStore";
import { isRepoSuperAdmin } from "lib/roles";

export default function DocumentSelect({
  selectAllLabel = "Chọn tất cả các tài liệu",
  onPreview,
}) {
  const { user } = useAuthStore();
  const userId = user?.id;
  // Story 35: a super-admin links repo docs from multiple units, so show each
  // repo doc's source unit. Unit users/admins never see the tag. Story 68: the
  // commander role browses multiple units' repos too → also show the tag.
  const showUnitTag = isRepoSuperAdmin(user);
  const { selectedConvId: conversationId } = useChatStore();

  // ── Document store ──
  const {
    documents,
    selectedDocumentIds: selectedIds,
    setSelectedDocumentIds: onChange,
    pollingTasks,
    pending,
    fetchDocuments,
    updateDocumentStatus: storeUpdateStatus,
    completePolling,
    deleteDocument,
    renameDocument,
    connectSSE,
    disconnectSSE,
    sseFallback,
  } = useDocumentStore();

  const { showModal, hideModal } = useModalStore();

  // ── Fetch on mount / conversation change ──
  useEffect(() => {
    let cancelled = false;
    const doFetch = async () => {
      const result = await fetchDocuments(userId, conversationId);
      if (cancelled) return;
      // `missing_count`, not `missingCount` — the gateway passes the sync result
      // through as a plain dict, so it keeps its Python spelling. Reading the
      // camelCase name gave `undefined > 0`, which is false, so this modal never
      // once fired: `visibleItems` below hides every ERROR row, and the only
      // explanation for why a document vanished was silently skipped.
      const missing = result?.syncResult?.missing_count;
      if (missing > 0) {
        showModal(AlertModal, {
          title: "Tài liệu bị thiếu",
          message: `Hệ thống phát hiện ${missing} tài liệu bị lỗi hoặc không còn tồn tại trên máy chủ AI, và đã tự động ngừng hiển thị các tài liệu này.`,
        });
      }
    };
    doFetch();
    return () => { cancelled = true; };
  }, [userId, conversationId, fetchDocuments, showModal]);

  // ── SSE connection management ──
  // Derive processing doc IDs to decide when to connect/disconnect
  const processingDocIds = useMemo(
    () =>
      documents
        .filter((d) => {
          const st = d.status?.toUpperCase();
          return (
            st === PROCESSING_STATUS.PROCESSING ||
            st === PROCESSING_STATUS.PENDING
          );
        })
        .map((d) => String(d.id)),
    [documents],
  );

  useEffect(() => {
    if (!userId || !conversationId) return;
    if (processingDocIds.length === 0) {
      disconnectSSE();
      return;
    }
    // Open SSE only when there are processing docs
    connectSSE(userId, conversationId, processingDocIds);

    return () => {
      disconnectSSE();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, conversationId, processingDocIds.join(",")]);

  // ── Fallback: polling via useTaskPoller (only when SSE fails) ──
  const handlePollComplete = useCallback(
    async (docId, result) => {
      const { selectedConvId: currentConvId } = useChatStore.getState();
      if (!currentConvId) return;
      try {
        await updateDocumentStatus(userId, currentConvId, docId, {
          status: PROCESSING_STATUS.COMPLETED,
          chunk_count: result?.result?.chunk_count || 0,
          task_id: null,
        });
      } catch (e) {
        console.error("Failed to persist final status", e);
      }
      storeUpdateStatus(docId, PROCESSING_STATUS.COMPLETED, result?.result || {});
      completePolling(docId);
    },
    [userId, storeUpdateStatus, completePolling]
  );

  const handlePollError = useCallback(
    async (docId, result) => {
      const { selectedConvId: currentConvId } = useChatStore.getState();
      if (!currentConvId) return;

      const storeDocs = useDocumentStore.getState().documents;
      const doc = storeDocs.find((d) => String(d.id) === String(docId));
      const docName = doc?.name || "không rõ tên";
      const errorMsg = result?.message || result?.error || "Không xác định";

      try {
        await updateDocumentStatus(userId, currentConvId, docId, {
          status: PROCESSING_STATUS.ERROR,
          task_id: null,
        });
      } catch (e) {
        console.error("Failed to persist error status", e);
      }
      storeUpdateStatus(docId, PROCESSING_STATUS.ERROR, { error: errorMsg });
      completePolling(docId);

      showModal(AlertModal, {
        title: "Lỗi xử lý tài liệu",
        message: `Tài liệu "${docName}" đã gặp lỗi trong quá trình xử lý: ${errorMsg}.`,
      });
    },
    [userId, storeUpdateStatus, completePolling, showModal]
  );

  // Only activate polling when SSE has fallen back
  useTaskPoller(sseFallback ? pollingTasks : {}, {
    checkStatus: (taskId, meta) => {
      const ts = meta.createdAt ? new Date(meta.createdAt).getTime() : Date.now();
      return getDocumentTaskStatus(taskId, ts);
    },
    onComplete: handlePollComplete,
    onError: handlePollError,
  });

  // Track how many times we've polled for no-task-id docs
  const noTaskIdRetryRef = useRef(0);
  const MAX_NO_TASKID_RETRIES = 500; // ~1500 seconds at 3s intervals

  // Reset retry counter when the processing set changes (e.g. new upload)
  const noTaskIdDocIds = useMemo(
    () =>
      documents
        .filter((d) => {
          const st = d.status?.toUpperCase();
          return (
            (st === PROCESSING_STATUS.PROCESSING || st === PROCESSING_STATUS.PENDING) &&
            !d.task_id
          );
        })
        .map((d) => String(d.id))
        .sort()
        .join(","),
    [documents]
  );

  const prevNoTaskIdDocIdsRef = useRef(noTaskIdDocIds);
  useEffect(() => {
    if (noTaskIdDocIds !== prevNoTaskIdDocIdsRef.current) {
      noTaskIdRetryRef.current = 0;
      prevNoTaskIdDocIdsRef.current = noTaskIdDocIds;
    }
  }, [noTaskIdDocIds]);

  useEffect(() => {
    if (!noTaskIdDocIds || !userId || !conversationId) return;

    const refetchInterval = setInterval(() => {
      noTaskIdRetryRef.current += 1;

      if (noTaskIdRetryRef.current > MAX_NO_TASKID_RETRIES) {
        // Stop polling — mark stuck docs as ERROR
        clearInterval(refetchInterval);
        const stuckIds = noTaskIdDocIds.split(",").filter(Boolean);

        const storeDocs = useDocumentStore.getState().documents;
        const stuckDocs = storeDocs.filter((d) => stuckIds.includes(String(d.id)));
        const docNames = stuckDocs.map((d) => `"${d.name}"`).join(", ") || "tài liệu";

        stuckIds.forEach((docId) => {
          storeUpdateStatus(docId, PROCESSING_STATUS.ERROR, {
            error: "Tài liệu bị kẹt – không nhận được task_id sau thời gian chờ.",
          });
        });
        console.warn("[DocumentSelect] Stopped no-task-id polling after max retries. Stuck docs:", stuckIds);

        showModal(AlertModal, {
          title: "Lỗi xử lý tài liệu",
          message: `Các tài liệu sau đã bị kẹt và không nhận được phản hồi từ hệ thống: ${docNames}.`,
        });
        return;
      }

      fetchDocuments(userId, conversationId);
    }, 3000);

    return () => clearInterval(refetchInterval);
  }, [noTaskIdDocIds, userId, conversationId, fetchDocuments, storeUpdateStatus, showModal]);

  // ── Selection logic ──

  const visibleItems = useMemo(
    () =>
      documents.filter((it) => {
        const status = it.status?.toUpperCase();
        return status !== PROCESSING_STATUS.ERROR && status !== UPSTREAM_STATUS.FAILURE;
      }),
    [documents]
  );

  const selectedSet = useMemo(
    () => new Set((selectedIds || []).map(String)),
    [selectedIds]
  );

  const allIds = useMemo(() => visibleItems.map((it) => String(it.id)), [visibleItems]);
  const total = visibleItems.length;

  const visibleSelectedCount = visibleItems.filter(
    (it) => selectedSet.has(String(it.id))
  ).length;
  const allChecked = total > 0 && visibleSelectedCount === total;
  const noneChecked = visibleSelectedCount === 0;
  const someChecked = !noneChecked && !allChecked;

  const masterRef = useRef(null);
  useEffect(() => {
    if (masterRef.current) masterRef.current.indeterminate = someChecked;
  }, [someChecked]);

  const toggleAll = () => {
    if (allChecked) onChange([]);
    else onChange(allIds);
  };

  const toggleOne = (id) => {
    const strId = String(id);
    const next = new Set(selectedSet);
    if (next.has(strId)) next.delete(strId);
    else next.add(strId);
    onChange(Array.from(next));
  };

  // ── Menu logic ──
  // Story 98: `type` distinguishes a per-doc menu ("doc") from the folder/group
  // menu ("folder", carrying groupId). Doc branch behaviour is unchanged.
  const [menu, setMenu] = useState({ open: false, type: "doc", id: null, groupId: null, x: 0, y: 0 });

  const menuPos = (evt) => {
    const rect = evt.currentTarget.getBoundingClientRect();
    const menuWidth = 157;
    const left = Math.min(window.innerWidth - menuWidth - 8, Math.max(8, rect.right - menuWidth));
    const top = Math.min(window.innerHeight - 8 - 104, rect.bottom + 6);
    return { x: left, y: top };
  };

  const openMenu = (evt, id) => {
    setMenu({ open: true, type: "doc", id, groupId: null, ...menuPos(evt) });
  };

  const openFolderMenu = (evt, groupId) => {
    setMenu({ open: true, type: "folder", id: null, groupId, ...menuPos(evt) });
  };

  const closeMenu = () => setMenu((m) => ({ ...m, open: false }));

  // Story 19: the open menu belongs to a repository (referenced) doc → show
  // "Gỡ khỏi hội thoại" and hide "Sửa tên".
  const menuDocIsRepo = !!visibleItems.find(
    (d) => String(d.id) === String(menu.id),
  )?.from_repository;

  // Story 98/99: folder/group menu — a single unified action: remove every repo
  // doc in the group from the conversation (reuses the per-doc unlink API in a
  // loop; the repository copies stay). Story 99 removed the group-rename action:
  // renaming from chat hit the group's owning-unit scope and 404'd; group rename
  // lives on the admin screen where the scope is correct.
  const handleFolderAction = (action) => {
    const g = repoGroups.find((x) => String(x.groupId) === String(menu.groupId));
    if (!g) return closeMenu();

    if (action === "delete") {
      showModal(DeleteModal, {
        title: "Gỡ toàn bộ khỏi hội thoại",
        message: `Gỡ toàn bộ ${g.items.length} tài liệu của nhóm "${g.groupName}" khỏi hội thoại? Kho gốc giữ nguyên.`,
        cancelLabel: "Huỷ",
        confirmLabel: "Đồng ý",
        onConfirm: async () => {
          try {
            if (!userId || !conversationId) return;
            for (const it of g.items) {
              await unlinkRepositoryDoc(userId, conversationId, it.id);
            }
            await fetchDocuments(userId, conversationId);
            hideModal();
          } catch (err) {
            console.error("Bulk unlink failed:", err);
            // Refetch so already-unlinked docs disappear even on partial failure.
            await fetchDocuments(userId, conversationId);
            showModal(AlertModal, {
              title: "Lỗi",
              message: err.message || "Không thể gỡ toàn bộ tài liệu khỏi hội thoại.",
            });
          }
        },
      });
    }
    closeMenu();
  };

  const handleMenuAction = (action) => {
    if (menu.type === "folder") return handleFolderAction(action);

    const doc = visibleItems.find((d) => String(d.id) === String(menu.id));
    if (!doc) return closeMenu();

    if (action === "preview") {
      // Story 15: open the split-pane Document Viewer in the chat's right
      // column (replaces "Bảng thông tin" while viewing). Falls back to the
      // legacy text PreviewModal when no host callback is provided (keeps the
      // component usable standalone / in other hosts).
      if (onPreview) {
        onPreview({ id: doc.id, name: doc.name });
      } else {
        showModal(PreviewModal, {
          documentId: doc.id,
          documentName: doc.name,
          userId,
          conversationId,
        });
      }
    }
    if (action === "rename") {
      showModal(EditModal, {
        title: "Đổi tên tài liệu",
        label: "Tên mới",
        placeholder: "Nhập tên mới…",
        initialValue: doc.name || "",
        maxLength: 200,
        onConfirm: async (newName) => {
          try {
            if (!userId || !conversationId) return;
            await renameDocument(userId, conversationId, doc.id, newName);
            hideModal();
          } catch (err) {
            console.error("Rename failed:", err);
            showModal(AlertModal, {
              title: "Lỗi",
              message: err.message || "Không thể đổi tên tài liệu.",
            });
          }
        },
      });
    }
    if (action === "delete") {
      // Story 19: a repository document is referenced, not owned by this
      // conversation — "deleting" it only unlinks it from the conversation; the
      // repository copy stays. Self-uploaded docs are deleted as before.
      const isRepo = !!doc.from_repository;
      showModal(DeleteModal, {
        title: isRepo ? "Gỡ khỏi hội thoại" : "Xoá tài liệu",
        message: isRepo
          ? `Gỡ tài liệu "${doc.name || ""}" khỏi hội thoại? Tài liệu vẫn còn trong kho.`
          : `Xoá tài liệu "${doc.name || ""}"? Hành động không thể hoàn tác.`,
        cancelLabel: "Huỷ",
        confirmLabel: "Đồng ý",
        onConfirm: async () => {
          try {
            if (!userId || !conversationId) return;
            if (isRepo) {
              await unlinkRepositoryDoc(userId, conversationId, doc.id);
              await fetchDocuments(userId, conversationId);
            } else {
              await deleteDocument(userId, conversationId, doc.id);
            }
            hideModal();
          } catch (err) {
            console.error("Delete/unlink failed:", err);
            showModal(AlertModal, {
              title: "Lỗi",
              message: err.message || (isRepo
                ? "Không thể gỡ tài liệu khỏi hội thoại."
                : "Không thể xoá tài liệu."),
            });
          }
        },
      });
    }
    closeMenu();
  };

  // ── Story 33: split documents into the two Figma sections + repo folders ──
  // "Tài liệu của tôi" = self-uploaded (no from_repository); "Kho tài liệu" =
  // repository docs, with grouped docs nested under an expandable folder named
  // by their group. Selection/menu/spinner behaviour is unchanged — this only
  // changes how the same `visibleItems` are laid out.
  const mineItems = useMemo(
    () => visibleItems.filter((it) => !it.from_repository),
    [visibleItems],
  );
  const repoItems = useMemo(
    () => visibleItems.filter((it) => it.from_repository),
    [visibleItems],
  );
  const repoFlat = useMemo(
    () => repoItems.filter((it) => !it.group_id),
    [repoItems],
  );
  const repoGroups = useMemo(() => {
    const byId = new Map();
    for (const it of repoItems) {
      if (!it.group_id) continue;
      const key = String(it.group_id);
      if (!byId.has(key)) {
        byId.set(key, {
          groupId: key,
          groupName: it.group_name || "Nhóm tài liệu",
          items: [],
        });
      }
      byId.get(key).items.push(it);
    }
    return Array.from(byId.values());
  }, [repoItems]);

  // Folders default to OPEN; we track the collapsed set so "open" needs no init.
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const toggleGroupOpen = (groupId) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });

  const toggleGroupSelect = (items) => {
    const ids = items.map((it) => String(it.id));
    const allSel = ids.every((id) => selectedSet.has(id));
    const next = new Set(selectedSet);
    if (allSel) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
    onChange(Array.from(next));
  };

  const pendingVisible = pending.filter(
    (p) => !documents.some((d) => d.name === p.name),
  );

  // Shared row renderer — same markup for mine / repo-flat / folder children so
  // the checkbox/spinner/menu logic lives in one place.
  const renderRow = (it, nested = false) => {
    const checked = selectedSet.has(String(it.id));
    const status = it.status?.toUpperCase();
    // Story 19: repository docs are ready immediately — never spinner.
    const isProcessing =
      !it.from_repository &&
      (status === PROCESSING_STATUS.PROCESSING ||
        status === PROCESSING_STATUS.PENDING ||
        status === PROCESSING_STATUS.UPLOADED);

    return (
      <div className={`ds-row${nested ? " ds-row-nested" : ""}`} key={it.id}>
        <label className="ds-checkwrap">
          {isProcessing ? (
            <span className="ds-state">
              <span className="ds-spinner" />
            </span>
          ) : (
            <span className="ds-state">
              <input
                type="checkbox"
                className="ds-checkbox"
                checked={!!checked}
                onChange={() => toggleOne(it.id)}
              />
              <span className="ds-box" />
            </span>
          )}
        </label>
        <div className="ds-rightgroup">
          <div className="ds-namecol">
            <div className="ds-filename" title={it.name}>
              {it.name}
            </div>
            {showUnitTag && it.from_repository && it.unit_name && (
              <div className="ds-unit-tag" title={it.unit_name}>
                {it.unit_name}
              </div>
            )}
          </div>
          <button
            type="button"
            className={`ds-morebtn ${isProcessing ? "ds-morebtn-disabled" : ""}`}
            disabled={isProcessing}
            aria-label={`More actions for ${it.name}`}
            onClick={(e) => openMenu(e, it.id)}
          >
            <MoreVert className="ds-moreicon" />
          </button>
        </div>
      </div>
    );
  };

  const renderFolder = (g) => {
    const ids = g.items.map((it) => String(it.id));
    const selCount = ids.filter((id) => selectedSet.has(id)).length;
    const allSel = ids.length > 0 && selCount === ids.length;
    const someSel = selCount > 0 && !allSel;
    const open = !collapsedGroups.has(g.groupId);
    return (
      <div className="ds-folder" key={`g-${g.groupId}`}>
        <div className="ds-row ds-folder-row">
          <label className="ds-checkwrap">
            <span className="ds-state">
              <input
                type="checkbox"
                className="ds-checkbox"
                checked={allSel}
                ref={(el) => {
                  if (el) el.indeterminate = someSel;
                }}
                aria-checked={someSel ? "mixed" : allSel ? "true" : "false"}
                onChange={() => toggleGroupSelect(g.items)}
              />
              <span className="ds-box" />
            </span>
          </label>
          <button
            type="button"
            className="ds-folder-toggle"
            aria-expanded={open}
            aria-label={`Thư mục ${g.groupName}`}
            onClick={() => toggleGroupOpen(g.groupId)}
          >
            <svg
              className="ds-folder-icon"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
            <span className="ds-folder-name" title={g.groupName}>
              {g.groupName}
            </span>
            <span className={`ds-folder-caret${open ? " is-open" : ""}`} />
          </button>
          {/* Story 98: folder ⋮ menu (rename group [admin] + remove-all). Sibling
              of the toggle (no nested buttons) → aligns with the doc-row ⋮. */}
          <button
            type="button"
            className="ds-morebtn ds-folder-more"
            aria-label={`Thao tác nhóm ${g.groupName}`}
            onClick={(e) => openFolderMenu(e, g.groupId)}
          >
            <MoreVert className="ds-moreicon" />
          </button>
        </div>
        {open && (
          <div className="ds-folder-children">
            {g.items.map((it) => renderRow(it, true))}
          </div>
        )}
      </div>
    );
  };

  const hasMine = mineItems.length > 0 || pendingVisible.length > 0;
  const hasRepo = repoItems.length > 0;

  return (
    <div className="document-select">
      {/* Row: Select all */}
      <div className="ds-row">
        <label className="ds-checkwrap">
          <span className="ds-state">
            <input
              ref={masterRef}
              type="checkbox"
              className="ds-checkbox"
              checked={allChecked}
              onChange={toggleAll}
              aria-checked={someChecked ? "mixed" : allChecked ? "true" : "false"}
              disabled={total === 0}
            />
            <span className="ds-box" />
          </span>
        </label>
        <div className="ds-rightgroup">
          <div className="ds-title">{selectAllLabel}</div>
        </div>
      </div>

      <div className="ds-document-list">
        {/* Section: Tài liệu của tôi (self-uploaded) */}
        {hasMine && (
          <>
            <div className="ds-section-title">Tài liệu của tôi</div>
            {mineItems.map((it) => renderRow(it))}

            {/* Pending uploads (_pending placeholders) belong with my docs. */}
            {pendingVisible.map((it) => (
              <div className="ds-row ds-row-pending" key={it.id}>
                <div className="ds-checkwrap">
                  <span className="ds-state">
                    <span className="ds-spinner" aria-hidden="true" />
                  </span>
                </div>
                <div className="ds-rightgroup">
                  <div className="ds-filename" title={it.name}>
                    {it.name}
                  </div>
                  <button
                    type="button"
                    className="ds-morebtn ds-morebtn-disabled"
                    disabled
                    aria-label={`Đang tải ${it.name}`}
                  >
                    <MoreVert className="ds-moreicon" />
                  </button>
                </div>
              </div>
            ))}
          </>
        )}

        {/* Section: Kho tài liệu (repository docs) — flat docs + folders */}
        {hasRepo && (
          <>
            <div className="ds-section-title">Kho tài liệu</div>
            {repoFlat.map((it) => renderRow(it))}
            {repoGroups.map((g) => renderFolder(g))}
          </>
        )}
      </div>

      <ActionMenu
        open={menu.open}
        x={menu.x}
        y={menu.y}
        onAction={handleMenuAction}
        onClose={closeMenu}
        {...(menu.type === "folder"
          ? {
              // Story 99: folder menu is unified — remove-all only, no rename.
              showPreview: false,
              showRename: false,
              deleteLabel: "Gỡ toàn bộ khỏi hội thoại",
            }
          : menuDocIsRepo
            ? { showRename: false, deleteLabel: "Gỡ khỏi hội thoại" }
            : {})}
      />
    </div>
  );
}
