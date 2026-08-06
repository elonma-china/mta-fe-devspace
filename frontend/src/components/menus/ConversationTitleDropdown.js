// src/components/menus/ConversationTitleDropdown.js
import React, { useState, useRef, useEffect } from "react";
import "./ConversationTitleDropdown.css";
import { SearchBar } from "components"
import { ReactComponent as ChevronDown } from "assets/images/chevron-down.svg";
import { ReactComponent as DeleteIcon } from "assets/images/delete.svg";

export default function ConversationTitleDropdown({
  conversations = [],                 // [{ id, name }]
  selectedId = null,                  // current selected id (or null for none)
  onChange = () => { },               // (id|null) => void
  onDeleteItem = () => { },            // (id) => void
  placeholder = "Chọn sổ ghi chú",    // label when none is selected
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  // close on outside click
  useEffect(() => {
    function onDocClick(e) {
      if (!open) return;
      if (
        btnRef.current && !btnRef.current.contains(e.target) &&
        menuRef.current && !menuRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const selected = conversations.find(c => String(c.id) === String(selectedId)) || null;

  const handleSelect = (id) => {
    onChange(id);
    setOpen(false);
  };

  const filtered = q.trim()
    ? conversations.filter(c =>
      (c.name || String(c.id)).toLowerCase().includes(q.toLowerCase())
    )
    : conversations;

  return (
    <div className="title-dropdown">
      <button
        ref={btnRef}
        type="button"
        className="title-dropdown-btn"
        aria-haspopup="listbox"
        aria-expanded={open ? "true" : "false"}
        onClick={() => setOpen(v => !v)}
      >
        <span className="title-dropdown-label">
          {selected ? (selected.name || `#${selected.id}`) : placeholder}
        </span>
        <span className="title-dropdown-chevron">
          <ChevronDown />
        </span>
      </button>

      <div
        ref={menuRef}
        className={`title-menu ${open ? "open" : ""}`}
        role="listbox"
        tabIndex={-1}
      >
        <SearchBar
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={"Tìm kiếm sổ ghi chú"}
        />
        {/* TODO: implement search bar here, process on client */}
        {/* only dynamic items */}
        <div className="title-menu-scroll">
          {filtered.map((c) => {
            const isSelected = String(c.id) === String(selectedId);
            return (
              <div className="title-menu-item" key={c.id} role="option" aria-selected={isSelected ? "true" : "false"}>
                <span
                  className="title-menu-label"
                  tabIndex={0}
                  onClick={() => handleSelect(c.id)}
                >
                  {c.name || `#${c.id}`}
                </span>
                <span className="title-menu-icon-delete" title="Xoá sổ ghi chú">
                  <DeleteIcon onClick={(e) => { e.stopPropagation(); onDeleteItem(c.id, c.name); }} />
                </span>
              </div>
            );
          })}

          {/* empty state if no match */}
          {!filtered.length && (
            <div className="title-menu-item" role="option" tabIndex={-1} aria-disabled="true">
              Không có kết quả
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
