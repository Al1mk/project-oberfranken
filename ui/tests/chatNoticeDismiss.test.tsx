import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AssistantClient } from "../src/features/chat/assistantClient";
import { createHttpAssistantClient } from "../src/features/chat/httpAssistantClient";
import { createMockAssistantClient } from "../src/features/chat/mockAssistantClient";
import { renderApp } from "./renderApp";

const T = {
  en: {
    launcher: "Open the welcome assistant", launcherClose: "Close the welcome assistant", dialog: "Welcome Assistant", label: "AI assistant", input: "Your message", send: "Send message",
    ack: "Got it", toggle: "Privacy notice", mapAccept: "Accept external maps", mapRegion: "Privacy settings", policyLink: /privacy policy|datenschutz/i,
    breadcrumb: "Breadcrumb", explore: "Explore Your Oberfranken", pilot: "Open in the pilot",
  },
  de: {
    launcher: "Willkommensassistent öffnen", launcherClose: "Willkommensassistent schließen", dialog: "Willkommensassistent", label: "KI-Assistent", input: "Deine Nachricht", send: "Nachricht senden",
    ack: "Verstanden", toggle: "Datenschutzhinweis", mapAccept: "Externe Karten akzeptieren", mapRegion: "Datenschutzeinstellungen", policyLink: /datenschutz/i,
    breadcrumb: "Brotkrumennavigation", explore: "Entdecke dein Oberfranken", pilot: "Im Pilot geöffnet",
  },
} as const;

async function openChat(lang: "en" | "de", client: AssistantClient, path = "/bamberg") {
  const utils = renderApp(path, { assistantClient: client });
  if (lang === "de") await utils.user.click(screen.getByRole("button", { name: "Deutsch" }));
  await utils.user.click(screen.getByRole("button", { name: T[lang].launcher }));
  const dialog = () => screen.getByRole("dialog", { name: T[lang].dialog });
  return { ...utils, dialog };
}

