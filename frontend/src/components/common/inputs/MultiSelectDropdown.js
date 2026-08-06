// src/components/common/inputs/MultiSelectDropdown.js
import React, { useEffect, useMemo, useRef, useState } from "react";
import "./MultiSelectDropdown.css";
import { ReactComponent as ChevronDown } from "assets/images/chevron-down.svg";
import SearchBar from "./SearchBar";

/**
 * MultiSelectDropdown
 *
 * A pill-shaped trigger that opens a panel containing a search bar and a
 * scrollable, checkbox-based list of options. Selecting an option toggles it
 * in/out of the `selected` set.
 *
 * Props:
 * - options: Array<{ value: string|number, label: string }>
 * - selected: Array<string|number>            // currently selected values
 * - onChange: (next: Array<string|number>) => void
 * - placeholder?: string                       // shown when nothing selected
 * - searchPlaceholder?: string
 * - searchable?: boolean                       // default true
 * - emptyMessage?: string
 * - single?: boolean                           // story 91: single-choice mode —
 *     picking an option REPLACES the selection (and closes the panel); picking
 *     the already-selected option clears it (→ []). Default false (multi).
 */
export default function MultiSelectDropdown({
  options = [],
  selected = [],
  onChange,
  placeholder = "Chọn",
  searchPlaceholder = "Tìm kiếm",
  searchable = true,
  emptyMessage = "Không có lựa chọn.",
  single = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const triggerLabel = useMemo(() => {
    if (selectedSet.size === 0) return placeholder;
    const labels = options
      .filter((o) => selectedSet.has(o.value))
      .map((o) => o.label);
    if (labels.length === 1) return labels[0];
    return `${labels[0]} +${labels.length - 1}`;
  }, [options, selectedSet, placeholder]);

  function toggleValue(value) {
    if (!onChange) return;
    // Story 91: single mode replaces the selection (or clears it when re-picking
    // the current one) and closes the panel; multi mode toggles additively.
    if (single) {
      onChange(selectedSet.has(value) ? [] : [value]);
      setOpen(false);
      return;
    }
    const next = new Set(selectedSet);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(Array.from(next));
  }

  return (
    <div className="ms-dropdown" ref={rootRef}>
      <button
        type="button"
        className={`ms-dropdown__trigger${open ? " ms-dropdown__trigger--open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          className={`ms-dropdown__value${selectedSet.size === 0 ? " ms-dropdown__value--placeholder" : ""}`}
        >
          {triggerLabel}
        </span>
        <ChevronDown className="ms-dropdown__chevron" aria-hidden />
      </button>

      {open && (
        <div className="ms-dropdown__panel" role="listbox" aria-multiselectable>
          {searchable && (
            <SearchBar
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
            />
          )}

          <ul className="ms-dropdown__list">
            {filtered.length === 0 ? (
              <li className="ms-dropdown__empty">{emptyMessage}</li>
            ) : (
              filtered.map((opt) => {
                const checked = selectedSet.has(opt.value);
                return (
                  <li
                    key={opt.value}
                    className="ms-dropdown__item"
                    role="option"
                    aria-selected={checked}
                    onClick={() => toggleValue(opt.value)}
                  >
                    <span
                      className={`ms-dropdown__checkbox${checked ? " ms-dropdown__checkbox--checked" : ""}`}
                      aria-hidden
                    >
                      {checked && (
                        <svg viewBox="0 0 24 24" width="16" height="16">
                          <path
                            d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
                            fill="currentColor"
                          />
                        </svg>
                      )}
                    </span>
                    <span className="ms-dropdown__label">{opt.label}</span>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
