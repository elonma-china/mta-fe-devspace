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