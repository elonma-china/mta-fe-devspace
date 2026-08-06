// src/config.js

// This function checks the injected runtime config first, 
// then falls back to build-time env (for local dev), then defaults.
export const getEnv = (key, defaultValue) => {
  if (window._env_ && window._env_[key]) {
    return window._env_[key];
  }
  return process.env[key] || defaultValue;
};

// API Prefixes
export const API_PREFIX = {
  DB: "/db",
  LLM: getEnv("REACT_APP_LLM_PREFIX", "/llm"),
  TOOL: getEnv("REACT_APP_TOOL_PREFIX", "/tools"),
};

// ── Branding ────────────────────────────────────────────────
// "devspace" switches the app to the red Dev Space skin and the DEV SPACE
// logo. Anything else (including unset, the default) is stock IntraMind —
// so the skin can be dropped from a handover diff by deleting two files.
export const BRAND = getEnv("REACT_APP_BRAND", "intramind");
export const IS_DEVSPACE = BRAND === "devspace";

// Dev Space reads a corpus it does not own. This hides the controls; the
// gateway's DEV_READONLY_CORPUS is what actually refuses the writes, because
// hiding a button is bypassable and deleting a real document is not
// recoverable.
export const READONLY_CORPUS =
  String(getEnv("REACT_APP_READONLY_CORPUS", "false")).toLowerCase() === "true";