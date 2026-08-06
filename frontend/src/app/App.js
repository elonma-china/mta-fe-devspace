// src/app/App.js
import React, { useEffect, useCallback, useState } from "react";
import { Routes, Route, useNavigate, useLocation, Navigate, Outlet } from "react-router-dom";

import { Header, Footer } from "components";
import ErrorBoundary from "components/common/ErrorBoundary";
import { Chat } from "features/chat/pages";
import { Login } from "features/auth/pages";
import { UserManagement, AuditLogs, DocumentManagement } from "features/admin/pages";
import { UnitRepository } from "features/documents/pages";
import { getMe, logout as apiLogout } from "features/auth/api/auth";
import { loginAndLoadUser } from "features/auth/api/authFlow";
import useModalStore from "stores/useModalStore";
import useAuthStore from "stores/useAuthStore";
import { clearFocus } from "features/admin/utils/docRepoFocus";
import { canManageDocuments } from "lib/roles";
// -------------------------------------------------------------

import "./App.css";

// Helper Layout for authenticated pages
const MainLayout = ({ title }) => {
  return (
    <main className="main-page">
      <Header themeButtonTitle="" brand={title} />
      {/* Scrollable content area */}
      <section style={{ flex: 1, overflowY: 'auto', width: '100%' }}>
        <Outlet />
      </section>
    </main>
  );
};

// Helper for protected routes.
//
// ``adminOnly`` gates the user/unit administration domain on is_admin. Story 66:
// ``requireDocuments`` gates the repository ("Kho tài liệu") domain on the
// document capability so the commander role (is_admin false) may enter, while a
// regular user still cannot.
const ProtectedRoute = ({ children, adminOnly = false, requireDocuments = false }) => {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/" replace />;
  if (adminOnly && !user.is_admin) return <Navigate to="/chat" replace />;
  if (requireDocuments && !canManageDocuments(user)) return <Navigate to="/chat" replace />;
  return children ? children : <Outlet />;
};

function AppContent() {
  const { user, setUser, setLogout } = useAuthStore();

  const [booting, setBooting] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  // Register the logout function in the store so any component can call it
  const handleLogout = useCallback(async () => {
    try { await apiLogout(); } catch { }
    localStorage.removeItem("token");
    // Drop the document-repository focus unit so it never leaks to the next user.
    clearFocus();
    setUser(null);
    navigate("/");
  }, [setUser, navigate]);

  useEffect(() => {
    setLogout(handleLogout);
  }, [handleLogout, setLogout]);

  // Restore session (runs once on mount)
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      setBooting(false);
      return;
    }
    (async () => {
      try {
        const me = await getMe();
        setUser(me);
      } catch {
        localStorage.removeItem("token");
        setUser(null);
      } finally {
        setBooting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setUser]);

  async function handleLogin({ username, password }) {
    // Story 67: resolve the user from /me (not the login response) so the
    // permission set is present immediately — otherwise the commander role loses
    // its kho UI until a reload. A /me failure clears the token and rethrows so
    // the login form surfaces it as a failed login.
    const me = await loginAndLoadUser(username, password);
    setUser(me);
    navigate("/chat");
  }

  if (booting) return null;

  return (
    <div id="app-body">
      {/* Story 52: a crash in any page (e.g. the document viewer) must NOT
          white-screen the whole app. This boundary shows a recoverable message
          and resets when the route changes. */}
      <ErrorBoundary
        resetKey={location.pathname}
        fallback={
          <div className="app-error-fallback" role="alert">
            <p>Đã xảy ra lỗi khi hiển thị trang này.</p>
            <button type="button" onClick={() => window.location.reload()}>
              Tải lại trang
            </button>
          </div>
        }
      >
        <Routes>
        {/* PUBLIC ROUTE */}
        <Route
          path="/"
          element={
            user ? <Navigate to="/chat" replace /> : <Login onLogin={handleLogin} />
          }
        />

        {/* PROTECTED ROUTES */}
        <Route element={<ProtectedRoute />}>
          <Route element={<MainLayout />}>

            <Route path="/chat" element={<Chat />} />
            <Route path="/chat/:conversationId" element={<Chat />} />

            {/* Story 82: a regular user's READ-ONLY view of their own unit's
                document repository. NOT gated on requireDocuments — any logged-in
                user (with a unit) may view their unit's documents; admins/commander
                use /document-management instead (routed by the header). */}
            <Route path="/unit-repository" element={<UnitRepository />} />

            {/* ADMIN ROUTES — user/unit administration (is_admin only) */}
            <Route element={<ProtectedRoute adminOnly={true} />}>
              <Route
                path="/user-management"
                element={<UserManagement />}
              />
              <Route
                path="/audit-logs"
                element={<AuditLogs />}
              />
            </Route>

            {/* Repository "Kho tài liệu" — admins OR the commander role (story 66) */}
            <Route element={<ProtectedRoute requireDocuments={true} />}>
              <Route
                path="/document-management"
                element={<DocumentManagement />}
              />
            </Route>

          </Route>
        </Route>

        {/* CATCH ALL */}
        <Route path="*" element={<Navigate to={user ? "/chat" : "/"} replace />} />
        </Routes>
      </ErrorBoundary>

      <Footer />
    </div>
  );
}

// Thin renderer for the global modal store
function ModalRenderer() {
  const { component: Component, props, isOpen } = useModalStore();
  if (!Component && !isOpen) return null;
  return (
    <Component
      open={isOpen}
      onClose={useModalStore.getState().hideModal}
      {...props}
    />
  );
}

function App() {
  return (
    <>
      <AppContent />
      <ModalRenderer />
    </>
  );
}

export default App;