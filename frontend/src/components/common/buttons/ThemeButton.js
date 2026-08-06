// src/components/common/buttons/ThemeButton.js
import React, { useEffect, useState } from "react";
import { ReactComponent as Sun } from "assets/images/sun.svg";
import { ReactComponent as Moon } from "assets/images/moon.svg";
import "./ThemeButton.css";

/**
 * ThemeButton
 * - Default LIGHT theme
 * - No localStorage
 * - Only toggles `class="dark"` on <body>
 */
export default function ThemeButton({ title = "Chuyển chế độ" }) {
  // false => light (default), true => dark
  const [isDark, setIsDark] = useState(false);

  // Apply/remove .dark on <body> whenever state changes
  useEffect(() => {
    document.body.classList.toggle("dark", isDark);
  }, [isDark]);

  // Ensure cleanup (remove .dark) if component unmounts
  useEffect(() => {
    return () => document.body.classList.remove("dark");
  }, []);

  const toggle = () => setIsDark((v) => !v);

  return (
    <button
      type="button"
      className={`theme-btn${isDark ? " is-dark" : ""}`}
      role="switch"
      aria-checked={isDark}
      aria-label={title}
      title={title}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      }}
    >
      {/* track icons (static) */}
      <span className="theme-icons" aria-hidden="true">
        <span className="icon sun">
          <Sun />
        </span>
        <span className="icon moon">
          <Moon />
        </span>
      </span>

      {/* moving thumb */}
      <span className="theme-thumb" aria-hidden="true">
        <span className="thumb-icon">
          <Sun />
          <Moon />
        </span>
      </span>
    </button>
  );
}
