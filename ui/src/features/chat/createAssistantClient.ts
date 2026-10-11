import type { AssistantClient } from "./assistantClient";
import { createHttpAssistantClient } from "./httpAssistantClient";
import { createMockAssistantClient } from "./mockAssistantClient";

type SelectionInput = {
  /** Value of VITE_ASSISTANT_MODE: "mock" or "http" (unset means: mock in development, http in production). */
  mode: string | undefined;
  production: boolean;
};

/**
 * The only place that chooses between the mock and the HTTP client.
 * Production always gets the HTTP client; asking for the mock there is a configuration error
 * and fails loudly instead of quietly serving sample answers.
 */
export function selectAssistantClient({ mode, production }: SelectionInput): AssistantClient {
  if (mode !== undefined && mode !== "mock" && mode !== "http") {
    throw new Error(`VITE_ASSISTANT_MODE must be "mock" or "http", got "${mode}"`);
  }
  if (production) {
    if (mode === "mock") throw new Error("VITE_ASSISTANT_MODE=mock is not allowed in a production build");
    return createHttpAssistantClient();
  }
  return mode === "http" ? createHttpAssistantClient() : createMockAssistantClient();
}

/** Builds the client from Vite's environment. Called once at bootstrap. */
export function createAssistantClientFromEnv(): AssistantClient {
  return selectAssistantClient({
    mode: import.meta.env.VITE_ASSISTANT_MODE || undefined,
    production: import.meta.env.PROD,
  });
}
