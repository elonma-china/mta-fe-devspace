// src/components/menus/ActionMenu.js
import React, { useEffect, useRef } from "react";
import './ActionMenu.css'

/**
 * Story 96: icons drawn inline as a consistent 24×24 OUTLINE set matching the
 * design (Figma 859:23955), replacing the mismatched svgr imports (edit.svg was
 * a small 20×20 pencil, delete.svg a solid-filled trash). Inline SVGs share the
 * same viewBox so the three rows line up, and stay scoped to this menu — the
 * shared assets/images/{edit,delete,eye}.svg are untouched.
 *
 * Story 105: the glyphs are drawn to share the SAME optical vertical centre
 * (~y12) and a comparable visual height, so the popup rows read level top↔bottom
 * (the old trash spanned y4→20.9 = taller and centred ~0.45px lower than the eye,
 * which read as "not aligned"). Uniform 24×24 viewBox + centred glyphs = even rows.
 */
function EyeIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.7" fill="currentColor" />
    </svg>
  );
}

function EditIcon(props) {
  // Pencil centred on y12 (visual box y5.5–18.5) to match the eye's envelope.
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M5.5 18.5H8L17.5 9a1.4 1.4 0 0 0 0-2l-1.5-1.5a1.4 1.4 0 0 0-2 0L4.5 15v3.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M13 6 16.5 9.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function DeleteIcon(props) {
  // Trash centred on y12 (visual box y5–19.1) — tightened from the old y4–20.9 so
  // it no longer looks taller/lower than the eye in the row above it.
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M4.5 7h15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path
        d="M9.5 7V6a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 7 7.3 17.4a1.8 1.8 0 0 0 1.8 1.7h4.8a1.8 1.8 0 0 0 1.8-1.7L17.5 7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M10 10v6M14 10v6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Props
 * - open: boolean
 * - x: number (px)
 * - y: number (px)
 * - onAction: (action: "rename" | "delete" | "preview") => void
 * - onClose: () => void
 * - className?: string  // optional override (defaults to "as-menu")
 * - showPreview?: boolean  // default true — hide the "Xem" item when false
 * - showRename?: boolean   // default true — hide the "Sửa" item when false
 * - showDelete?: boolean   // default true — hide the "Xoá/Gỡ" item when false
 *
 * Story 19: repository docs in chat use showRename={false} and a custom
 * deleteLabel ("Gỡ khỏi hội thoại"). Defaults keep the original 3-item menu so
 * existing callers are unaffected.
 */
export default function ActionMenu({
  open,
  x = 0,
  y = 0,
  onAction,
  onClose,
  className = "as-menu",
  editLabel = "Sửa tên tài liệu",
  deleteLabel = "Xoá tài liệu",
  previewLabel = "Xem tài liệu",
  showPreview = true,
  showRename = true,
  showDelete = true,
}) {
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    const onDocClick = (e) => {
      if (!menuRef.current || !menuRef.current.contains(e.target)) {
        onClose?.();
      }
    };
    const onEsc = (e) => {
      if (e.key === "Escape") onClose?.();
    };

    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, onClose]);

  const doAction = (action) => {
    onAction?.(action);
    onClose?.();
  };

  if (!open) return null;

  return (
    <div
      ref={menuRef}
      className={className}
      role="menu"
      style={{ left: `${x}px`, top: `${y}px`, position: "fixed", }}
    >
      {showPreview && (
        <button className="as-menu-item" role="menuitem" onClick={() => doAction("preview")}>
          <EyeIcon className="as-mi-icon" />
          <span className="as-mi-label">{previewLabel}</span>
        </button>
      )}
      {showRename && (
        <button className="as-menu-item" role="menuitem" onClick={() => doAction("rename")}>
          <EditIcon className="as-mi-icon" />
          <span className="as-mi-label">{editLabel}</span>
        </button>
      )}
      {showDelete && (
        <button className="as-menu-item" role="menuitem" onClick={() => doAction("delete")}>
          <DeleteIcon className="as-mi-icon" />
          <span className="as-mi-label">{deleteLabel}</span>
        </button>
      )}
    </div>
  );
}
