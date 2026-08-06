// src/components/common/buttons/Switch.js
import React from "react";
import "./Switch.css";

/**
 * Reusable toggle switch.
 * 
 * Props:
 * - checked: boolean → ON state (true = ON)
 * - disabled?: boolean
 * - onChange?: (checked: boolean) => void
 * - onLabel?: string → text when ON (default "On")
 * - offLabel?: string → text when OFF (default "Off")
 * - title?: string
 * - size?: "sm" | "md" | "lg" (default "md")
 */
export default function Switch({
  checked = false,
  disabled = false,
  onChange,
  onLabel = "On",
  offLabel = "Off",
  title = "",
  size = "md",
}) {
  const id = React.useId();

  return (
    <label
      htmlFor={id}
      className={`switch switch--${size} ${disabled ? "switch--disabled" : ""}`}
      title={title}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange && onChange(e.target.checked)}
        aria-label={title || "Toggle"}
      />
      <span className="slider" data-on={onLabel} data-off={offLabel}></span>
    </label>
  );
}
