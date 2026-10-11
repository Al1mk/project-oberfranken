import type { AssistantReply, AssistantReplyKind, AssistantSource } from "./assistantClient";
import { isIsoDateOrTimestamp } from "../../lib/isoDate";

export type AssistantErrorCode = "network" | "timeout" | "http" | "invalid-json" | "contract";

/** A failed assistant request. `code` selects the message shown to the user. */
export class AssistantError extends Error {
  readonly code: AssistantErrorCode;
  readonly status?: number;

  constructor(code: AssistantErrorCode, detail: string, status?: number) {
    super(detail);
    this.name = "AssistantError";
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

const KINDS: readonly AssistantReplyKind[] = ["answer", "out-of-scope", "fallback"];
const STATUSES = ["verified", "limited"] as const;

function contract(detail: string): never {
  throw new AssistantError("contract", detail);
}

function nonEmpty(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") contract(`${path} must be a non-empty string`);
  return value as string;
}

function parseSource(value: unknown, index: number): AssistantSource {
  const path = `sources[${index}]`;
  if (typeof value !== "object" || value === null || Array.isArray(value)) contract(`${path} must be an object`);
  const source = value as Record<string, unknown>;

  const sourceUrl = nonEmpty(source.sourceUrl, `${path}.sourceUrl`);
  let protocol = "";
  try {
    protocol = new URL(sourceUrl).protocol;
  } catch {
    contract(`${path}.sourceUrl must be an absolute URL`);
  }
  // The URL ends up in an href; never accept javascript:, data: and the like.
  if (protocol !== "https:" && protocol !== "http:") contract(`${path}.sourceUrl must be an http(s) URL`);

  const retrievedAt = nonEmpty(source.retrievedAt, `${path}.retrievedAt`);
  if (!isIsoDateOrTimestamp(retrievedAt)) contract(`${path}.retrievedAt must be an ISO date`);

  const recordStatus = source.recordStatus;
  if (!(STATUSES as readonly unknown[]).includes(recordStatus)) contract(`${path}.recordStatus must be verified or limited`);

  return {
    recordId: nonEmpty(source.recordId, `${path}.recordId`),
    title: nonEmpty(source.title, `${path}.title`),
    sourceName: nonEmpty(source.sourceName, `${path}.sourceName`),
    sourceUrl,
    topic: nonEmpty(source.topic, `${path}.topic`),
    retrievedAt,
    recordStatus: recordStatus as AssistantSource["recordStatus"],
  };
}

/**
 * Validates the JSON body of POST /api/chat. Anything outside the contract throws a
 * `contract` AssistantError instead of being rendered: an answer without sources is a bug.
 */
export function parseAssistantReply(value: unknown): AssistantReply {
  if (typeof value !== "object" || value === null || Array.isArray(value)) contract("the reply must be a JSON object");
  const body = value as Record<string, unknown>;

  const text = nonEmpty(body.text, "text");
  if (!(KINDS as readonly unknown[]).includes(body.kind)) contract("kind must be answer, out-of-scope or fallback");
  const kind = body.kind as AssistantReplyKind;
  if (typeof body.isSample !== "boolean") contract("isSample must be a boolean");
  if (!Array.isArray(body.sources)) contract("sources is required and must be an array");

  const sources = (body.sources as unknown[]).map(parseSource);
  if (kind === "answer" && sources.length === 0) contract("an answer needs at least one source");
  if (kind !== "answer" && sources.length > 0) contract(`a ${kind} reply must not list sources`);

  return { text, kind, isSample: body.isSample as boolean, sources };
}
