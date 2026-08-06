// src/features/chat/api/llm.js
import { requestStream } from "lib/apiClient";
import { API_PREFIX } from "config";

/**
 * Initiate an SSE stream to the LLM backend.
 * Returns the raw Response for parseSSE() consumption.
 *
 * The streaming loop and AbortController management are handled
 * by useChatStore — this function is a thin API layer only.
 */
export async function streamQuery(
  payload,
  { userId, conversationId, documentIds, signal } = {}
) {
  // Build query params
  const params = {};
  if (conversationId) params.conversation_id = conversationId;
  if (userId) params.user_id = userId;
  if (Array.isArray(documentIds)) {
    params.document_ids = documentIds.filter(
      (id) => id != null && String(id).trim()
    );
  }

  return requestStream("/query/stream", {
    method: "POST",
    body: payload,
    params,
    prefix: API_PREFIX.LLM,
    signal,
  });
}