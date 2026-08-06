// src/components/common/ErrorBoundary.js
import React from "react";

/**
 * ErrorBoundary — contains a render error so it never unmounts the whole app
 * (story 52: a PDF viewer crash used to white-screen the entire SPA).
 *
 * Renders `fallback` when a descendant throws; the rest of the tree (outside the
 * boundary) keeps working. Pass `resetKey` (e.g. the document id / route path):
 * when it changes the boundary clears its error and retries rendering children.
 *
 * Must be a class — React error boundaries have no hook equivalent.
 *
 * @typedef {object} Props
 * @property {React.ReactNode} children
 * @property {React.ReactNode} [fallback]  shown on error (default message used otherwise)
 * @property {*} [resetKey]                changing it clears the error state
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Surface the error for debugging without crashing the app.
    // eslint-disable-next-line no-console
    console.error("ErrorBoundary caught an error:", error, info);
  }

  componentDidUpdate(prevProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      // A new target (doc/route) — try rendering again.
      // eslint-disable-next-line react/no-did-update-set-state
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback !== undefined ? (
        this.props.fallback
      ) : (
        <div className="error-boundary-fallback" role="alert">
          Đã xảy ra lỗi khi hiển thị nội dung này.
        </div>
      );
    }
    return this.props.children;
  }
}
