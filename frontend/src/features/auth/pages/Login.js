// src/features/auth/pages/Login.js
import React, { useState } from "react";
import "./Login.css";
import { login as apiLogin } from "../api";
import { ReactComponent as Logo } from "assets/images/logo-fullcolor.svg";
import { ReactComponent as EyeIcon } from "assets/images/eye.svg";

function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      if (onLogin) {
        // Delegate to App.js (preferred: App handles storing token + routing)
        await onLogin({ username: username.trim(), password });
      } else {
        // Fallback: keep old local behavior if onLogin not provided
        const data = await apiLogin(username, password);
        localStorage.setItem("token", data.token);
        // If you want to soft-redirect without react-router here:
        window.location.assign("/chat");
      }
    } catch (err) {
      setError(err?.message || "Login failed");
      setSubmitting(false);
    }
  }

  return (
    <div id="login-container">
      {/* Left side */}
      <div id="login-left" className="login-left">
        <Logo className="login-logo" />
        <h1 className="login-heading">IntraMind - Trợ lý ảo nội bộ</h1>
        <p className="login-subtitle">Thông Minh - An Toàn - Tin Cậy</p>
      </div>

      {/* Right side */}
      <form id="login-form" className="login-form" onSubmit={handleSubmit} autoComplete="on">
        {/* Username field */}
        <div className="form-group">
          <label htmlFor="username" className="form-label">
            Tên đăng nhập
          </label>
          <input
            placeholder="Nhập tên đăng nhập"
            id="username"
            className="form-input"
            type="text"
            name="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="username"
          />
        </div>

        {/* Password field with eye icon */}
        <div className="form-group password-group">
          <label htmlFor="password" className="form-label">
            Mật khẩu
          </label>
          <div className="password-input-wrapper">
            <input
              placeholder="Nhập mật khẩu"
              id="password"
              className="form-input"
              type={showPw ? "text" : "password"}
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
            <button
              type="button"
              className="toggle-password"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "Hide password" : "Show password"}
              tabIndex={0}
            >
              <EyeIcon className="eye-icon" />
            </button>
          </div>
        </div>

        {error && (
          <p id="login-error" className="login-error" role="alert">
            {error}
          </p>
        )}

        <div className="submit-row">
          <button
            id="login-button"
            className="login-button"
            type="submit"
            disabled={submitting}
            aria-busy={submitting}
          >
            {submitting ? "Đang đăng nhập..." : "Tiếp tục"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default Login;
