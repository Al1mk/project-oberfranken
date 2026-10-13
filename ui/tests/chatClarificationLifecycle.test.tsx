import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { describe, expect, it } from "vitest";
import { AppProviders, AppRoutes } from "../src/App";
import type { AssistantClient, AssistantReply, AssistantRequest } from "../src/features/chat/assistantClient";
import { AssistantError } from "../src/features/chat/assistantContract";

type Call = { request: AssistantRequest; signal?: AbortSignal; resolve: (reply: AssistantReply) => void; reject: (error: unknown) => void };

const CLARIFY: AssistantReply = { text: "Which city do you mean, Bamberg or Bayreuth?", kind: "clarification", isSample: false, sources: [] };
const REPLY: AssistantReply = { text: "Here is a reply.", kind: "fallback", isSample: false, sources: [] };
const LATE: AssistantReply = { text: "A late reply.", kind: "fallback", isSample: false, sources: [] };
const QUESTION = "Which restaurants can I visit?";
const TYPING = "The assistant is preparing a response…";

/** Moves through the app's real routes the way a link would, without depending on page content. */
function Nav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <>
      <output data-testid="location">{pathname}</output>
      <button onClick={() => void navigate("/bamberg")}>go bamberg</button>
      <button onClick={() => void navigate("/")}>go home</button>
    </>
  );
}

async function setup(path = "/") {
  const calls: Call[] = [];
  const client: AssistantClient = {
    mode: "http",
    send: (request, options) =>
      new Promise<AssistantReply>((resolve, reject) => {
        calls.push({ request, signal: options?.signal, resolve, reject });
      }),
  };
  const user = userEvent.setup();
  const utils = render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders assistantClient={client}>
        <AppRoutes />
        <Nav />
      </AppProviders>
    </MemoryRouter>,
  );
  await user.click(screen.getByRole("button", { name: "Open the welcome assistant" }));
  const dialog = () => screen.getByRole("dialog", { name: /Welcome Assistant|Willkommensassistent/ });
  const input = () => within(dialog()).getByRole("textbox");
  const ask = async (text: string) => user.type(input(), `${text}{Enter}`);
  const choices = () => within(dialog()).queryByRole("group", { name: /Choose a city|Stadt auswählen/ });
  const settle = (index: number, outcome: AssistantReply | Error) =>
    act(async () => {
      if (outcome instanceof Error) calls[index]!.reject(outcome);
      else calls[index]!.resolve(outcome);
    });
  const go = (name: "go bamberg" | "go home") => user.click(screen.getByRole("button", { name }));
  const german = () => user.click(screen.getByRole("button", { name: "Deutsch" }));
  const retryButton = () => within(dialog()).queryByRole("button", { name: /Try again|Erneut versuchen/ });
  const userBubbles = () => [...within(dialog()).getByRole("log").querySelectorAll('[data-role="user"] p')].map((bubble) => bubble.textContent);
  return { ...utils, user, calls, dialog, input, ask, choices, settle, go, german, retryButton, userBubbles };
}

async function withChoices(path = "/") {
  const chat = await setup(path);
  await chat.ask(QUESTION);
  await chat.settle(0, CLARIFY);
  expect(chat.choices()).toBeInTheDocument();
  return chat;
}

describe("a pending clarification is invalidated", () => {
  it("by navigating to a city page, and stays gone after coming back", async () => {
    const chat = await withChoices();
    await chat.go("go bamberg");
    expect(chat.choices()).toBeNull();
    await chat.go("go home");
    expect(chat.choices()).toBeNull();
    // A bare city is now an ordinary message without selectedCity.
    await chat.ask("bamberg");
    expect(chat.calls[1]!.request).toEqual({ message: "bamberg", city: null, language: "en" });
  });

  it("by switching the language", async () => {
    const chat = await withChoices();
    await chat.german();
    expect(chat.choices()).toBeNull();
    await chat.ask("bamberg");
    expect(chat.calls[1]!.request).toEqual({ message: "bamberg", city: null, language: "de" });
  });

  it("by a new unrelated question", async () => {
    const chat = await withChoices();
    await chat.ask("What about museums?");
    expect(chat.choices()).toBeNull();
    expect(chat.calls[1]!.request).toEqual({ message: "What about museums?", city: null, language: "en" });
  });

  it("by a reload (a fresh mount has no choices)", async () => {
    const chat = await withChoices();
    chat.unmount();
    const fresh = await setup();
    expect(fresh.choices()).toBeNull();
    expect(fresh.calls).toHaveLength(0);
  });

  it("on a city page too: the snapshot keeps the original page city", async () => {
    const chat = await withChoices("/bamberg");
    await chat.user.click(within(chat.choices()!).getByRole("button", { name: "Bayreuth" }));
    expect(chat.calls[1]!.request).toEqual({ message: QUESTION, city: "bamberg", language: "en", selectedCity: "bayreuth" });
  });
});

