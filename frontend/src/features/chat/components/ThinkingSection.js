// src/features/chat/components/ThinkingSection.js
import React, { useState } from "react";
import { ReactComponent as ChevronDown } from "assets/images/chevron-down.svg";
import "./ThinkingSection.css";

export default function ThinkingSection({ 
  loading, 
  currentMsg, 
  history = [], 
  onStop 
}) {
  const [isOpen, setIsOpen] = useState(false);

  if (!loading && history.length === 0) return null;

  return (
    <div className="ci-thinking-wrapper">
      <div className={`ci-thinking-container ${isOpen ? "is-open" : ""}`}>
        <div className="ci-thinking-header" onClick={() => setIsOpen(!isOpen)}>
          <div className="ci-thinking-status">
            {loading && <div className="ci-thinking-spinner" />}
            <span className="ci-thinking-current-msg">{currentMsg}</span>
          </div>
          
          <div className="ci-thinking-actions">
            {loading && (
              <button 
                type="button"
                className="ci-thinking-stop-btn" 
                onClick={(e) => { e.stopPropagation(); onStop(); }}
              >
                Dừng
              </button>
            )}
            <ChevronDown className={`ci-thinking-chevron ${isOpen ? "active" : ""}`} />
          </div>
        </div>

        {isOpen && history.length > 0 && (
          <div className="ci-thinking-body">
            <ul className="ci-thinking-history">
              {history.map((step, idx) => (
                <li key={idx} className="ci-thinking-step">
                  <span className="ci-step-indicator" />
                  {step}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}