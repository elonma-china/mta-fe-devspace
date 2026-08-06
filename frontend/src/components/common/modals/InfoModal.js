// src/components/common/modals/InfoModal.js
import React, { useEffect, useRef } from "react";
import { ReactComponent as X } from "assets/images/x.svg";
import { ReactComponent as Help } from "assets/images/help.svg";
import { ReactComponent as Info } from "assets/images/info.svg";
import "./InfoModal.css";

/**
 * InfoModal
 * Props:
 *  - open: boolean
 *  - onClose: () => void
 *  - title?: string
 *  - bodyTop?: string
 *  - bodyBottom?: string
 *  - supportTitle?: string   // first line inside green outline box
 *  - supportSubtitle?: string // second line inside green outline box
 */
export default function InfoModal({
  open,
  onClose,
  title = "IntraMind",
  bodyTop = "Trợ lý ảo nội bộ là phần mềm được xây dựng dựa trên mô hình ngôn ngữ lớn đã tối ưu hóa và cài đặt trên máy tính cá nhân, cho phép người dùng phân tích và tương tác với các tài liệu của mình mà không cần kết nối Internet. Hệ thống tích hợp mô hình ngôn ngữ tiên tiến hỗ trợ tìm kiếm, tóm tắt, trả lời câu hỏi, và soạn thảo nội dung dựa trên chính tài liệu nội bộ.",
  bodyBottom = "Toàn bộ dữ liệu được xử lý cục bộ, đảm bảo bảo mật tuyệt đối — phù hợp cho các môi trường có yêu cầu cao về an toàn thông tin.",
  supportTitle = "Để được hỗ trợ kỹ thuật, vui lòng liên hệ",
  supportSubtitle = "đồng chí Phạm Trường Sơn (SĐT: 098 99 44 394)",
}) {
  const modalRef = useRef(null);
  const closeBtnRef = useRef(null);

  // Close on ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
      // simple focus trap
      if (e.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    // prevent background scroll
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // focus close on open
    setTimeout(() => closeBtnRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="imodal-overlay"
      role="presentation"
      onClick={onClose}
      aria-hidden="true"
    >
      <div
        className="imodal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="imodal-title"
        aria-describedby="imodal-desc"
        onClick={(e) => e.stopPropagation()}
        ref={modalRef}
      >
        {/* Header (close) */}
        <div className="imodal-header">
          <button
            type="button"
            className="imodal-close"
            onClick={onClose}
            aria-label="Đóng"
            ref={closeBtnRef}
          >
            <X />
          </button>
        </div>

        {/* Body */}
        <div className="imodal-body">
          <div className="imodal-badge">
            <Info />
          </div>

          <h1 id="imodal-title" className="imodal-title">
            {title}
          </h1>

          <div id="imodal-desc" className="imodal-text">
            <p>{bodyTop}</p>
            <p>{bodyBottom}</p>
          </div>

          <div className="imodal-support">
            <div className="imodal-support-icon" aria-hidden="true">
              <Help />
            </div>
            <div className="imodal-support-text">
              <div className="line1">{supportTitle}</div>
              <div className="line2">{supportSubtitle}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