describe("late completions after a reset", () => {
  it("a late clarification of the first request cannot show choices, a reply or a loading state", async () => {
    const chat = await setup();
    await chat.ask(QUESTION);
    expect(within(chat.dialog()).getByText(TYPING)).toBeInTheDocument();
    await chat.go("go bamberg");
    // The browser request is aborted (the server call may still run) and never resent.
    expect(chat.calls[0]!.signal?.aborted).toBe(true);
    expect(within(chat.dialog()).queryByText(TYPING)).toBeNull();
    await chat.settle(0, CLARIFY);
    expect(chat.choices()).toBeNull();
    expect(within(chat.dialog()).queryByText(CLARIFY.text)).toBeNull();
    expect(within(chat.dialog()).queryByRole("alert")).toBeNull();
    expect(chat.calls).toHaveLength(1);
  });

  it("a late error of the first request shows no alert and no retry", async () => {
    const chat = await setup();
    await chat.ask(QUESTION);
    await chat.german();
    await chat.settle(0, new AssistantError("timeout", "slow"));
    expect(within(chat.dialog()).queryByRole("alert")).toBeNull();
    expect(chat.retryButton()).toBeNull();
    expect(chat.calls).toHaveLength(1);
  });

  it("a late success of a selected-city request after a reset appends nothing", async () => {
    const chat = await withChoices();
    await chat.user.click(within(chat.choices()!).getByRole("button", { name: "Bamberg" }));
    await chat.german();
    await chat.settle(1, LATE);
    expect(within(chat.dialog()).queryByText(LATE.text)).toBeNull();
    expect(chat.choices()).toBeNull();
    expect(chat.calls).toHaveLength(2);
  });

  it("an older completion does not end the newer request's loading state or allow a duplicate send", async () => {
    const chat = await setup();
    await chat.ask(QUESTION);
    await chat.go("go bamberg");
    await chat.ask("Second question");
    expect(chat.calls).toHaveLength(2);
    expect(chat.calls[1]!.request).toEqual({ message: "Second question", city: "bamberg", language: "en" });

    await chat.settle(0, CLARIFY);
    expect(within(chat.dialog()).getByText(TYPING)).toBeInTheDocument();
    expect(chat.calls[1]!.signal?.aborted).toBe(false);
    expect(chat.choices()).toBeNull();
    await chat.user.type(chat.input(), "Third question");
    expect(within(chat.dialog()).getByRole("button", { name: "Send message" })).toBeDisabled();
    await chat.user.keyboard("{Enter}");
    expect(chat.calls).toHaveLength(2);

    await chat.settle(1, REPLY);
    expect(within(chat.dialog()).getByText(REPLY.text)).toBeInTheDocument();
    expect(within(chat.dialog()).queryByText(TYPING)).toBeNull();
    expect(within(chat.dialog()).getByRole("button", { name: "Send message" })).toBeEnabled();
  });

  it("an older error does not put the newer request into an error state", async () => {
    const chat = await setup();
    await chat.ask(QUESTION);
    await chat.german();
    await chat.ask("Zweite Frage");
    await chat.settle(0, new AssistantError("network", "offline"));
    expect(within(chat.dialog()).queryByRole("alert")).toBeNull();
    expect(within(chat.dialog()).getByText("Der Assistent bereitet eine Antwort vor…")).toBeInTheDocument();
    await chat.settle(1, REPLY);
    expect(within(chat.dialog()).getByText(REPLY.text)).toBeInTheDocument();
  });
});

describe("retry of a selected-city request", () => {
  it("resends the exact resolved request without duplicate bubbles", async () => {
    const chat = await withChoices();
    await chat.user.click(within(chat.choices()!).getByRole("button", { name: "Bamberg" }));
    await chat.settle(1, new AssistantError("http", "HTTP 503", 503));
    expect(await within(chat.dialog()).findByRole("alert")).toHaveTextContent(/HTTP 503/);
    expect(chat.choices()).toBeNull();

    await chat.user.click(chat.retryButton()!);
    expect(chat.calls).toHaveLength(3);
    expect(chat.calls[2]!.request).toEqual({ message: QUESTION, city: null, language: "en", selectedCity: "bamberg" });
    expect(chat.userBubbles()).toEqual([QUESTION, "Bamberg"]);
    await chat.settle(2, REPLY);
    expect(within(chat.dialog()).getByText(REPLY.text)).toBeInTheDocument();
    expect(chat.retryButton()).toBeNull();
    expect(chat.userBubbles()).toEqual([QUESTION, "Bamberg"]);
  });

  it.each(["navigation", "language"] as const)("disappears after a reset by %s", async (reset) => {
    const chat = await withChoices();
    await chat.user.click(within(chat.choices()!).getByRole("button", { name: "Bamberg" }));
    await chat.settle(1, new AssistantError("timeout", "slow"));
    expect(chat.retryButton()).toBeInTheDocument();
    if (reset === "navigation") await chat.go("go bamberg");
    else await chat.german();
    expect(chat.retryButton()).toBeNull();
    expect(within(chat.dialog()).queryByRole("alert")).toBeNull();
    expect(within(chat.dialog()).getByRole("textbox")).toBeEnabled();
    expect(chat.calls).toHaveLength(2);
  });
});

describe("ordinary F4 retry is unchanged", () => {
  it("survives a page and language change and resends the original context", async () => {
    const chat = await setup();
    await chat.ask("Where can I eat?");
    await chat.settle(0, new AssistantError("network", "offline"));
    expect(chat.retryButton()).toBeInTheDocument();
    await chat.go("go bamberg");
    await chat.german();
    expect(within(chat.dialog()).getByRole("alert")).toBeInTheDocument();
    await chat.user.click(chat.retryButton()!);
    expect(chat.calls[1]!.request).toEqual({ message: "Where can I eat?", city: null, language: "en" });
    expect(chat.userBubbles()).toEqual(["Where can I eat?"]);
  });
});
