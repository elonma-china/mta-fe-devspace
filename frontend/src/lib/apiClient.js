// src/lib/apiClient.js
import { API_PREFIX } from "../config";
import useAuthStore from "../stores/useAuthStore";

export class ApiError extends Error {
  constructor(message, status, detail = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Generic request wrapper
 * @param {string} endpoint - relative path (e.g. '/users')
 * @param {object} options
 * @param {string} [options.method='GET']
 * @param {object} [options.body] - JSON object or FormData
 * @param {object} [options.headers]
 * @param {string} [options.prefix] - API_PREFIX.DB, LLM, or TOOL
 * @param {AbortSignal} [options.signal]
 */
export async function request(endpoint, { 
  method = "GET", 
  body, 
  headers = {}, 
  prefix = API_PREFIX.DB, 
  params,
  signal 
} = {}) {
  
  // 1. Handle URL
  // Remove trailing slash from prefix and leading slash from endpoint to avoid double //
  const cleanPrefix = prefix.replace(/\/+$/, "");
  const cleanEndpoint = endpoint.replace(/^\/+/, "");
  let url = `${cleanPrefix}/${cleanEndpoint}`;

  if (params && Object.keys(params).length > 0) {
    const queryString = new URLSearchParams(params).toString();
    url += (url.includes("?") ? "&" : "?") + queryString;
  }

  // 2. Handle Auth
  const token = localStorage.getItem("token");
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  // 3. Handle Content-Type
  const isFormData = body instanceof FormData;
  const contentHeaders = isFormData 
    ? {} // Browser sets boundary automatically for FormData
    : { "Content-Type": "application/json" };

  // 4. Execute Fetch
  const res = await fetch(url, {
    method,
    cache: "no-cache",
    headers: {
      ...contentHeaders,
      ...authHeaders,
      ...headers,
    },
    body: isFormData ? body : (body ? JSON.stringify(body) : undefined),
    signal,
  });

  // 5. Handle Errors
  if (!res.ok) {
    // Read body as text first — ReadableStream can only be consumed once
    const text = await res.text();
    let msg = "";
    let detail = null;
    try {
      const errorBody = JSON.parse(text);
      if (errorBody.error) {
        msg = errorBody.error;
        if (errorBody.detail) {
          detail = errorBody.detail;
          msg += ` - ${errorBody.detail}`;
        }
      } else if (errorBody.detail) {
        msg = errorBody.detail;
        detail = errorBody.detail;
      } else {
        msg = text || res.statusText;
      }
    } catch {
      msg = text || res.statusText;
    }

    if (res.status === 401 && !url.endsWith("/login")) {
      const logout = useAuthStore.getState().logout;
      if (logout) logout();
    }

    throw new ApiError(msg || `HTTP ${res.status}`, res.status, detail);
  }

  // 6. Return Data
  // If response is empty (e.g. 204 No Content), return null
  if (res.status === 204) return null;

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  return res.text();
}

/**
 * Same as request() but returns the raw Response for SSE streaming.
 * Does NOT consume the body — caller is responsible for reading the stream.
 *
 * @param {string} endpoint - relative path
 * @param {object} options
 * @param {string} [options.method='POST']
 * @param {object} [options.body] - JSON object
 * @param {object} [options.headers]
 * @param {string} [options.prefix] - API_PREFIX.LLM by default
 * @param {object} [options.params] - query params
 * @param {AbortSignal} [options.signal]
 */
export async function requestStream(endpoint, {
  method = "POST",
  body,
  headers = {},
  prefix = API_PREFIX.LLM,
  params,
  signal,
} = {}) {
  // 1. Handle URL (same as request)
  const cleanPrefix = prefix.replace(/\/+$/, "");
  const cleanEndpoint = endpoint.replace(/^\/+/, "");
  let url = `${cleanPrefix}/${cleanEndpoint}`;

  if (params && Object.keys(params).length > 0) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) {
        v.forEach((item) => qs.append(k, item));
      } else if (v != null) {
        qs.set(k, v);
      }
    }
    const qsStr = qs.toString();
    if (qsStr) url += (url.includes("?") ? "&" : "?") + qsStr;
  }

  // 2. Handle Auth
  const token = localStorage.getItem("token");
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  // 3. Execute Fetch
  const res = await fetch(url, {
    method,
    cache: "no-cache",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...authHeaders,
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  // 4. Handle Errors (same pattern as request)
  if (!res.ok) {
    const text = await res.text();
    let msg = "";
    let detail = null;
    try {
      const errorBody = JSON.parse(text);
      if (errorBody.error) {
        msg = errorBody.error;
        if (errorBody.detail) {
          detail = errorBody.detail;
          msg += ` - ${errorBody.detail}`;
        }
      } else if (errorBody.detail) {
        msg = errorBody.detail;
        detail = errorBody.detail;
      } else {
        msg = text || res.statusText;
      }
    } catch {
      msg = text || res.statusText;
    }

    if (res.status === 401 && !url.endsWith("/login")) {
      const logout = useAuthStore.getState().logout;
      if (logout) logout();
    }

    throw new ApiError(msg || `HTTP ${res.status}`, res.status, detail);
  }

  // 5. Return raw Response (caller reads the stream)
  return res;
}

/**
 * GET a binary resource (e.g. a PDF / image) as a Blob, with the same auth as
 * {@link request}. Browsers cannot set an Authorization header on <img>/<iframe>
 * src, so binary documents must be fetched this way and wrapped in an object
 * URL. Throws {@link ApiError} on a non-2xx status.
 *
 * @param {string} endpoint - relative path
 * @param {object} [options]
 * @param {string} [options.prefix] - API_PREFIX.DB by default
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Blob>}
 */
export async function requestBlob(endpoint, {
  prefix = API_PREFIX.DB,
  signal,
} = {}) {
  const cleanPrefix = prefix.replace(/\/+$/, "");
  const cleanEndpoint = endpoint.replace(/^\/+/, "");
  const url = `${cleanPrefix}/${cleanEndpoint}`;

  const token = localStorage.getItem("token");
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  const res = await fetch(url, {
    method: "GET",
    cache: "no-cache",
    headers: { ...authHeaders },
    signal,
  });

  if (!res.ok) {
    if (res.status === 401 && !url.endsWith("/login")) {
      const logout = useAuthStore.getState().logout;
      if (logout) logout();
    }
    throw new ApiError(`HTTP ${res.status}`, res.status);
  }

  return res.blob();
}

/** Filename out of a Content-Disposition header; the RFC 5987 form wins. */
function filenameFromDisposition(header) {
  if (!header) return null;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      /* malformed percent-encoding — fall through to the plain form */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
}

/**
 * POST a JSON body and receive a binary Blob (e.g. DOCX export).
 * Resolves to `{blob, filename}` — the server names the file, not the caller.
 */
export async function requestPostBlob(endpoint, {
  body,
  prefix = API_PREFIX.DB,
  signal,
} = {}) {
  const cleanPrefix = prefix.replace(/\/+$/, "");
  const cleanEndpoint = endpoint.replace(/^\/+/, "");
  const url = `${cleanPrefix}/${cleanEndpoint}`;

  const token = localStorage.getItem("token");
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  const res = await fetch(url, {
    method: "POST",
    cache: "no-cache",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    let msg = text || `HTTP ${res.status}`;
    try {
      const err = JSON.parse(text);
      msg = err.detail || err.error || msg;
    } catch {
      /* keep text */
    }
    if (res.status === 401 && !url.endsWith("/login")) {
      const logout = useAuthStore.getState().logout;
      if (logout) logout();
    }
    throw new ApiError(msg, res.status);
  }

  return {
    blob: await res.blob(),
    filename: filenameFromDisposition(res.headers.get("content-disposition")),
  };
}

export const apiClient = {
  get: (url, opts) => request(url, { ...opts, method: "GET" }),
  getBlob: (url, opts) => requestBlob(url, opts),
  post: (url, body, opts) => request(url, { ...opts, method: "POST", body }),
  postBlob: (url, body, opts) => requestPostBlob(url, { ...opts, body }),
  put: (url, body, opts) => request(url, { ...opts, method: "PUT", body }),
  patch: (url, body, opts) => request(url, { ...opts, method: "PATCH", body }),
  delete: (url, opts) => request(url, { ...opts, method: "DELETE" }),
  stream: (url, body, opts) => requestStream(url, { ...opts, method: "POST", body }),
};