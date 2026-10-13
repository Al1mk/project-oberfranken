import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistantClient, AssistantReply, AssistantRequest } from "../src/features/chat/assistantClient";
import { createMockAssistantClient } from "../src/features/chat/mockAssistantClient";
import { renderApp } from "./renderApp";

/** One recorded `send` call whose outcome the test decides by hand. */
type Call = { request: AssistantRequest; signal?: AbortSignal; resolve: (reply: AssistantReply) => void; reject: (error: unknown) => void };

function recordingClient(mode: AssistantClient["mode"] = "http") {
  const calls: Call[] = [];
  const client: AssistantClient = {
    mode,
    send: (request, options) =>
      new Promise<AssistantReply>((resolve, reject) => {
        calls.push({ request, signal: options?.signal, resolve, reject });
      }),
  };
  return { client, calls };
}

const CLARIFY: AssistantReply = { text: "Which city do you mean, Bamberg or Bayreuth?", kind: "clarification", isSample: false, sources: [] };
const SOURCE = {
  recordId: "BA-REST-01",
  title: "Schlenkerla",
  sourceName: "Bamberg Tourismus",
  sourceUrl: "https://www.schlenkerla.de/schlenkerla/karte/speisen.html",
  topic: "regional-food",
  retrievedAt: "2026-10-08",
  recordStatus: "verified" as const,
};
const ANSWER: AssistantReply = { text: "Try the Schlenkerla.", kind: "answer", isSample: false, sources: [SOURCE] };
const QUESTION = "Which restaurants can I visit?";

const L = {
  en: { launcher: "Open the welcome assistant", dialog: "Welcome Assistant", input: "Your message", group: "Choose a city", cancel: "Cancel", close: "Close assistant" },
  de: { launcher: "Willkommensassistent öffnen", dialog: "Willkommensassistent", input: "Deine Nachricht", group: "Stadt auswählen", cancel: "Abbrechen", close: "Assistent schließen" },
} as const;

async function openChat(path = "/", lang: "en" | "de" = "en", mode: AssistantClient["mode"] = "http") {
  const { client, calls } = recordingClient(mode);
  const utils = renderApp(path, { assistantClient: client });
  if (lang === "de") await utils.user.click(screen.getByRole("button", { name: "Deutsch" }));
  await utils.user.click(screen.getByRole("button", { name: L[lang].launcher }));
  const dialog = screen.getByRole("dialog", { name: L[lang].dialog });
  const input = () => within(dialog).getByRole("textbox", { name: L[lang].input });
  const ask = async (text: string) => utils.user.type(input(), `${text}{Enter}`);
  const choices = () => within(dialog).queryByRole("group", { name: L[lang].group });
  const userBubbles = () => within(dialog).getByRole("log").querySelectorAll('[data-role="user"] p');
  const settle = (index: number, outcome: AssistantReply | Error) =>
    act(async () => {
      if (outcome instanceof Error) calls[index]!.reject(outcome);
      else calls[index]!.resolve(outcome);
    });
  return { ...utils, calls, dialog, input, ask, choices, userBubbles, settle };
}

afterEach(() => vi.restoreAllMocks());

