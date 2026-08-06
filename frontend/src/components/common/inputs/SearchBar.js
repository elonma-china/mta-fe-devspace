// src/components/common/inputs/SearchBar.js
import React from "react";
import "./SearchBar.css"; // optional, if you already have styles
import { ReactComponent as SearchIcon } from "assets/images/search.svg";
import { ReactComponent as MenuIcon } from "assets/images/three-line.svg";

/**
 * SearchBar — a pill search input with a trailing magnifier icon.
 *
 * @param {object} props
 * @param {string} props.value
 * @param {(e: React.ChangeEvent<HTMLInputElement>) => void} props.onChange
 * @param {string} [props.placeholder]
 * @param {boolean} [props.showMenuIcon] Story 116: opt-in leading 3-line glyph
 *   (display-only). Default off so shared/nested consumers are unaffected.
 */
export default function SearchBar({ value, onChange, placeholder, showMenuIcon = false }) {
    return (
        <div className={`searchbar${showMenuIcon ? " searchbar--with-menu" : ""}`}>
            {showMenuIcon && (
                <span className="searchbar__menu-icon" aria-hidden>
                    <MenuIcon />
                </span>
            )}
            <input
                type="text"
                className="searchbar__input"
                placeholder={placeholder}
                value={value}
                onChange={onChange}
            />
            <span className="searchbar__icon" aria-hidden title="Tìm kiếm">
                <SearchIcon />
            </span>
        </div>
    );
}
