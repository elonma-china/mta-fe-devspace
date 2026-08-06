// src/features/analysis/components/AudioOverviewTool.js
import React, { useCallback, useMemo } from "react";
import "./AudioOverviewTool.css";
import { ReactComponent as DeleteIcon } from "assets/images/delete.svg";
import { useTaskPoller } from "hooks/useTaskPoller";
import useAudioOverviewStore, {
  AUDIO_STATUS,
  AUDIO_OVERVIEW_MAX_WAIT_MS,
  classifyStatus,
  progressLabel,
} from "stores/useAudioOverviewStore";
import { getAudioOverviewStatus } from "../api/audioOverview";

/** Speaker-bubble glyph. Inline so the tool ships no new asset. */
export function AudioIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H3v6h3l5 4z" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7" />
      <path d="M19.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

/** The grid tile that opens the submit modal. */
export function AudioOverviewCard({ onClick, animating = false }) {
  return (
    <div
      className={`ap-feature${animating ? " is-animating" : ""}`}
      onClick={onClick}
      title="Tổng quan âm thanh"
    >
      <div className="ap-icon">
        <AudioIcon />
      </div>
      <div className="ap-title">Tổng quan âm thanh</div>
    </div>
  );
}

/** Vietnamese status line for a non-terminal or failed episode. */
function statusText(episode) {
  if (episode.status === AUDIO_STATUS.PROCESSING) {
    // `note` is the service's own phase string ("script", "tts 7/23"); it is
    // absent early on, and a 0/0 bar would read as stalled during the script
    // phase, which is the longest part of the run.
    const label = progressLabel(episode.progress);
    return label ? `Đang tạo… ${label}` : "Đang tạo…";
  }
  if (episode.status === AUDIO_STATUS.CANCELLED) return "Đã huỷ";
  if (episode.status === AUDIO_STATUS.ERROR) {
    return episode.error || "Tạo thất bại";
  }
  return null;
}

/**
 * The list row for a conversation's episode, and the poll loop behind it.
 *
 * Polling lives here rather than in the store because `useTaskPoller` is the
 * repo's one polling implementation and reusing it keeps the interval,
 * cleanup and error handling identical to every other tool.
 *
 * @param {object} props
 * @param {number|string} props.conversationId
 * @param {(id: number|string) => void} props.onOpen
 * @param {(episode: object) => void} props.onRequestDelete
 * @param {(episode: object) => void} props.onRequestCancel
 */
export function AudioOverviewItem({
  conversationId,
  onOpen,
  onRequestDelete,
  onRequestCancel,
}) {
  const episode = useAudioOverviewStore((s) => s.episodes[conversationId]);
  const markProgress = useAudioOverviewStore((s) => s.markProgress);
  const markComplete = useAudioOverviewStore((s) => s.markComplete);
  const markCancelled = useAudioOverviewStore((s) => s.markCancelled);
  const markError = useAudioOverviewStore((s) => s.markError);

  const isProcessing = episode?.status === AUDIO_STATUS.PROCESSING;

  // Identity must be stable or useTaskPoller tears down and rebuilds its
  // interval on every render, so it would poll on every tick of anything.
  const tasks = useMemo(
    () =>
      isProcessing && episode?.taskId
        ? { [conversationId]: { taskId: episode.taskId } }
        : {},
    [isProcessing, episode?.taskId, conversationId]
  );

  const checkStatus = useCallback(
    async (taskId) => {
      // We omit startTime upstream (it would trip the zombie check and
      // destroy a finished episode), so the ceiling has to be applied here.
      if (Date.now() - (episode?.submittedAt || 0) > AUDIO_OVERVIEW_MAX_WAIT_MS) {
        return { status: "FAILURE", message: "Quá thời gian tạo tập podcast." };
      }
      const raw = await getAudioOverviewStatus(taskId);
      const verdict = classifyStatus(raw);

      if (!verdict) {
        markProgress(conversationId, raw?.progress || null);
        // Returning PROCESSING rather than the raw body keeps useTaskPoller
        // out of its "non-empty object with no state means done" branch,
        // which a processing payload would otherwise fall into.
        return { status: "PROCESSING" };
      }
      if (verdict.state === AUDIO_STATUS.CANCELLED) {
        markCancelled(conversationId);
        return { status: "FAILURE", cancelled: true };
      }
      if (verdict.state === AUDIO_STATUS.ERROR) {
        return { status: "FAILURE", message: raw?.message };
      }
      markComplete(conversationId, verdict.result);
      return { status: "SUCCESS" };
    },
    [conversationId, episode?.submittedAt, markProgress, markComplete, markCancelled]
  );

  const onError = useCallback(
    (_id, result) => {
      // markCancelled already ran for the cancel path; do not overwrite it
      // with a generic failure.
      if (result?.cancelled) return;
      markError(conversationId, result?.message);
    },
    [conversationId, markError]
  );

  useTaskPoller(tasks, {
    checkStatus,
    onComplete: () => {},
    onError,
  });

  if (!episode) return null;

  const status = statusText(episode);
  const isDone = episode.status === AUDIO_STATUS.COMPLETED;

  return (
    <div className={`ap-item${isProcessing ? " is-pending" : ""}`}>
      <div
        className="ap-item-main"
        onClick={() => isDone && onOpen(conversationId)}
        role={isDone ? "button" : undefined}
        tabIndex={isDone ? 0 : undefined}
      >
        <div className="ap-icon">
          {isProcessing ? (
            <div className="ap-loading-spinner" />
          ) : (
            <AudioIcon />
          )}
        </div>
        <div className="ap-item-texts">
          <div className="ap-item-title">
            {episode.name || "Tổng quan âm thanh"}
          </div>
          <div className="ap-item-meta">{status || "Sẵn sàng phát"}</div>
        </div>
      </div>

      {isProcessing ? (
        <button
          type="button"
          className="ao-item-cancel"
          title="Huỷ"
          onClick={(e) => {
            e.stopPropagation();
            onRequestCancel(episode);
          }}
        >
          Huỷ
        </button>
      ) : (
        <button
          type="button"
          className="ap-item-delete"
          title="Xoá"
          onClick={(e) => {
            e.stopPropagation();
            onRequestDelete(episode);
          }}
        >
          <DeleteIcon />
        </button>
      )}
    </div>
  );
}