describe("city clarification: choosing resumes the original question", () => {
  it("clicking Bamberg resends the original question with the page city, its language and selectedCity, once", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const chat = await openChat("/");
    await chat.ask(QUESTION);
    expect(chat.calls).toHaveLength(1);
    expect(chat.calls[0]!.request).toEqual({ message: QUESTION, city: null, language: "en" });
    await chat.settle(0, CLARIFY);

    const group = chat.choices()!;
    expect(group).toBeInTheDocument();
    expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual(["Bamberg", "Bayreuth", "Cancel"]);
    // Showing the choices sends nothing on its own.
    expect(chat.calls).toHaveLength(1);

    await chat.user.click(within(group).getByRole("button", { name: "Bamberg" }));
    expect(chat.calls).toHaveLength(2);
    expect(chat.calls[1]!.request).toEqual({ message: QUESTION, city: null, language: "en", selectedCity: "bamberg" });
    expect(chat.choices()).toBeNull();
    expect([...chat.userBubbles()].map((bubble) => bubble.textContent)).toEqual([QUESTION, "Bamberg"]);
    expect(chat.input()).toHaveFocus();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);

    await chat.settle(1, ANSWER);
    expect(await within(chat.dialog).findByText("Try the Schlenkerla.")).toBeInTheDocument();
    expect(within(chat.dialog).getByRole("link", { name: /Schlenkerla/ })).toHaveAttribute("href", SOURCE.sourceUrl);
    expect(chat.choices()).toBeNull();
    expect(within(chat.dialog).getAllByText(QUESTION)).toHaveLength(1);
    expect(chat.calls).toHaveLength(2);
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
    expect(setItem).not.toHaveBeenCalled();
    expect(window.sessionStorage.length).toBe(0);
  });

  it.each(["bayreuth", "Bayreuth?", " BAYREUTH! ", "bayreuth."])("typing the bare city %j is the choice, not a new question", async (typed) => {
    const chat = await openChat("/");
    await chat.ask(QUESTION);
    await chat.settle(0, CLARIFY);
    await chat.ask(typed);
    expect(chat.calls).toHaveLength(2);
    expect(chat.calls[1]!.request).toEqual({ message: QUESTION, city: null, language: "en", selectedCity: "bayreuth" });
    expect([...chat.userBubbles()].map((bubble) => bubble.textContent)).toEqual([QUESTION, "Bayreuth"]);
    expect(chat.input()).toHaveValue("");
    expect(chat.choices()).toBeNull();
  });

  it("continues a Bamberg OR Bayreuth question with the chosen city, wording unchanged", async () => {
    const question = "Should I go to a restaurant in Bamberg or Bayreuth tonight?";
    const chat = await openChat("/");
    await chat.ask(question);
    await chat.settle(0, CLARIFY);
    await chat.user.click(within(chat.choices()!).getByRole("button", { name: "Bayreuth" }));
    expect(chat.calls[1]!.request).toEqual({ message: question, city: null, language: "en", selectedCity: "bayreuth" });
  });

  it("works in German with a German group label and Cancel", async () => {
    const chat = await openChat("/", "de");
    await chat.ask("Welche Restaurants kann ich besuchen?");
    await chat.settle(0, { ...CLARIFY, text: "Welche Stadt meinst du, Bamberg oder Bayreuth?" });
    const group = chat.choices()!;
    expect(within(group).getByRole("button", { name: "Abbrechen" })).toBeInTheDocument();
    await chat.ask("bamberg");
    expect(chat.calls[1]!.request).toEqual({ message: "Welche Restaurants kann ich besuchen?", city: null, language: "de", selectedCity: "bamberg" });
  });

  it("anything other than a bare city is a new, unrelated question", async () => {
    const chat = await openChat("/");
    await chat.ask(QUESTION);
    await chat.settle(0, CLARIFY);
    await chat.ask("Bamberg please");
    expect(chat.calls[1]!.request).toEqual({ message: "Bamberg please", city: null, language: "en" });
    expect(chat.choices()).toBeNull();
    await chat.settle(1, { text: "Fine.", kind: "fallback", isSample: false, sources: [] });
    await within(chat.dialog).findByText("Fine.");
    // The old snapshot is gone: a bare city now is an ordinary message.
    await chat.ask("bamberg");
    expect(chat.calls[2]!.request).toEqual({ message: "bamberg", city: null, language: "en" });
  });

  it("the choice does not become sticky context for later Home questions", async () => {
    const chat = await openChat("/");
    await chat.ask(QUESTION);
    await chat.settle(0, CLARIFY);
    await chat.user.click(within(chat.choices()!).getByRole("button", { name: "Bamberg" }));
    await chat.settle(1, ANSWER);
    await within(chat.dialog).findByText("Try the Schlenkerla.");
    await chat.ask("Which sights can I see?");
    expect(chat.calls[2]!.request).toEqual({ message: "Which sights can I see?", city: null, language: "en" });
  });

  it("does not offer choices again for a reply to an already selected city", async () => {
    const chat = await openChat("/");
    await chat.ask(QUESTION);
    await chat.settle(0, CLARIFY);
    await chat.user.click(within(chat.choices()!).getByRole("button", { name: "Bamberg" }));
    await chat.settle(1, CLARIFY);
    await waitFor(() => expect(within(chat.dialog).getAllByText(CLARIFY.text)).toHaveLength(2));
    expect(chat.choices()).toBeNull();
  });
});

