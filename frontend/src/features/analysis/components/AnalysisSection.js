// src/features/analysis/components/AnalysisSection.js
import React, { useMemo, useRef, useState, useCallback, useEffect } from "react";
import "./AnalysisSection.css";
import { AlertModal, DeleteModal } from "components/common";
import useModalStore from "stores/useModalStore";
import { PROCESSING_STATUS, UPSTREAM_STATUS } from "constants/status";
import { ReactComponent as SummaryIcon } from "assets/images/summary.svg";
import { ReactComponent as MindmapIcon } from "assets/images/mindmap.svg";
import { ReactComponent as ReportIcon } from "assets/images/report.svg";
import { ReactComponent as DeleteIcon } from "assets/images/delete.svg";
import { InfoPanel, TemplatePickerModal, DraftUploadModal } from ".";
import {
  getSummaryStatus,
  getMindmapStatus,
  getDraftStatus,
  getDirectiveReviewStatus,
} from "../api";
import { updateConversationInfo } from "../api";
import { appendCitations, mergeReportSelected } from "../utils/citations";
import { flattenDirectiveCitations } from "../utils/directiveCitations";
import { formatTimestampVi } from "utils/helpers";
import { useTaskPoller } from "hooks/useTaskPoller";
import useAuthStore from "stores/useAuthStore";
import useChatStore from "stores/useChatStore";
import useDocumentStore from "stores/useDocumentStore";
import useAnalysisStore from "stores/useAnalysisStore";

const MAX_REPORT_DOCS = 50;

// The AI service caps reference_document_ids at 10 (DirectiveReviewSubmitOptions
// max_length) — deliberately NOT MAX_REPORT_DOCS.
export const MAX_REFERENCE_DOCS = 10;

// We omit startTime when polling directive-review status (it would trip the
// backend's zombie check and rewrite a successful report into a FAILURE — see
// api/tools.js). That also means the backend applies no stuck-task ceiling, so
// enforce one here instead.
export const DIRECTIVE_REVIEW_MAX_WAIT_MS = 45 * 60 * 1000; // 45 min

/** Markdown for a completed task, per item type. */
export function contentForResult(itemType, result) {
  if (itemType === "summary") return result?.summary;
  if (itemType === "mindmap") return result?.mindmap;
  if (itemType === "report") return result?.draft_markdown;
  if (itemType === "directive_review") return result?.report_markdown;
  return undefined;
}

/**
 * A refusal is a SUCCESSFUL task with no report — an empty draft, or reference
 * documents with no indexed content. It arrives as HTTP 200 with refused:true,
 * so it must be detected explicitly or it renders as a blank report.
 */
export function isRefused(result) {
  return result?.refused === true;
}

/** True once a review has been polling past the client-side ceiling. */
export function isPollExpired(startedAtMs, nowMs = Date.now()) {
  return nowMs - startedAtMs > DIRECTIVE_REVIEW_MAX_WAIT_MS;
}

