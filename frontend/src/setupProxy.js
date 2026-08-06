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

  // Tools proxy (/tools -> backend /tools/...)
  app.use(
    '/tools',
    createProxyMiddleware({
      target: process.env.REACT_APP_DB_HOST,
      changeOrigin: true,
      pathRewrite: { '^/': '/tools/' },
      onProxyRes(proxyRes, req) {
        // Binary DOCX exports must stream, not buffer — a stale content-length
        // truncates the body. Keep this list in sync with frontend-server/server.js.
        if (
          req.url?.includes('/draft/export') ||
          req.url?.includes('/directive-review/export')
        ) {
          delete proxyRes.headers['content-length'];
        }
      },
      logLevel: 'warn',
    })
  );
};
