// src/features/admin/components/DocumentEditModal.js
import React, { useEffect, useState } from "react";
import "./DocumentEditModal.css";
import { ReactComponent as CloseIcon } from "assets/images/close.svg";
import { ReactComponent as DeleteIcon } from "assets/images/delete.svg";
import { AlertModal } from "components/common";
import UploadFileSection from "features/documents/components/UploadFileSection";

/** Human-readable file size; "—" when unknown (existing files have no size). */
function formatSize(bytes) {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Edit a repository document's metadata (Figma 841-48773 "Sửa tên tài liệu").
 *
 * Fields: Tên văn bản, Số văn bản, Nhóm tài liệu (dropdown), Trích yếu. File
 * replacement (ghi đè) is out of scope for the metadata form and handled by a
 * separate upload flow; this modal edits metadata only and blocks a blank name.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {{id:string, name?:string, doc_number?:string, summary?:string, group_id?:number}} props.initialValues
 * @param {Array<{id:number, name:string}>} props.groups
 * @param {(payload:{name:string,doc_number:string,summary:string,group_id:?number}) => (void|Promise<void>)} props.onSubmit
 * @param {() => void} props.onClose
 */
export default function DocumentEditModal({
  open,
  initialValues,
  groups = [],
  onSubmit,
  onClose,
}) {
  const [name, setName] = useState("");
  const [docNumber, setDocNumber] = useState("");
  const [summary, setSummary] = useState("");
  const [groupId, setGroupId] = useState("");
  // A chosen replacement file overwrites the document's content on Save.
  const [replacementFile, setReplacementFile] = useState(null);
  // Story 48: admin marks a COMPLETED doc as "Đã duyệt" (APPROVED) on Save.
  const [approve, setApprove] = useState(false);
  const [loading, setLoading] = useState(false);
  const [alertState, setAlertState] = useState({
    open: false,
    title: "Lỗi",
    message: "",
  });

  const showAlert = (message, title = "Lỗi") =>
    setAlertState({ open: true, title, message });
  const closeAlert = () =>
    setAlertState({ open: false, title: "Lỗi", message: "" });

  useEffect(() => {
    if (!open) return;
    setName(initialValues?.name ?? "");
    setDocNumber(initialValues?.doc_number ?? "");
    setSummary(initialValues?.summary ?? "");
    setGroupId(
      initialValues?.group_id != null ? String(initialValues.group_id) : "",
    );
    setReplacementFile(null);
    setApprove(false);
  }, [open, initialValues]);

  if (!open) return null;

  // Story 48: the approve control is offered only once the document is digitized
  // ("Đã số hoá" = COMPLETED, story 46); other statuses cannot be approved.
  const isCompleted =
    String(initialValues?.status || "").toUpperCase() === "COMPLETED";

  async function handleSubmit(e) {
    e.preventDefault();
    if (loading) return;
    if (!name.trim()) {
      showAlert("Tên văn bản không được để trống.");
      return;
    }
    const payload = {
      name: name.trim(),
      doc_number: docNumber.trim(),
      summary: summary.trim(),
      group_id: groupId === "" ? null : Number(groupId),
    };
    try {
      // Second arg = chosen replacement file (null = metadata-only, unchanged
      // behaviour). Third arg (story 48) = approve flag: when true (only for a
      // COMPLETED doc) the page marks the doc APPROVED after saving metadata.
      const res = onSubmit?.(payload, replacementFile, isCompleted && approve);
      if (res instanceof Promise) {
        setLoading(true);
        await res;
      }
    } catch (err) {
      showAlert(err?.message || "Đã xảy ra lỗi khi lưu tài liệu.");
    } finally {
      setLoading(false);
    }
  }

  function handlePickFile(files) {
    const f = files?.[0];
    if (f) setReplacementFile(f);
  }

  function onBackdropClick(e) {
    if (e.target === e.currentTarget) onClose?.();
  }

  return (
    <div className="dem-backdrop" onMouseDown={onBackdropClick}>
      <div
        className="dem-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dem-title"
      >
        <button
          className="dem-close"
          type="button"
          onClick={onClose}
          aria-label="Đóng"
        >
          <CloseIcon />
        </button>

        <form className="dem-content" onSubmit={handleSubmit}>
          <h2 id="dem-title" className="dem-title">
            Sửa tài liệu
          </h2>

          {/* Figma 841-48773: Số văn bản is the first field, above Tên văn bản. */}
          <label className="dem-field">
            <span className="dem-label">Số văn bản</span>
            <div className="dem-input">
              <input
                type="text"
                placeholder="Nhập số văn bản"
                value={docNumber}
                onChange={(e) => setDocNumber(e.target.value)}
              />
            </div>
          </label>

          <label className="dem-field">
            <span className="dem-label">Tên văn bản</span>
            <div className="dem-input">
              <input
                type="text"
                placeholder="Nhập tên văn bản"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </label>

          <label className="dem-field">
            <span className="dem-label">Nhóm tài liệu</span>
            <div className="dem-input">
              <select
                className="dem-select"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
              >
                <option value="">— Không có nhóm —</option>
                {groups.map((g) => (
                  <option key={g.id} value={String(g.id)}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          </label>

          <label className="dem-field">
            <span className="dem-label">Trích yếu</span>
            <div className="dem-input">
              <textarea
                rows={3}
                placeholder="Nhập trích yếu"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
            </div>
          </label>

          {/* Figma 841-48773: "Tài liệu" label above the existing-file row.
              Size is "—" for the stored file (BE doesn't expose it yet — story
              112 #3 deferred); the chosen replacement shows its real client
              size. Wrapped in .dem-field so the label sits 6px above the row. */}
          <div className="dem-field">
            <span className="dem-label">Tài liệu</span>
            <div className="dem-file-row">
              <span className="dem-file-name">
                {replacementFile ? replacementFile.name : name || "—"}
              </span>
              <span className="dem-file-size">
                {replacementFile ? formatSize(replacementFile.size) : "—"}
              </span>
              {replacementFile && (
                <button
                  type="button"
                  className="dem-file-clear"
                  onClick={() => setReplacementFile(null)}
                  aria-label="Bỏ file đã chọn"
                  title="Bỏ file đã chọn"
                >
                  <DeleteIcon />
                </button>
              )}
            </div>
          </div>

          <div className="dem-warn" role="note">
            Tải lên file mới sẽ ghi đè nội dung lên file hiện có
          </div>

          <UploadFileSection
            autoUpload={false}
            buttonLabel="Tải tài liệu lên"
            dropTitle="Kéo thả hoặc nhấn tải lên để Tải tài liệu lên để bắt đầu"
            onUpload={handlePickFile}
            onError={(m) => showAlert(m)}
            disabled={loading}
          />

          {isCompleted && (
            <label className="dem-approve">
              <input
                type="checkbox"
                checked={approve}
                onChange={(e) => setApprove(e.target.checked)}
              />
              <span>Đánh dấu đã duyệt</span>
            </label>
          )}

          <div className="dem-footer">
            <button
              type="button"
              className="dem-secondary"
              onClick={onClose}
              disabled={loading}
            >
              Huỷ bỏ
            </button>
            <button className="dem-primary" type="submit" disabled={loading}>
              {loading ? "Đang lưu..." : "Lưu"}
            </button>
          </div>
        </form>
      </div>

      <AlertModal
        open={alertState.open}
        onClose={closeAlert}
        title={alertState.title}
        message={alertState.message}
      />
    </div>
  );
}
