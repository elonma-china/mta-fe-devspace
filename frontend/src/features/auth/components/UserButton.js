// src/features/auth/components/UserButton.js
import React from "react";
import "./UserButton.css";

export default function UserButton({
  username = "",
  name = "Người dùng",
  photoUrl,
  onClick,
  title = "Tài khoản",
}) {
  const initial = (
    (typeof username === "string" && username.trim().charAt(0)) ||
    (typeof name === "string" && name.trim().charAt(0)) ||
    "U"
  ).toUpperCase();

  return (
    <button
      type="button"
      className="user-btn"
      onClick={onClick}
      title={title}
      aria-label={username || name}
    >
      <span className="avatar" aria-hidden="true">
        <span className="avatar-container">
          {photoUrl ? (
            <img src={photoUrl} alt="" draggable={false} />
          ) : (
            <span className="avatar-label">{initial}</span>
          )}
        </span>
      </span>
    </button>
  );
}
