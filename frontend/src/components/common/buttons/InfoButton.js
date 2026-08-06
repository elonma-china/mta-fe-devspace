// src/components/common/buttons/InfoButton.js
import React, { useState } from "react";
import "./InfoButton.css";
import { ReactComponent as Info } from "assets/images/info.svg";
import { InfoModal } from "../modals";
import useModalStore from "stores/useModalStore";

export default function InfoButton({ onClick, title = "Info" }) {
  const { showModal } = useModalStore();

  return (
    <>
      <div
        className="info-btn"
        type="button"
        onClick={() => {
          onClick?.();
          showModal(InfoModal);
        }}
        aria-haspopup="dialog"
        aria-label="Info"
        title={title}
      >
        <Info className="icon" aria-hidden="true" focusable="false" />
      </div>
    </>
  );
}
