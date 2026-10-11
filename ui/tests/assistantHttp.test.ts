import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistantRequest } from "../src/features/chat/assistantClient";
import { AssistantError, parseAssistantReply } from "../src/features/chat/assistantContract";
import { createHttpAssistantClient } from "../src/features/chat/httpAssistantClient";
import { selectAssistantClient } from "../src/features/chat/createAssistantClient";
import { createMockAssistantClient } from "../src/features/chat/mockAssistantClient";

const SOURCE = {
  recordId: "BA-REST-01",
  title: "Schlenkerla",
  sourceName: "Bamberg Tourismus",
  sourceUrl: "https://www.schlenkerla.de/schlenkerla/karte/speisen.html",
  topic: "regional-food",
  retrievedAt: "2026-10-08",
  recordStatus: "verified",
};
const ANSWER = { text: "Try the Bamberg onion.", kind: "answer", isSample: false, sources: [SOURCE] };
const FALLBACK = { text: "I do not know.", kind: "fallback", isSample: false, sources: [] };
const REQUEST: AssistantRequest = { message: "Where can I try smoked beer?", city: "bamberg", language: "en" };

const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init });
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error);

describe("parseAssistantReply (response contract)", () => {
  it("accepts an answer with sources, and limited sources", () => {
    expect(parseAssistantReply(ANSWER)).toEqual(ANSWER);
    const limited = { ...ANSWER, sources: [{ ...SOURCE, recordStatus: "limited" }] };
    expect(parseAssistantReply(limited).sources[0]?.recordStatus).toBe("limited");
  });

  it("accepts fallback and out-of-scope replies with an empty sources array", () => {
    expect(parseAssistantReply(FALLBACK).sources).toEqual([]);
    expect(parseAssistantReply({ ...FALLBACK, kind: "out-of-scope" }).kind).toBe("out-of-scope");
  });

  it("accepts an ISO timestamp as retrievedAt", () => {
    expect(() => parseAssistantReply({ ...ANSWER, sources: [{ ...SOURCE, retrievedAt: "2026-10-08T10:00:00Z" }] })).not.toThrow();
  });

  it.each([
    "2026-02-31", "2026-02-29", "1900-02-29", "2026-04-31",
    "2026-02-31T10:00:00Z", "2026-04-31T10:00:00+02:00",
    "2026-10-08T25:00:00Z", "2026-10-08T24:01:00Z",
    "2026-10-08T10:60:00Z", "2026-10-08T10:00:60Z",
    "2026-10-08T10:00:00+24:00", "2026-10-08T10:00:00+02:60",
  ])("rejects the impossible source date or timestamp %s", (retrievedAt) => {
    expect(() => parseAssistantReply({ ...ANSWER, sources: [{ ...SOURCE, retrievedAt }] })).toThrow(AssistantError);
  });

  it.each([
    "2024-02-29", "2000-02-29", "2026-04-30", "0000-02-29",
    "2024-02-29T23:59:59Z", "2026-10-08T10:00:00+02:00",
    "2026-10-08T10:00:00-05:30", "2026-10-08T10:00:00.123Z",
    "2026-10-08T10:00", "2026-10-08T10:00:00", "2026-10-08T24:00:00Z",
  ])("preserves the supported valid source date or timestamp %s", (retrievedAt) => {
    expect(parseAssistantReply({ ...ANSWER, sources: [{ ...SOURCE, retrievedAt }] }).sources[0]?.retrievedAt).toBe(retrievedAt);
  });

  const contractError = (body: unknown) => {
    try {
      parseAssistantReply(body);
    } catch (error) {
      return error as AssistantError;
    }
    throw new Error("expected a contract error");
  };

  it.each([
    ["a missing sources field", { text: "x", kind: "answer", isSample: false }],
    ["sources that is not an array", { ...ANSWER, sources: "none" }],
    ["an answer without sources", { ...ANSWER, sources: [] }],
    ["a fallback that lists sources", { ...FALLBACK, sources: [SOURCE] }],
    ["an out-of-scope reply that lists sources", { ...ANSWER, kind: "out-of-scope" }],
    ["an unknown kind", { ...ANSWER, kind: "chitchat" }],
    ["empty text", { ...ANSWER, text: "  " }],
    ["a missing isSample", { text: "x", kind: "fallback", sources: [] }],
    ["a body that is not an object", "hello"],
    ["a null body", null],
    ["a source that is not an object", { ...ANSWER, sources: ["BA-REST-01"] }],
    ["a source without a recordId", { ...ANSWER, sources: [{ ...SOURCE, recordId: "" }] }],
    ["a source without a title", { ...ANSWER, sources: [{ ...SOURCE, title: undefined }] }],
    ["a source with a javascript: URL", { ...ANSWER, sources: [{ ...SOURCE, sourceUrl: "javascript:alert(1)" }] }],
    ["a source with a relative URL", { ...ANSWER, sources: [{ ...SOURCE, sourceUrl: "/speisen" }] }],
    ["a source with a bad date", { ...ANSWER, sources: [{ ...SOURCE, retrievedAt: "yesterday" }] }],
    ["a source with an unknown status", { ...ANSWER, sources: [{ ...SOURCE, recordStatus: "source_backed" }] }],
  ])("rejects %s as a contract error", (_name, body) => {
    const error = contractError(body);
    expect(error).toBeInstanceOf(AssistantError);
    expect(error.code).toBe("contract");
  });
});

