import type { AssistantClient, AssistantReply, AssistantRequest } from "./assistantClient";
import { AssistantError, parseAssistantReply } from "./assistantContract";

export const CHAT_TIMEOUT_MS = 30_000;

type HttpClientOptions = {
  endpoint?: string;
  timeoutMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
};

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

/**
 * Talks to the backend at POST /api/chat. The browser never holds a model key:
 * the backend owns retrieval and generation. No streaming, no history.
 */
export function createHttpAssistantClient({ endpoint = "/api/chat", timeoutMs = CHAT_TIMEOUT_MS, fetchImpl }: HttpClientOptions = {}): AssistantClient {
  return {
    mode: "http",
    async send(request: AssistantRequest, options): Promise<AssistantReply> {
      const callerSignal = options?.signal;
      if (callerSignal?.aborted) throw abortError();

      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const forwardAbort = () => controller.abort();
      callerSignal?.addEventListener("abort", forwardAbort, { once: true });

      try {
        const doFetch = fetchImpl ?? fetch;
        let response: Response;
        try {
          response = await doFetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ message: request.message, city: request.city, language: request.language }),
            signal: controller.signal,
          });
        } catch (error) {
          if (timedOut) throw new AssistantError("timeout", `no reply within ${timeoutMs} ms`);
          if (callerSignal?.aborted) throw abortError();
          throw new AssistantError("network", error instanceof Error ? error.message : "request failed");
        }

        if (!response.ok) throw new AssistantError("http", `HTTP ${response.status}`, response.status);

        let body: unknown;
        try {
          body = await response.json();
        } catch {
          if (timedOut) throw new AssistantError("timeout", `no reply within ${timeoutMs} ms`);
          if (callerSignal?.aborted) throw abortError();
          throw new AssistantError("invalid-json", "the response body is not valid JSON");
        }
        return parseAssistantReply(body);
      } finally {
        clearTimeout(timer);
        callerSignal?.removeEventListener("abort", forwardAbort);
      }
    },
  };
}
