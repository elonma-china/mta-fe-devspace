// src/__tests__/proxyExportSync.test.js
// setupProxy.js (dev) and frontend-server/server.js (prod) must strip
// content-length for the SAME set of binary export paths. A divergence is a
// prod-only bug that never reproduces locally — so guard it in CI.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../..");
const DEV_PROXY = path.join(ROOT, "frontend/src/setupProxy.js");
const PROD_PROXY = path.join(ROOT, "frontend-server/server.js");

const EXPORT_PATHS = ["/draft/export", "/directive-review/export"];

describe("binary export paths strip content-length in both proxies", () => {
  test.each([
    ["dev (setupProxy.js)", DEV_PROXY],
    ["prod (frontend-server/server.js)", PROD_PROXY],
  ])("%s references every export path", (_label, file) => {
    const src = fs.readFileSync(file, "utf8");
    for (const p of EXPORT_PATHS) {
      expect(src).toContain(p);
    }
    expect(src).toContain("content-length");
  });
});
