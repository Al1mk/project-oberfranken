import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AssistantClient, AssistantReply, AssistantRequest } from "../src/features/chat/assistantClient";
import { AssistantError } from "../src/features/chat/assistantContract";
import { createHttpAssistantClient } from "../src/features/chat/httpAssistantClient";
import { renderApp } from "./renderApp";

const source = (overrides: Partial<AssistantReply["sources"][number]> = {}) => ({
  recordId: "BA-REST-01",
  title: "Schlenkerla",
  sourceName: "Bamberg Tourismus",
  sourceUrl: "https://www.schlenkerla.de/schlenkerla/karte/speisen.html",
  topic: "regional-food",
  retrievedAt: "2026-10-08",
  recordStatus: "verified" as const,
  ...overrides,
});
const answer = (text: string, sources = [source()]): AssistantReply => ({ text, kind: "answer", isSample: false, sources });

/** A client that plays back scripted outcomes, one per call. */
function scripted(outcomes: (AssistantReply | Error)[], mode: AssistantClient["mode"] = "http") {
  const send = vi.fn(async (request: AssistantRequest) => {
    void request;
    const next = outcomes.shift();
    if (!next) throw new Error("script exhausted");
    if (next instanceof Error) throw next;
    return next;
  });
  return { client: { mode, send } satisfies AssistantClient, send };
}

async function openChat(client: AssistantClient, path = "/bamberg") {
  const utils = renderApp(path, { assistantClient: client });
  await utils.user.click(screen.getByRole("button", { name: "Open the welcome assistant" }));
  const dialog = screen.getByRole("dialog", { name: "Welcome Assistant" });
  const ask = async (text: string) => {
    await utils.user.type(within(dialog).getByRole("textbox", { name: "Your message" }), `${text}{Enter}`);
  };
  return { ...utils, dialog, ask, log: () => within(dialog).getByRole("log") };
}

describe("sources in the chat", () => {
  it("renders a clarification reply as an ordinary bubble without a source list", async () => {
    const { client } = scripted([{ text: "Which city do you mean?", kind: "clarification", isSample: false, sources: [] }]);
    const { ask, log } = await openChat(client, "/");
    await ask("Which restaurants?");
    await screen.findByText("Which city do you mean?");
    expect(within(log()).queryByText(/sources?/i)).toBeNull();
    expect(within(log()).queryAllByRole("link")).toHaveLength(0);
  });

  it("renders each message's sources beneath that message only", async () => {
    const { client } = scripted([
      answer("Try the Bamberg onion.", [source()]),
      answer("Visit the cathedral.", [source({ recordId: "BA-SIGHT-01", title: "Bamberg Cathedral", sourceName: "UNESCO", sourceUrl: "https://whc.unesco.org/en/list/624", retrievedAt: "2026-10-09" })]),
    ]);
    const { ask, log } = await openChat(client);
    await ask("Where to eat?");
    await screen.findByText("Try the Bamberg onion.");
    await ask("What to see?");
    await screen.findByText("Visit the cathedral.");

    const [first, second] = within(log()).getAllByRole("listitem").filter((item) => item.dataset.role === "assistant");
    expect(within(first!).getByText("Try the Bamberg onion.")).toBeInTheDocument();
    expect(within(first!).getByRole("link", { name: /Schlenkerla/ })).toHaveAttribute("href", "https://www.schlenkerla.de/schlenkerla/karte/speisen.html");
    expect(within(first!).getByText("Bamberg Tourismus, retrieved 8 October 2026")).toBeInTheDocument();
    expect(within(first!).queryByText(/Bamberg Cathedral/)).not.toBeInTheDocument();

    expect(within(second!).getByRole("link", { name: /Bamberg Cathedral/ })).toHaveAttribute("href", "https://whc.unesco.org/en/list/624");
    expect(within(second!).getByText("UNESCO, retrieved 9 October 2026")).toBeInTheDocument();
    expect(within(second!).queryByText(/Schlenkerla/)).not.toBeInTheDocument();
  });

  it("marks limited sources visibly and leaves verified ones unmarked", async () => {
    const { client } = scripted([answer("Maybe.", [source(), source({ recordId: "BA-REST-04", title: "Sternla", recordStatus: "limited" })])]);
    const { ask, log } = await openChat(client);
    await ask("Anything else?");
    await screen.findByText("Maybe.");
    const limited = within(log()).getAllByText("Limited source: verify this before relying on it");
    expect(limited).toHaveLength(1);
    expect(limited[0]!.closest("li")).toHaveAttribute("data-record-id", "BA-REST-04");
    expect(log().querySelector('[data-record-id="BA-REST-01"]')!.textContent).not.toMatch(/Limited source/);
  });

  it("shows no source block for out-of-scope and fallback replies", async () => {
    const { client } = scripted([{ text: "Not my area.", kind: "out-of-scope", isSample: false, sources: [] }]);
    const { ask, dialog } = await openChat(client);
    await ask("Find me an apartment");
    await screen.findByText("Not my area.");
    expect(within(dialog).queryByText("Sources")).not.toBeInTheDocument();
  });

  it("renders model text as plain text, never as HTML", async () => {
    const hostile = 'Hi <img src=x onerror="alert(1)"> <script>alert(2)</script> <b>bold</b>';
    const { client } = scripted([answer(hostile)]);
    const { ask, log } = await openChat(client);
    await ask("hello");
    await screen.findByText(hostile);
    expect(log().querySelector("img, script, b")).toBeNull();
  });

  it("keeps long text and long URLs inside the bubble", async () => {
    const longUrl = `https://example.org/${"a".repeat(300)}`;
    const { client } = scripted([answer("x".repeat(400), [source({ title: "T".repeat(200), sourceUrl: longUrl })])]);
    const { ask, log } = await openChat(client);
    await ask("long");
    const text = await screen.findByText("x".repeat(400));
    expect(text.className).toMatch(/overflow-wrap:anywhere/);
    expect(log().querySelector("ul")!.parentElement!.className).toMatch(/overflow-wrap:anywhere/);
    expect(within(log()).getByRole("link", { name: /T{200}/ })).toHaveAttribute("href", longUrl);
  });
});

