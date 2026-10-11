import type { CitySlug } from "../../data/types";
import type { Language } from "../../i18n/types";

/**
 * The boundary between the chat UI and whatever produces answers.
 *
 * Two implementations exist: `createMockAssistantClient` (local sample replies) and
 * `createHttpAssistantClient` (POST /api/chat). The app picks one at bootstrap
 * (`AppProviders`); the chat components only see this interface.
 */
export type AssistantRequest = {
  message: string;
  city: CitySlug | null;
  language: Language;
};

export type AssistantReplyKind = "answer" | "out-of-scope" | "fallback";

/** One knowledge-base record an answer is based on. */
export type AssistantSource = {
  recordId: string;
  title: string;
  sourceName: string;
  sourceUrl: string;
  topic: string;
  /** ISO date (YYYY-MM-DD) or ISO timestamp. */
  retrievedAt: string;
  /** `limited` sources are weaker evidence and are flagged in the UI. */
  recordStatus: "verified" | "limited";
};

export type AssistantReply = {
  text: string;
  kind: AssistantReplyKind;
  /** True when the reply is pre-written sample content rather than a grounded answer. */
  isSample: boolean;
  /** Sources of this reply. Non-empty for `answer`, empty otherwise (enforced for HTTP replies). */
  sources: AssistantSource[];
};

export type AssistantMode = "mock" | "http";

export interface AssistantClient {
  /** Shown to the user so mock replies are never mistaken for live answers. */
  readonly mode: AssistantMode;
  send(request: AssistantRequest, options?: { signal?: AbortSignal }): Promise<AssistantReply>;
}
