/**
 * SSE (Server-Sent Events) parser for streaming responses.
 *
 * Async generator that reads a Response body stream,
 * splits on `\n`, and parses `data: {JSON}` lines.
 *
 * Ported from texttoSQL/frontend/src/utils/sse.js and adapted
 * for the chatbot's SSE event format.
 *
 * Usage:
 *   const response = await fetch(...)
 *   for await (const event of parseSSE(response)) {
 *     console.log(event)
 *   }
 */
export async function* parseSSE(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split("\n");
      // Keep the last (potentially incomplete) line in buffer
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();

        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith(":")) continue;

        // Parse "data: {...}" or "data:{...}" lines
        if (trimmed.startsWith("data:")) {
          const jsonStr = trimmed.slice(5).trim();
          if (jsonStr === "[DONE]") return;
          try {
            const parsed = JSON.parse(jsonStr);
            yield parsed;
          } catch {
            // Not valid JSON — skip
          }
        }
      }
    }

    // Process any remaining buffer content
    if (buffer.trim() && buffer.trim().startsWith("data:")) {
      const jsonStr = buffer.trim().slice(5).trim();
      if (jsonStr && jsonStr !== "[DONE]") {
        try {
          yield JSON.parse(jsonStr);
        } catch {
          // ignore
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