export default function AnalysisSection({ onCreated, onRemoved }) {
  const { user } = useAuthStore();
  const userId = user?.id;
  const { selectedConvId: conversationId } = useChatStore();
  const { selectedDocumentIds, documents: docsState } = useDocumentStore();

  // ── Analysis store ──
  const {
    items,
    pending,
    selectedInfo,
    pollingTasks,
    fetchItems,
    generate,
    deleteItem,
    selectInfo,
    clearSelection,
    updateItemContent,
    updateItem,
    completePolling,
  } = useAnalysisStore();

  const { showModal, hideModal } = useModalStore();

  // animType is purely UI animation state — stays local
  const [animType, setAnimType] = useState(null);

  const typeMap = useMemo(
    () => ({
      summary: { icon: <SummaryIcon />, label: "Tóm tắt" },
      mindmap: { icon: <MindmapIcon />, label: "Bản đồ tư duy" },
      // Story 136: `label` is the card's verb ("Sinh văn bản"); `errorLabel` is
      // the noun used in "Không thể tạo <noun>" so the error copy reads naturally.
      report: { icon: <ReportIcon />, label: "Sinh văn bản", errorLabel: "Văn bản" },
      directive_review: { icon: <ReportIcon />, label: "Rà soát dự thảo" },
    }),
    []
  );

  const contentFor = useCallback(
    (itemType, result) => contentForResult(itemType, result),
    []
  );

  // ── Fetch on conversation change ──
  useEffect(() => {
    fetchItems(userId, conversationId);
    clearSelection();
  }, [userId, conversationId, fetchItems, clearSelection]);

  // ── Polling via generic useTaskPoller ──

  // First-seen wall-clock time per directive_review taskId, used as the poll
  // ceiling's start time when the item carries no dateCreated (see checkStatus
  // below). Captured ONCE per task — recomputing Date.now() on every tick
  // would re-base the window forward each poll and the ceiling could never
  // trip, polling forever (the exact hole this ceiling exists to plug).
  const directiveReviewStartRef = useRef({});

  const handlePollComplete = useCallback(
    async (itemId, result) => {
      const meta = pollingTasks[itemId];
      if (meta?.taskId) delete directiveReviewStartRef.current[meta.taskId];
      const base = contentFor(meta?.type, result);
      // Reports carry a structured citations[] alongside the markdown — fold a
      // deduped "Nguồn trích dẫn" section into the persisted content so it
      // survives reload and renders through the existing markdown pipeline.
      const content =
        meta?.type === "report"
          ? appendCitations(base, result?.citations)
          : base;
      if (content) {
        const storeItem = useAnalysisStore
          .getState()
          .items.find((it) => String(it.id) === String(itemId));
        const patch = { content, status: PROCESSING_STATUS.COMPLETED };
        if (meta?.type === "report" && Array.isArray(result?.citations)) {
          patch.selected = mergeReportSelected(storeItem?.selected, {
            citations: result.citations,
          });
        }
        if (meta?.type === "directive_review" && Array.isArray(result?.verdicts)) {
          // Persist a slim marker→source lookup so [n] chips survive reload.
          // The markdown already embeds its own citations appendix — this is
          // navigation data, NOT display data (never folded into content).
          const citations = flattenDirectiveCitations(result.verdicts);
          if (citations.length) {
            const prev =
              storeItem?.selected && typeof storeItem.selected === "object"
                ? storeItem.selected
                : {};
            patch.selected = { ...prev, citations };
          }
        }
        updateItem(itemId, patch);
        completePolling(itemId);
        try {
          await updateConversationInfo(userId, conversationId, itemId, {
            status: PROCESSING_STATUS.COMPLETED,
            content,
            task_id: null,
            ...(patch.selected ? { selected: patch.selected } : {}),
          });
        } catch (e) {
          console.error("Failed to persist analysis result", e);
        }
      }
    },
    [userId, conversationId, pollingTasks, updateItem, completePolling, contentFor]
  );

  const handlePollError = useCallback(
    async (itemId, result) => {
      const failedType = pollingTasks[itemId]?.type;
      const typeLabel =
        typeMap[failedType]?.errorLabel || typeMap[failedType]?.label || "Tác vụ";
      const taskId = pollingTasks[itemId]?.taskId;
      if (taskId) delete directiveReviewStartRef.current[taskId];
      updateItemContent(itemId, "", PROCESSING_STATUS.ERROR);
      completePolling(itemId);
      // ERROR items are hidden from the list, so alert the user explicitly
      // (e.g. an empty draft) — otherwise the task vanishes with no feedback.
      // Only our OWN client-synthesized poll-ceiling message is ours to show
      // verbatim — it's tagged with a distinct `clientMessage` key (set by
      // the poll-ceiling branch in checkStatus below) precisely so it can't
      // be confused with `message`, which is NOT exclusively ours: the
      // generic backend status route (GET /tools/{tool_name}/status/{task_id}
      // in backend-fastapi/app/routes/llm.py) returns `{status: FAILURE,
      // message: <err_json detail or raw response text>}` on any upstream
      // 4xx/5xx, and ToolStatusResponse allows extra fields through, so an
      // upstream `message` can arrive too — English, possibly a raw body.
      // Never surface that verbatim; keep the generic Vietnamese copy.
      const message =
        failedType === "directive_review" && result?.clientMessage
          ? result.clientMessage
          : `Không thể tạo ${typeLabel.toLowerCase()}. Vui lòng thử lại.`;
      showModal(AlertModal, {
        title: "Lỗi xử lý",
        message,
      });
      try {
        await updateConversationInfo(userId, conversationId, itemId, {
          status: PROCESSING_STATUS.ERROR,
          task_id: null,
        });
      } catch (e) {
        console.error("Failed to persist error status", e);
      }
    },
    [
      userId,
      conversationId,
      updateItemContent,
      completePolling,
      pollingTasks,
      typeMap,
      showModal,
    ]
  );

  const handleRefusal = useCallback(
    async (itemId, result) => {
      const taskId = pollingTasks[itemId]?.taskId;
      if (taskId) delete directiveReviewStartRef.current[taskId];
      updateItemContent(itemId, "", PROCESSING_STATUS.ERROR);
      completePolling(itemId);
      showModal(AlertModal, {
        title: "Không thể rà soát",
        message:
          result?.refusal_reason ||
          "Dự thảo hoặc văn bản tham chiếu không có nội dung để đối chiếu.",
      });
      try {
        await updateConversationInfo(userId, conversationId, itemId, {
          status: PROCESSING_STATUS.ERROR,
          task_id: null,
        });
      } catch (e) {
        console.error("Failed to persist refusal status", e);
      }
    },
    [userId, conversationId, updateItemContent, completePolling, showModal, pollingTasks]
  );

  useTaskPoller(pollingTasks, {
    checkStatus: (taskId, meta) => {
      if (meta.type === "directive_review") {
        const parsedDateCreated = meta.dateCreated
          ? new Date(meta.dateCreated).getTime()
          : NaN;
        let startedAt;
        if (Number.isFinite(parsedDateCreated)) {
          startedAt = parsedDateCreated;
        } else {
          // No usable dateCreated to anchor on (absent, or unparseable junk
          // that yields NaN — NaN comparisons are always false, so a naive
          // "NaN - now > ceiling" check would silently never trip, the same
          // fail-open hole this ceiling exists to plug) — capture wall-clock
          // time the FIRST time we see this taskId and reuse it on every
          // later tick. Do NOT fall back to Date.now() here: recomputed
          // every 3s, "now minus now" is always ~0 and isPollExpired() could
          // never trip.
          //
          // Caveat: this first-seen anchor lives in a component-scoped ref,
          // so an unmount/remount (conversation switch, page reload) resets
          // it and restarts the 45-minute window for a task lacking
          // dateCreated. Bounded degradation, not fail-open-forever — left
          // as-is rather than re-architected.
          const seen = directiveReviewStartRef.current[taskId];
          if (seen) {
            startedAt = seen;
          } else {
            startedAt = Date.now();
            directiveReviewStartRef.current[taskId] = startedAt;
          }
        }
        if (isPollExpired(startedAt)) {
          // Synthesize a FAILURE so useTaskPoller routes to onError and stops.
          // `clientMessage` (not `message`) is deliberate — see handlePollError.
          return Promise.resolve({
            status: UPSTREAM_STATUS.FAILURE,
            clientMessage: "Tác vụ rà soát vượt quá thời gian cho phép.",
          });
        }
        // No startTime — see api/tools.js getDirectiveReviewStatus.
        return getDirectiveReviewStatus(taskId);
      }

      const ts = meta.dateCreated
        ? new Date(meta.dateCreated).getTime()
        : Date.now();
      const checkFn =
        meta.type === "summary"
          ? getSummaryStatus
          : meta.type === "mindmap"
          ? getMindmapStatus
          : getDraftStatus;
      return checkFn(taskId, ts, conversationId);
    },
    onComplete: (itemId, result) => {
      const meta = pollingTasks[itemId];
      // A refusal is a successful task with an empty report — check it BEFORE
      // reading content, or it renders as a blank document.
      if (meta?.type === "directive_review" && isRefused(result)) {
        handleRefusal(itemId, result);
        return;
      }
      const content = contentFor(meta?.type, result);
      if (content) {
        handlePollComplete(itemId, result);
      } else {
        // Task completed but no content — treat as error to stop polling
        handlePollError(itemId, result);
      }
    },
    onError: handlePollError,
  });

  // ── Generate handler ──
  const handleGenerate = async (type) => {
    setAnimType(type);
    setTimeout(() => setAnimType(null), 650);
    const meta = typeMap[type];

    if (type === "directive_review") {
      const count = selectedDocumentIds.length;
      if (count < 1 || count > MAX_REFERENCE_DOCS) {
        showModal(AlertModal, {
          title: meta?.label || "Rà soát dự thảo",
          message: `Vui lòng chọn từ 01 đến ${MAX_REFERENCE_DOCS} văn bản tham chiếu.`,
        });
        return;
      }
      showModal(DraftUploadModal, {
        documentCount: count,
        maxDocuments: MAX_REFERENCE_DOCS,
        onPick: async (draftFile) => {
          try {
            const info = await generate("directive_review", {
              userId,
              conversationId,
              documentIds: selectedDocumentIds,
              draftFile,
            });
            onCreated?.(info);
          } catch (e) {
            let errMsg = "Không thể khởi tạo tác vụ.";
            if (e.response?.data?.message) errMsg = e.response.data.message;
            showModal(AlertModal, { title: "Lỗi xử lý", message: errMsg });
          }
        },
      });
      return;
    }

    if (type === "report") {
      const count = selectedDocumentIds.length;
      if (count < 1 || count > MAX_REPORT_DOCS) {
        showModal(AlertModal, {
          title: meta?.label || "Sinh văn bản",
          message: `Vui lòng chọn từ 01 đến ${MAX_REPORT_DOCS} tài liệu để lập báo cáo.`,
        });
        return;
      }
      showModal(TemplatePickerModal, {
        documentCount: count,
        maxDocuments: MAX_REPORT_DOCS,
        onPick: async (templateId, templateLabel) => {
          try {
            const info = await generate("report", {
              userId,
              conversationId,
              documentIds: selectedDocumentIds,
              templateId,
              templateLabel,
            });
            onCreated?.(info);
          } catch (e) {
            let errMsg = "Không thể khởi tạo tác vụ.";
            if (e.response?.data?.message) errMsg = e.response.data.message;
            showModal(AlertModal, { title: "Lỗi xử lý", message: errMsg });
          }
        },
      });
      return;
    }

    if (selectedDocumentIds.length !== 1) {
      showModal(AlertModal, {
        title: meta?.label || "Thông báo",
        message: "Vui lòng chọn đúng 01 tài liệu để thực hiện.",
      });
      return;
    }

    const docId = selectedDocumentIds[0];
    const docName =
      docsState.find((d) => String(d.id) === String(docId))?.name ||
      "Tài liệu";

    try {
      const info = await generate(type, {
        userId,
        conversationId,
        docId,
        docName,
        documentIds: selectedDocumentIds,
      });
      onCreated?.(info);
    } catch (e) {
      let errMsg = "Không thể khởi tạo tác vụ.";
      if (e.response?.data?.message) errMsg = e.response.data.message;
      showModal(AlertModal, { title: "Lỗi xử lý", message: errMsg });
    }
  };

  // ── Delete handler ──
  const handleDelete = async (id) => {
    try {
      await deleteItem(userId, conversationId, id);
      onRemoved?.(id);
    } catch (e) {
      console.error("Delete failed:", e);
    }
  };

  // ── Render ──
  const combined = [...pending, ...items].filter(
    (it) =>
      it.status !== PROCESSING_STATUS.ERROR &&
      it.status !== UPSTREAM_STATUS.FAILURE
  );

  return (
    <>
      {selectedInfo ? (
        <InfoPanel
          item={selectedInfo}
          onClose={clearSelection}
          onDelete={(id) => {
            handleDelete(id);
            clearSelection();
          }}
        />
      ) : (
        <div className="analysis-section">
          <div className="ap-grid">
            {Object.entries(typeMap).map(([key, { icon, label }]) => (
              <div
                key={key}
                className={`ap-feature${animType === key ? " is-animating" : ""}`}
                onClick={() => handleGenerate(key)}
                title={label}
              >
                <div className="ap-icon">{icon}</div>
                <div className="ap-title">{label}</div>
              </div>
            ))}
          </div>
          <div className="ap-list">
            {combined.map((item) => {
              const meta = typeMap[item.type] || {};
              const isProcessing =
                !!item._pending ||
                item.status === PROCESSING_STATUS.PROCESSING ||
                item.status === PROCESSING_STATUS.PENDING;
              return (
                <div
                  className={`ap-item${isProcessing ? " is-pending" : ""}`}
                  key={item.id}
                >
                  <div
                    className="ap-item-main"
                    onClick={() => !isProcessing && selectInfo(item)}
                    role={isProcessing ? undefined : "button"}
                    tabIndex={isProcessing ? undefined : 0}
                  >
                    <div className="ap-icon">
                      {isProcessing ? (
                        <div className="ap-loading-spinner" />
                      ) : (
                        meta.icon || <SummaryIcon />
                      )}
                    </div>
                    <div className="ap-item-texts">
                      <div className="ap-item-title">
                        {item.name || "Không tên"}
                      </div>
                      <div className="ap-item-meta">
                        {isProcessing
                          ? item._pending
                            ? "Đang khởi tạo..."
                            : "Đang xử lý..."
                          : formatTimestampVi(item.date_created || new Date())}
                      </div>
                    </div>
                  </div>
                  {!item._pending && (
                    <button
                      className="ap-item-delete"
                      title="Xoá"
                      onClick={(e) => {
                        e.stopPropagation();
                        showModal(DeleteModal, {
                          title: "Xoá mục phân tích",
                          message: `Bạn chắc chắn muốn xoá "${item.name || "mục phân tích"}"?`,
                          onConfirm: () => {
                            handleDelete(item.id);
                            hideModal();
                          },
                        });
                      }}
                    >
                      <DeleteIcon />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