describe.each(["en", "de"] as const)("dismissible chat notice in %s", (lang) => {
  const L = T[lang];
  const httpClient = () => {
    const fetchImpl = vi.fn();
    return { fetchImpl, client: createHttpAssistantClient({ fetchImpl }) };
  };
  const notice = (dialog: HTMLElement) => within(dialog).queryByTestId("chat-privacy-notice");
  const composer = (dialog: HTMLElement) => within(dialog).getByRole("textbox", { name: L.input });

  it("initially shows the full mode-specific notice with its acknowledge button and policy link, and no header toggle", async () => {
    const { client, fetchImpl } = httpClient();
    const { dialog } = await openChat(lang, client);
    const block = notice(dialog())!;
    expect(block).toHaveTextContent("OpenRouter");
    expect(within(block).getByRole("button", { name: L.ack })).toBeInTheDocument();
    expect(within(block).getByRole("link", { name: L.policyLink })).toHaveAttribute("href", "/datenschutz");
    expect(within(dialog()).queryByRole("button", { name: L.toggle })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("acknowledging removes the whole block and its link, focuses the composer, keeps the AI label, sends nothing", async () => {
    const { client, fetchImpl } = httpClient();
    const { dialog, user } = await openChat(lang, client);
    await user.click(within(notice(dialog())!).getByRole("button", { name: L.ack }));
    expect(notice(dialog())).toBeNull();
    expect(within(dialog()).queryByRole("link", { name: L.policyLink })).toBeNull();
    expect(document.activeElement).toBe(composer(dialog()));
    expect(within(dialog()).getByText(L.label)).toBeVisible();
    const toggle = within(dialog()).getByRole("button", { name: L.toggle });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not require the acknowledgement to send a message", async () => {
    const { dialog, user } = await openChat(lang, createMockAssistantClient({ delayMs: 1 }));
    await user.type(composer(dialog()), "Hallo");
    await user.click(within(dialog()).getByRole("button", { name: L.send }));
    expect(await within(dialog()).findAllByRole("listitem")).not.toHaveLength(0);
    expect(within(dialog()).getByText("Hallo")).toBeInTheDocument();
    expect(notice(dialog())).not.toBeNull(); // still unacknowledged, still shown
  });

  it("the header button reopens the full notice with the policy link; focus stays on it; pressing again collapses it", async () => {
    const { client } = httpClient();
    const { dialog, user } = await openChat(lang, client);
    await user.click(within(notice(dialog())!).getByRole("button", { name: L.ack }));
    const toggle = within(dialog()).getByRole("button", { name: L.toggle });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", notice(dialog())!.id);
    expect(within(notice(dialog())!).getByRole("link", { name: L.policyLink })).toHaveAttribute("href", "/datenschutz");
    expect(document.activeElement).toBe(toggle);
    await user.click(toggle);
    expect(notice(dialog())).toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(toggle);
  });

  it("acknowledging a reopened notice collapses it again and moves focus to the composer", async () => {
    const { client } = httpClient();
    const { dialog, user } = await openChat(lang, client);
    await user.click(within(notice(dialog())!).getByRole("button", { name: L.ack }));
    await user.click(within(dialog()).getByRole("button", { name: L.toggle }));
    await user.click(within(notice(dialog())!).getByRole("button", { name: L.ack }));
    expect(notice(dialog())).toBeNull();
    expect(document.activeElement).toBe(composer(dialog()));
  });

  it("remembers the acknowledgement when the chat is closed and reopened", async () => {
    const { client } = httpClient();
    const { dialog, user } = await openChat(lang, client);
    await user.click(within(notice(dialog())!).getByRole("button", { name: L.ack }));
    await user.click(screen.getByRole("button", { name: L.launcherClose }));
    await user.click(screen.getByRole("button", { name: L.launcher }));
    expect(notice(dialog())).toBeNull();
    expect(within(dialog()).getByRole("button", { name: L.toggle })).toBeInTheDocument();
  });

  it("remembers the acknowledgement across in-app city navigation", async () => {
    const { client } = httpClient();
    const { dialog, user } = await openChat(lang, client, "/bamberg");
    await user.click(within(notice(dialog())!).getByRole("button", { name: L.ack }));
    await user.click(within(screen.getByRole("navigation", { name: L.breadcrumb })).getByRole("link"));
    await user.click(screen.getByRole("button", { name: L.explore }));
    await user.click(within(screen.getByRole("region", { name: L.pilot })).getByRole("link", { name: /^Bayreuth/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("/bayreuth");
    expect(notice(dialog())).toBeNull();
    expect(within(dialog()).getByRole("button", { name: L.toggle })).toBeInTheDocument();
  });

  it("remembers the acknowledgement across a language switch and reopens the notice in the new language", async () => {
    const { client } = httpClient();
    const { dialog, user } = await openChat(lang, client);
    await user.click(within(notice(dialog())!).getByRole("button", { name: L.ack }));
    const other = lang === "en" ? T.de : T.en;
    await user.click(screen.getByRole("button", { name: lang === "en" ? "Deutsch" : "English" }));
    expect(notice(screen.getByRole("dialog", { name: other.dialog }))).toBeNull();
    const toggle = within(screen.getByRole("dialog", { name: other.dialog })).getByRole("button", { name: other.toggle });
    await user.click(toggle);
    expect(within(notice(screen.getByRole("dialog", { name: other.dialog }))!).getByRole("button", { name: other.ack })).toBeInTheDocument();
  });

  it("is separate from the map choice in both directions and is not a consent record", async () => {
    const { client } = httpClient();
    const { dialog, user } = await openChat(lang, client);
    // Chat acknowledgement does not touch the map choice: the privacy panel is still undecided and the map blocked.
    await user.click(within(notice(dialog())!).getByRole("button", { name: L.ack }));
    expect(screen.getByRole("region", { name: L.mapRegion })).toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
    // Accepting maps does not acknowledge the chat notice: use a fresh page.
  });

  it("accepting external maps does not acknowledge the chat notice", async () => {
    const { client } = httpClient();
    const { dialog, user } = await openChat(lang, client);
    await user.click(within(screen.getByRole("region", { name: L.mapRegion })).getByRole("button", { name: L.mapAccept }));
    expect(document.querySelector("iframe")).not.toBeNull();
    expect(notice(dialog())).not.toBeNull();
    expect(within(dialog()).queryByRole("button", { name: L.toggle })).toBeNull();
  });

  it("uses no cookie, localStorage or sessionStorage for the acknowledgement", async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    const { dialog, user } = await openChat(lang === "en" ? "en" : "en", createHttpAssistantClient({ fetchImpl: vi.fn() }));
    window.localStorage.clear(); // drop the language key a DE switch would write; only the acknowledgement is under test
    await user.click(within(notice(dialog())!).getByRole("button", { name: T.en.ack }));
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).toBe("");
  });

  it("mock mode keeps its sample wording when reopened and still labels itself as samples", async () => {
    const { dialog, user } = await openChat(lang, createMockAssistantClient({ delayMs: 1 }));
    await user.click(within(notice(dialog())!).getByRole("button", { name: L.ack }));
    await user.click(within(dialog()).getByRole("button", { name: L.toggle }));
    const reopened = notice(dialog())!;
    expect(reopened.textContent).toMatch(lang === "en" ? /Sample mode/ : /Beispielmodus/);
    expect(reopened.textContent).not.toMatch(/OpenRouter|DeepInfra/);
  });

  it("caps the expanded notice so it cannot squeeze the message area (scrolls inside itself; the log keeps a minimum height)", async () => {
    const { client } = httpClient();
    const { dialog } = await openChat(lang, client);
    const block = notice(dialog())!;
    expect(block.className).toMatch(/max-h-/);
    expect(block.className).toMatch(/shrink-0/);
    // The long text scrolls inside itself (keyboard-reachable); the acknowledge button and link stay outside it, always visible.
    const text = block.querySelector("[data-notice-text]")!;
    expect(text.className).toMatch(/overflow-y-auto/);
    expect(text).toHaveAttribute("tabindex", "0");
    expect(text).not.toContainElement(within(block).getByRole("button", { name: L.ack }));
    expect(text).not.toContainElement(within(block).getByRole("link", { name: L.policyLink }));
    // The suggestions are capped too and the log keeps a floor, so the composer is never pushed out of the panel.
    expect(within(dialog()).getByRole("group").className).toMatch(/max-h-/);
    expect(within(dialog()).getByRole("log").className).toMatch(/min-h-/);
  });

  it("sends no request through the whole acknowledge / reopen / navigate / language sequence", async () => {
    const { client, fetchImpl } = httpClient();
    const { dialog, user } = await openChat(lang, client);
    await user.click(within(notice(dialog())!).getByRole("button", { name: L.ack }));
    await user.click(within(dialog()).getByRole("button", { name: L.toggle }));
    await user.click(within(dialog()).getByRole("button", { name: L.toggle }));
    await user.click(screen.getByRole("button", { name: lang === "en" ? "Deutsch" : "English" }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
