// src/features/analysis/components/AudioOverviewTool.js
import React, { useCallback, useMemo, useRef } from "react";
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

/** Row title fallback per mode, when the episode carries no name. */
const MODE_TITLES = {
  podcast: "Podcast 2 người dẫn",
  narration: "Bản đọc theo yêu cầu",
};

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
 * Keyed by `episodeKey(conversationId, mode)` rather than by conversation, so
 * a podcast and a reading can be in flight for the same notebook at once —
 * each with its own independent poll loop.
 *
 * @param {object} props
 * @param {string} props.episodeKey
 * @param {(key: string) => void} props.onOpen
 * @param {(episode: object, key: string) => void} props.onRequestDelete
 * @param {(episode: object, key: string) => void} props.onRequestCancel
 */
export function AudioOverviewItem({
  episodeKey: key,
  onOpen,
  onRequestDelete,
  onRequestCancel,
}) {
  const episode = useAudioOverviewStore((s) => s.episodes[key]);
  const markProgress = useAudioOverviewStore((s) => s.markProgress);
  const markComplete = useAudioOverviewStore((s) => s.markComplete);
  const markCancelled = useAudioOverviewStore((s) => s.markCancelled);
  const markError = useAudioOverviewStore((s) => s.markError);

  const isProcessing = episode?.status === AUDIO_STATUS.PROCESSING;

  // Số lần poll lỗi liên tiếp. Cần vì hai loại lỗi phải xử lý ngược nhau:
  // mạng chập một nhịp thì PHẢI tiếp tục poll (tập vẫn đang render trên
  // server, huỷ nó đi là mất công), còn task chết thật thì PHẢI dừng và báo.
  const pollFailsRef = useRef(0);

  // Identity must be stable or useTaskPoller tears down and rebuilds its
  // interval on every render, so it would poll on every tick of anything.
  const tasks = useMemo(
    () =>
      isProcessing && episode?.taskId
        ? { [key]: { taskId: episode.taskId } }
        : {},
    [isProcessing, episode?.taskId, key]
  );

  const checkStatus = useCallback(
    async (taskId) => {
      // HỎI SERVER TRƯỚC, áp trần sau. Bản đầu kiểm trần trước rồi mới gọi,
      // nên người dùng rời đi lâu rồi quay lại thì thấy "quá thời gian" dù tập
      // đã xong và file đã nằm trong MinIO — trần đo từ `submittedAt`, mà thời
      // gian người dùng vắng mặt cũng nằm trong đó. Càng dễ xảy ra với engine
      // mới (RTF ~1,6x): một tập 30 phút mất gần một giờ.
      const raw = await getAudioOverviewStatus(taskId);
      pollFailsRef.current = 0;  // một nhịp thành công xoá chuỗi lỗi tạm thời
      const verdict = classifyStatus(raw);

      if (!verdict) {
        // Server vẫn đang chạy VÀ đã quá trần: giờ mới bỏ cuộc.
        if (Date.now() - (episode?.submittedAt || 0) > AUDIO_OVERVIEW_MAX_WAIT_MS) {
          return { status: "FAILURE", message: "Quá thời gian tạo tập podcast." };
        }
        markProgress(key, raw?.progress || null);
        // Returning PROCESSING rather than the raw body keeps useTaskPoller
        // out of its "non-empty object with no state means done" branch,
        // which a processing payload would otherwise fall into.
        return { status: "PROCESSING" };
      }
      if (verdict.state === AUDIO_STATUS.CANCELLED) {
        markCancelled(key);
        return { status: "FAILURE", cancelled: true };
      }
      if (verdict.state === AUDIO_STATUS.ERROR) {
        return { status: "FAILURE", message: raw?.message };
      }
      markComplete(key, verdict.result);
      return { status: "SUCCESS" };
    },
    [key, episode?.submittedAt, markProgress, markComplete, markCancelled]
  );

  const onError = useCallback(
    (_id, result) => {
      // markCancelled already ran for the cancel path; do not overwrite it
      // with a generic failure.
      if (result?.cancelled) return;
      pollFailsRef.current = 0;
      markError(key, result?.message);
    },
    [key, markError]
  );

  /**
   * Lỗi khi GỌI status (khác với "task báo failed" ở onError).
   *
   * Không nối callback này là lỗ hổng thật trong bản trước: `useTaskPoller` chỉ
   * console.warn rồi poll tiếp mãi mãi, nên một task đã chết (AI trả 500 kèm lý
   * do) hiện ra là "Đang tạo…" vô hạn — người dùng không bao giờ biết nó lỗi.
   *
   * Phân loại:
   *   5xx / 404  -> KẾT THÚC. AI raise 500 kèm lý do thật khi task fail (ví dụ
   *                 "Không lấy được nội dung tài liệu"), 404 là task đã biến
   *                 mất. Báo ngay, kèm nguyên văn lý do.
   *   4xx khác   -> KẾT THÚC. Hợp đồng sai thì poll thêm cũng vậy.
   *   không status (mạng) -> TẠM THỜI. Chịu 5 nhịp (~15 giây) rồi mới bỏ.
   */
  const onPollError = useCallback(
    (_id, err) => {
      const status = err?.status;
      const detail =
        typeof err?.detail === "string" && err.detail.trim()
          ? err.detail.trim()
          : null;

      if (status) {
        pollFailsRef.current = 0;
        markError(key, detail || `Tạo thất bại (HTTP ${status}).`);
        return;
      }
      pollFailsRef.current += 1;
      if (pollFailsRef.current >= 5) {
        pollFailsRef.current = 0;
        markError(
          key,
          "Mất kết nối tới máy chủ khi theo dõi tiến độ. Tải lại trang để xem trạng thái."
        );
      }
    },
    [key, markError]
  );

  useTaskPoller(tasks, {
    checkStatus,
    onComplete: () => {},
    onError,
    onPollError,
  });

  if (!episode) return null;

  const status = statusText(episode);
  const isDone = episode.status === AUDIO_STATUS.COMPLETED;

  return (
    <div className={`ap-item${isProcessing ? " is-pending" : ""}`}>
      <div
        className="ap-item-main"
        onClick={() => isDone && onOpen(key)}
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
            {episode.name || MODE_TITLES[episode.mode] || "Tổng quan âm thanh"}
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
            onRequestCancel(episode, key);
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
            onRequestDelete(episode, key);
          }}
        >
          <DeleteIcon />
        </button>
      )}
    </div>
  );
}
