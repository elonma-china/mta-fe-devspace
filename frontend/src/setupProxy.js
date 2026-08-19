// IMPORTANT: Keep proxy routes in sync with frontend-server/server.js
// src/setupProxy.js  (CommonJS for CRA)
const { createProxyMiddleware } = require('http-proxy-middleware');

function assertEnv(name) {
  if (!process.env[name]) {
    console.warn(`[setupProxy] Warning: ${name} is not set`);
  }
}

module.exports = function (app) {
  assertEnv('REACT_APP_DB_HOST');

  // SSE document events streaming endpoint
  app.use(
    '/db/users/:userId/conversations/:convId/documents/events',
    createProxyMiddleware({
      target: process.env.REACT_APP_DB_HOST,
      changeOrigin: true,
      headers: { Connection: 'keep-alive' },
      pathRewrite: { '^/db': '/' },
      onProxyRes(proxyRes, req, res) {
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        if (proxyRes.headers['content-length']) {
          delete proxyRes.headers['content-length'];
        }
      },
      proxyTimeout: 0,
      timeout: 0,
      logLevel: 'warn',
    })
  );

  // /db -> your DB server (5050), strip the /db prefix
  app.use(
    '/db',
    createProxyMiddleware({
      target: process.env.REACT_APP_DB_HOST, // e.g. http://localhost:5050
      changeOrigin: true,
      pathRewrite: { '^/db': '/' },
      logLevel: 'warn',
    })
  );

  // SSE streaming endpoint
  app.use(
    '/llm/query/stream',
    createProxyMiddleware({
      target: process.env.REACT_APP_DB_HOST,
      changeOrigin: true,
      ws: false, // allow websockets if your server upgrades
      pathRewrite: { '^/llm': '/' },
      headers: { Connection: 'keep-alive' },
      onProxyRes(proxyRes, req, res) {
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no'); // nginx hint
        if (proxyRes.headers['content-length']) {
          delete proxyRes.headers['content-length']; // avoid buffering issues
        }
      },
      proxyTimeout: 0,
      timeout: 0,
      logLevel: 'warn',
    })
  );

  // /llm -> gateway, tổng quát. PHẢI đứng SAU '/llm/query/stream' ở trên:
  // Express match theo thứ tự đăng ký, mount tổng quát đặt trước sẽ ăn luôn
  // đường SSE và mất các header no-buffering của nó.
  //
  // Thiếu mount này là lý do nút mic không hoạt động: FE gọi
  // `/llm/stt/transcribe` (prefix API_PREFIX.LLM) nhưng dev server không có
  // route nào khớp nên Express trả 404 "Cannot POST /llm/stt/transcribe" —
  // trước cả khi request tới gateway. `frontend-server/server.js` (đường
  // production) vốn đã có mount này; hai file lẽ ra phải đồng bộ.
  //
  // Gateway include voice.router KHÔNG có prefix, route thật là
  // `POST /stt/transcribe`, nên phải cắt `/llm` đi.
  app.use(
    '/llm',
    createProxyMiddleware({
      target: process.env.REACT_APP_DB_HOST,
      changeOrigin: true,
      pathRewrite: { '^/llm': '' },
      logLevel: 'warn',
    })
  );

  // Tools proxy (/tools -> backend /tools/...)
  app.use(
    '/tools',
    createProxyMiddleware({
      target: process.env.REACT_APP_DB_HOST,
      changeOrigin: true,
      // KHÔNG pathRewrite ở đây. `pathRewrite` của http-proxy-middleware 2.0.9
      // nhận đường dẫn ĐẦY ĐỦ (`/tools/audio-overview`), không phải phần đã bị
      // `app.use('/tools')` cắt — chính vì vậy `^/db` -> `/` ở trên mới chạy
      // đúng. Bản cũ dùng `{'^/': '/tools/'}` với giả định ngược lại nên gateway
      // nhận `/tools/tools/...` và trả 404 cho MỌI lời gọi tool từ trình duyệt
      // (summary, mindmap, drafting, audio-overview). Gateway đã mong đúng
      // `/tools/...` nên để nguyên là đúng.
      onProxyRes(proxyRes, req) {
        // Binary DOCX exports must stream, not buffer — a stale content-length
        // truncates the body. Audio-overview episodes are the same shape but far
        // bigger (tens of MB, and wav rather than mp3 on hosts without ffmpeg),
        // so truncation there is the likely case, not the edge case.
        // Keep this list in sync with frontend-server/server.js.
        if (
          req.url?.includes('/draft/export') ||
          req.url?.includes('/directive-review/export') ||
          req.url?.includes('/audio-overview/')
        ) {
          delete proxyRes.headers['content-length'];
        }
      },
      logLevel: 'warn',
    })
  );
};