describe("city clarification: cancel, panel and keyboard", () => {
  it("Cancel removes the choices, focuses the composer and sends nothing", async () => {
    const chat = await openChat("/");
    await chat.ask(QUESTION);
    await chat.settle(0, CLARIFY);
    await chat.user.click(within(chat.choices()!).getByRole("button", { name: "Cancel" }));
    expect(chat.choices()).toBeNull();
    expect(chat.input()).toHaveFocus();
    expect(chat.calls).toHaveLength(1);
    expect(within(chat.dialog).getByText(CLARIFY.text)).toBeInTheDocument();
    await chat.ask("bamberg");
    expect(chat.calls[1]!.request).toEqual({ message: "bamberg", city: null, language: "en" });
  });

  it("closing and reopening the panel keeps the pending choices", async () => {
    const chat = await openChat("/");
    await chat.ask(QUESTION);
    await chat.settle(0, CLARIFY);
    await chat.user.click(within(chat.dialog).getByRole("button", { name: L.en.close }));
    expect(screen.queryByRole("dialog", { name: L.en.dialog })).toBeNull();
    await chat.user.click(screen.getByRole("button", { name: L.en.launcher }));
    expect(chat.choices()).toBeInTheDocument();
    await chat.user.click(within(chat.choices()!).getByRole("button", { name: "Bayreuth" }));
    expect(chat.calls[1]!.request).toEqual({ message: QUESTION, city: null, language: "en", selectedCity: "bayreuth" });
    expect(chat.calls).toHaveLength(2);
  });

  it("Tab reaches the city buttons in order and Enter activates one", async () => {
    const chat = await openChat("/");
    await chat.ask(QUESTION);
    await chat.settle(0, CLARIFY);
    within(chat.dialog).getByRole("button", { name: L.en.close }).focus();
    await chat.user.tab();
    expect(within(chat.choices()!).getByRole("button", { name: "Bamberg" })).toHaveFocus();
    await chat.user.tab();
    expect(within(chat.choices()!).getByRole("button", { name: "Bayreuth" })).toHaveFocus();
    await chat.user.tab();
    expect(within(chat.choices()!).getByRole("button", { name: "Cancel" })).toHaveFocus();
    for (const button of within(chat.choices()!).getAllByRole("button")) expect(button.tabIndex).toBe(0);
    await chat.user.tab({ shift: true });
    await chat.user.keyboard("{Enter}");
    expect(chat.calls[1]!.request).toMatchObject({ selectedCity: "bayreuth" });
    expect(chat.input()).toHaveFocus();
  });

  it("Space activates a city button", async () => {
    const chat = await openChat("/");
    await chat.ask(QUESTION);
    await chat.settle(0, CLARIFY);
    within(chat.choices()!).getByRole("button", { name: "Bamberg" }).focus();
    await chat.user.keyboard(" ");
    expect(chat.calls[1]!.request).toMatchObject({ selectedCity: "bamberg" });
  });

  it("a double click on a city sends once", async () => {
    const chat = await openChat("/");
    await chat.ask(QUESTION);
    await chat.settle(0, CLARIFY);
    await chat.user.dblClick(within(chat.choices()!).getByRole("button", { name: "Bamberg" }));
    expect(chat.calls).toHaveLength(2);
    expect([...chat.userBubbles()].map((bubble) => bubble.textContent)).toEqual([QUESTION, "Bamberg"]);
  });

  it("keeps the privacy notice and its toggle working while choices are shown", async () => {
    const chat = await openChat("/");
    await chat.ask(QUESTION);
    await chat.settle(0, CLARIFY);
    const notice = within(chat.dialog).getByTestId("chat-privacy-notice");
    await chat.user.click(within(notice).getByRole("button", { name: "Got it" }));
    expect(within(chat.dialog).queryByTestId("chat-privacy-notice")).toBeNull();
    expect(chat.input()).toHaveFocus();
    expect(chat.choices()).toBeInTheDocument();
    const toggle = within(chat.dialog).getByRole("button", { name: "Privacy notice" });
    await chat.user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(chat.dialog).getByTestId("chat-privacy-notice")).toBeInTheDocument();
    expect(chat.choices()).toBeInTheDocument();
    expect(chat.calls).toHaveLength(1);
  });

  it("mock mode shows sample choices and resolves with the chosen city without HTTP", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const { user } = renderApp("/", { assistantClient: createMockAssistantClient({ delayMs: 1 }) });
      await user.click(screen.getByRole("button", { name: L.en.launcher }));
      const dialog = screen.getByRole("dialog", { name: L.en.dialog });
      await user.type(within(dialog).getByRole("textbox", { name: L.en.input }), "Which traditions should I know?{Enter}");
      const group = await within(dialog).findByRole("group", { name: L.en.group });
      expect(within(dialog).getByText("Sample response")).toBeInTheDocument();
      await user.click(within(group).getByRole("button", { name: "Bamberg" }));
      expect(await within(dialog).findByText(/Rauchbier/)).toBeInTheDocument();
      expect(within(dialog).queryByRole("group", { name: L.en.group })).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Home suggestions are balanced", () => {
  it.each(["en", "de"] as const)("the Home suggestions in %s are not all about Bamberg", async (lang) => {
    const chat = await openChat("/", lang);
    const label = lang === "en" ? "Example questions" : "Beispielfragen";
    const texts = within(within(chat.dialog).getByRole("group", { name: label })).getAllByRole("button").map((button) => button.textContent ?? "");
    expect(texts).toHaveLength(4);
    expect(texts.filter((text) => text.includes("Bamberg") && !text.includes("Bayreuth")).length).toBeLessThanOrEqual(1);
    expect(texts.some((text) => text.includes("Bayreuth"))).toBe(true);
    expect(texts.filter((text) => !/Bamberg|Bayreuth/.test(text)).length + texts.filter((text) => text.includes("Bamberg") && text.includes("Bayreuth")).length).toBeGreaterThanOrEqual(2);
  });

  it("city pages keep their own city in every suggestion", async () => {
    const chat = await openChat("/bamberg");
    const texts = within(within(chat.dialog).getByRole("group", { name: "Example questions" })).getAllByRole("button").map((button) => button.textContent ?? "");
    expect(texts.every((text) => text.includes("Bamberg") && !text.includes("Bayreuth"))).toBe(true);
  });
});