describe("createHttpAssistantClient", () => {
  afterEach(() => vi.useRealTimers());

  it("POSTs the request as JSON to /api/chat and returns the validated reply", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(ANSWER));
    const reply = await createHttpAssistantClient({ fetchImpl }).send(REQUEST);

    expect(reply).toEqual(ANSWER);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("/api/chat");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ message: REQUEST.message, city: "bamberg", language: "en" });
  });

  it("sends city null for the general context and honours a custom endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(FALLBACK));
    await createHttpAssistantClient({ fetchImpl, endpoint: "/v2/chat" }).send({ ...REQUEST, city: null, language: "de" });
    expect(fetchImpl.mock.calls[0]![0]).toBe("/v2/chat");
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body)).toMatchObject({ city: null, language: "de" });
  });

  it("reports a network failure", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await failure(createHttpAssistantClient({ fetchImpl }).send(REQUEST))).toMatchObject({ name: "AssistantError", code: "network" });
  });

  it.each([400, 404, 500, 503])("reports HTTP %i with its status", async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ detail: "nope" }, { status }));
    expect(await failure(createHttpAssistantClient({ fetchImpl }).send(REQUEST))).toMatchObject({ code: "http", status });
  });

  it("reports a body that is not JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("<html>oops</html>", { status: 200 }));
    expect(await failure(createHttpAssistantClient({ fetchImpl }).send(REQUEST))).toMatchObject({ code: "invalid-json" });
  });

  it("reports an answer without sources as a contract error instead of returning it", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ text: "Trust me.", kind: "answer", isSample: false }));
    expect(await failure(createHttpAssistantClient({ fetchImpl }).send(REQUEST))).toMatchObject({ code: "contract" });
  });

  it("times out after 30 seconds and aborts the request", async () => {
    vi.useFakeTimers();
    let seen: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      seen = init.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        seen!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    const pending = failure(createHttpAssistantClient({ fetchImpl: fetchImpl as unknown as typeof fetch }).send(REQUEST));

    await vi.advanceTimersByTimeAsync(29_999);
    expect(seen?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ code: "timeout" });
    expect(seen?.aborted).toBe(true);
  });

  it("rejects with AbortError, not a failure message, when the caller aborts", async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    const controller = new AbortController();
    const pending = failure(createHttpAssistantClient({ fetchImpl: fetchImpl as unknown as typeof fetch }).send(REQUEST, { signal: controller.signal }));
    controller.abort();
    expect(await pending).toMatchObject({ name: "AbortError" });
  });

  it("does not call fetch when the signal is already aborted", async () => {
    const fetchImpl = vi.fn();
    const controller = new AbortController();
    controller.abort();
    expect(await failure(createHttpAssistantClient({ fetchImpl }).send(REQUEST, { signal: controller.signal }))).toMatchObject({ name: "AbortError" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("selectAssistantClient (bootstrap choice)", () => {
  it("uses the labelled mock client in development unless http is requested", () => {
    expect(selectAssistantClient({ mode: undefined, production: false }).mode).toBe("mock");
    expect(selectAssistantClient({ mode: "mock", production: false }).mode).toBe("mock");
    expect(selectAssistantClient({ mode: "http", production: false }).mode).toBe("http");
  });

  it("always uses the HTTP client in production", () => {
    expect(selectAssistantClient({ mode: undefined, production: true }).mode).toBe("http");
    expect(selectAssistantClient({ mode: "http", production: true }).mode).toBe("http");
  });

  it("refuses the mock in production and unknown modes anywhere", () => {
    expect(() => selectAssistantClient({ mode: "mock", production: true })).toThrow(/not allowed in a production build/);
    expect(() => selectAssistantClient({ mode: "demo", production: false })).toThrow(/must be "mock" or "http"/);
  });

  it("gives mock replies an empty source list", async () => {
    const reply = await createMockAssistantClient({ delayMs: 1 }).send(REQUEST);
    expect(reply.sources).toEqual([]);
    expect(reply.isSample).toBe(true);
  });
});
