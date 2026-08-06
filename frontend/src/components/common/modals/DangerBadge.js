// src/components/common/modals/DangerBadge.js
import React from "react";
import "./DangerBadge.css";

/**
 * DangerBadge — the warning badge shown on delete/danger confirmation modals
 * (Figma 841-48612 / 841-48670 / 841-48732): a rose circle with a red ✕.
 *
 * Drawn as an inline SVG so it needs no asset import (keeps it renderable in
 * jsdom tests) and can be reused across the shared DeleteModal and the bespoke
 * UnitDeleteModal.
 */
export default function DangerBadge() {
  return (
    <span className="modal-danger-badge" data-testid="modal-danger-badge">
      <svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true">
        <circle cx="22" cy="22" r="22" fill="#FDE7EC" />
        <circle cx="22" cy="22" r="14" fill="#F7B3C3" />
        <path
          d="M17 17 L27 27 M27 17 L17 27"
          stroke="#E5384D"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