describe("failures and retry", () => {
  it.each([
    [new AssistantError("timeout", "slow"), /more than 30 seconds/],
    [new AssistantError("network", "offline"), /could not be reached/],
    [new AssistantError("http", "HTTP 503", 503), /HTTP 503/],
    [new AssistantError("invalid-json", "bad"), /could not be read/],
    [new AssistantError("contract", "no sources"), /unexpected format/],
  ])("shows a specific message for %s", async (error, message) => {
    const { client } = scripted([error]);
    const { ask } = await openChat(client);
    await ask("hello");
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("retries the failed request without duplicating the user's message", async () => {
    const { client, send } = scripted([new AssistantError("timeout", "slow"), answer("Here you go.")]);
    const { user, ask, log } = await openChat(client);
    await ask("Where to eat?");
    await screen.findByRole("alert");
    expect(within(log()).getAllByText("Where to eat?")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Here you go.");

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0]).toEqual(send.mock.calls[0]![0]);
    expect(within(log()).getAllByText("Where to eat?")).toHaveLength(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("can fail again and keeps offering a retry", async () => {
    const { client, send } = scripted([new AssistantError("network", "x"), new AssistantError("network", "x"), answer("Finally.")]);
    const { user, ask } = await openChat(client);
    await ask("hello");
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    await screen.findByText("Finally.");
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("treats an unexpected thrown error as a connection problem", async () => {
    const { client } = scripted([new Error("boom")]);
    const { ask } = await openChat(client);
    await ask("hello");
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be reached/);
  });

  it("never falls back to sample answers when the HTTP client fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const client = createHttpAssistantClient({ fetchImpl });
    const { ask, log } = await openChat(client);
    await ask("What regional tradition should I know in Bamberg?");
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be reached/);
    expect(within(log()).queryByText("Sample response")).not.toBeInTheDocument();
    expect(within(log()).queryByText(/Rauchbier/)).not.toBeInTheDocument();
  });
});

describe("explicit client selection", () => {
  it("uses exactly the injected client", async () => {
    const { client, send } = scripted([answer("From the injected client.")]);
    const { ask } = await openChat(client);
    await ask("hello");
    await screen.findByText("From the injected client.");
    expect(send).toHaveBeenCalledWith({ message: "hello", city: "bamberg", language: "en" }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("labels the mock client as a prototype and the HTTP client as source-backed", async () => {
    const mock = await openChat(scripted([], "mock").client);
    expect(within(mock.dialog).getByText(/Prototype: answers are pre-written samples/)).toBeInTheDocument();
    mock.unmount();

    const http = await openChat(scripted([], "http").client);
    expect(within(http.dialog).getByText(/Answers come from the project knowledge base and list their sources/)).toBeInTheDocument();
    expect(within(http.dialog).queryByText(/pre-written samples/)).not.toBeInTheDocument();
  });

  it("offers useful discovery questions in both languages and sends the chosen one", async () => {
    const { client, send } = scripted([answer("Ok.")]);
    const { user, dialog } = await openChat(client, "/bayreuth");
    const suggestions = within(within(dialog).getByRole("group", { name: "Example questions" })).getAllByRole("button");
    expect(suggestions.map((button) => button.textContent)).toEqual([
      "Which public cultural activities can international students visit in Bayreuth?",
      "Which sights in Bayreuth should I see first?",
      "Which restaurant in Bayreuth serves a typical regional dish?",
      "Which sports clubs in Bayreuth can I watch or join?",
    ]);
    await user.click(suggestions[1]!);
    await screen.findByText("Ok.");
    expect(send.mock.calls[0]![0]).toMatchObject({ message: "Which sights in Bayreuth should I see first?", city: "bayreuth" });
  });

  it("answers in German UI with German suggestions, errors and source labels", async () => {
    const { client } = scripted([
      answer("Probiere die Bamberger Zwiebel.", [source({ recordStatus: "limited" })]),
      new AssistantError("timeout", "slow"),
    ]);
    const { user } = renderApp("/bamberg", { assistantClient: client });
    await user.click(screen.getByRole("button", { name: "Deutsch" }));
    await user.click(screen.getByRole("button", { name: "Willkommensassistent öffnen" }));
    const dialog = screen.getByRole("dialog", { name: "Willkommensassistent" });
    expect(within(dialog).getByRole("button", { name: /Welches Restaurant in Bamberg/ })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /Welche Sehenswürdigkeiten in Bamberg/ }));
    await screen.findByText("Probiere die Bamberger Zwiebel.");
    expect(within(dialog).getByText("Quellen")).toBeInTheDocument();
    expect(within(dialog).getByText("Bamberg Tourismus, abgerufen am 8. Oktober 2026")).toBeInTheDocument();
    expect(within(dialog).getByText(/Eingeschränkte Quelle/)).toBeInTheDocument();

    await user.type(within(dialog).getByRole("textbox", { name: "Deine Nachricht" }), "Noch eine Frage{Enter}");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/mehr als 30 Sekunden/);
    expect(within(dialog).getByRole("button", { name: "Erneut versuchen" })).toBeInTheDocument();
  });
});
