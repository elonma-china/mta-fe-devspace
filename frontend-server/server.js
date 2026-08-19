// IMPORTANT: Keep proxy routes in sync with frontend/src/setupProxy.js
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import 'dotenv/config';

// Fix __dirname for ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3000);
const TARGET = process.env.REACT_APP_DB_HOST;

if (!TARGET) {
  console.error('[server] Error: REACT_APP_DB_HOST is not set');
  process.exit(1);
}

const app = express();
const buildDir = path.join(__dirname, 'build');

app.set('trust proxy', true);

// --- Proxy Configuration ---

const commonProxyOptions = {
  target: TARGET,
  changeOrigin: true,
  logLevel: 'error', // Clean logs, only show errors
};

// 1. DB Proxy (/db -> /) with SSE Support
app.use('/db', createProxyMiddleware({
  ...commonProxyOptions,
  pathRewrite: { '^/db': '' },
  onProxyRes: (proxyRes, req) => {
    // Handle streaming headers for SSE endpoints
    if (req.url.includes('/documents/events')) {
      proxyRes.headers['Cache-Control'] = 'no-cache, no-transform';
      proxyRes.headers['X-Accel-Buffering'] = 'no';
      delete proxyRes.headers['content-length'];
    }
  }
}));

// 2. LLM Proxy (/llm -> /) with SSE Support
app.use('/llm', createProxyMiddleware({
  ...commonProxyOptions,
  pathRewrite: { '^/llm': '' },
  onProxyRes: (proxyRes, req) => {
    // Handle streaming headers for SSE endpoints
    if (req.url.includes('/query/stream')) {
      proxyRes.headers['Cache-Control'] = 'no-cache, no-transform';
      proxyRes.headers['X-Accel-Buffering'] = 'no';
      delete proxyRes.headers['content-length'];
    }
  }
}));

// 3. Tool Proxy (/tools -> backend /tools/...)
// PHẢI có pathRewrite ở ĐÂY, và phải KHÔNG có ở frontend/src/setupProxy.js —
// hai file chạy trên HAI phiên bản http-proxy-middleware khác nhau, hành vi
// ngược nhau (đã đọc trong package-lock của chính hai thư mục):
//   * dev  (`npm start`, CRA/webpack-dev-server) -> hpm 2.0.9: đọc
//     `req.originalUrl`, tức vẫn thấy `/tools/x`, nên thêm rewrite thành
//     `/tools/tools/x`.
//   * prod (file này)                            -> hpm 3.0.5: đọc `req.url`
//     mà Express ĐÃ cắt mount path, chỉ còn `/x`, nên không rewrite thì gateway
//     nhận `/audio-overview` -> 404 cho MỌI tool.
// Đo trên ccoex 2026-08-19: bỏ rewrite ở file này làm podcast/tóm tắt/mindmap/
// soạn thảo cùng chết 404, trong khi gọi thẳng gateway `/tools/audio-overview`
// vẫn 401 (route đúng). Đừng "đồng bộ" hai file cho giống nhau.
app.use('/tools', createProxyMiddleware({
  ...commonProxyOptions,
  pathRewrite: { '^/': '/tools/' },
  onProxyRes: (proxyRes, req) => {
    // Binary DOCX exports must stream, not buffer — a stale content-length
    // truncates the body. Audio-overview episodes are the same shape but far
    // bigger (tens of MB, and wav rather than mp3 on hosts without ffmpeg),
    // so truncation there is the likely case, not the edge case.
    // Keep this list in sync with frontend/src/setupProxy.js.
    if (
      req.url?.includes('/draft/export') ||
      req.url?.includes('/directive-review/export') ||
      req.url?.includes('/audio-overview/')
    ) {
      delete proxyRes.headers['content-length'];
    }
  },
}));

// --- Static Files & SPA ---

// index.html and the runtime-config files must NEVER be cached, so a rebuild is
// picked up immediately without a manual hard refresh. (Stale index.html keeps
// referencing old hashed bundles → app appears broken until Ctrl+Shift+R.)
const setNoCache = (res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
};

// Serve static assets: content-hashed files (e.g. /static/js/main.<hash>.js) are
// safe to cache for a long time + immutable; index.html / env-config.js /
// asset-manifest.json are forced no-cache.
app.use(express.static(buildDir, {
  maxAge: '1y',
  immutable: true,
  setHeaders: (res, filePath) => {
    if (
      filePath.endsWith('index.html') ||
      filePath.endsWith('env-config.js') ||
      filePath.endsWith('asset-manifest.json')
    ) {
      setNoCache(res);
    }
  },
}));

// SPA Fallback: send index.html for any client-route request. This MUST also be
// no-cache — express.static's setHeaders only applies to files it serves, not to
// this fallback, so without this a cached index.html (max-age) leaves users on a
// stale bundle after a rebuild.
app.get(/.*/, (req, res) => {
  setNoCache(res);
  res.sendFile(path.join(buildDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[server] Running on http://localhost:${PORT}`);
  console.log(`[server] Proxying API requests to: ${TARGET}`);
});