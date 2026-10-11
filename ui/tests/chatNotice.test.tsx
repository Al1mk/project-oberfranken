import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AssistantClient } from "../src/features/chat/assistantClient";
import { createHttpAssistantClient } from "../src/features/chat/httpAssistantClient";
import { createMockAssistantClient } from "../src/features/chat/mockAssistantClient";
import { renderApp } from "./renderApp";

const T = {
  en: { launcher: "Open the welcome assistant", dialog: "Welcome Assistant", label: "AI assistant", input: "Your message", send: "Send message", switch: "English" },
  de: { launcher: "Willkommensassistent öffnen", dialog: "Willkommensassistent", label: "KI-Assistent", input: "Deine Nachricht", send: "Nachricht senden", switch: "Deutsch" },
} as const;

async function openChat(lang: "en" | "de", client: AssistantClient, path = "/bamberg") {
  const utils = renderApp(path, { assistantClient: client });
  if (lang === "de") await utils.user.click(screen.getByRole("button", { name: "Deutsch" }));
  await utils.user.click(screen.getByRole("button", { name: T[lang].launcher }));
  return { ...utils, dialog: screen.getByRole("dialog", { name: T[lang].dialog }) };
}

describe.each(["en", "de"] as const)("chat labelling in %s", (lang) => {
  const L = T[lang];

  it("shows a visible AI-assistant label in the chat header", async () => {
    const { dialog } = await openChat(lang, createMockAssistantClient({ delayMs: 1 }));
    expect(within(dialog).getByText(L.label)).toBeVisible();
  });

  it("HTTP mode: names the real flow (this server, OpenRouter, DeepInfra) and advises against personal data, before the first send", async () => {
    const fetchImpl = vi.fn();
    const { dialog } = await openChat(lang, createHttpAssistantClient({ fetchImpl }));
    const notice = within(dialog).getByTestId("chat-privacy-notice");
    expect(notice).toHaveTextContent("OpenRouter");
    expect(notice).toHaveTextContent("DeepInfra");
    expect(notice).toHaveTextContent(lang === "en" ? /do not enter personal data/i : /keine personenbezogenen Daten/i);
    expect(within(notice).getByRole("link", { name: /Datenschutz|privacy policy/i })).toHaveAttribute("href", "/datenschutz");
    expect(fetchImpl).not.toHaveBeenCalled(); // opening the chat sends nothing
  });

  it("mock mode: stays labelled as samples and does not claim a provider flow", async () => {
    const { dialog } = await openChat(lang, createMockAssistantClient({ delayMs: 1 }));
    const notice = within(dialog).getByTestId("chat-privacy-notice");
    expect(notice).toHaveTextContent(lang === "en" ? /sample/i : /Beispiel/i);
    expect(notice).not.toHaveTextContent(/OpenRouter|DeepInfra/);
    expect(within(dialog).getByText(lang === "en" ? /pre-written samples, not live AI/ : /vorbereitete Beispiele, keine Live-KI/)).toBeInTheDocument();
  });
});

describe("map permission and chat are independent", () => {
  const reply = { text: "ok", kind: "fallback", isSample: false, sources: [] };
  const okFetch = () => vi.fn().mockResolvedValue(new Response(JSON.stringify(reply), { status: 200 }));

  it("rejecting maps does not block chat, and the chat notice is unchanged", async () => {
    const fetchImpl = okFetch();
    const { user, dialog } = await openChat("en", createHttpAssistantClient({ fetchImpl }));
    const before = within(dialog).getByTestId("chat-privacy-notice").textContent;
    await user.click(within(screen.getByRole("region", { name: "Privacy settings" })).getByRole("button", { name: "Reject" }));
    expect(within(dialog).getByTestId("chat-privacy-notice").textContent).toBe(before);
    await user.type(within(dialog).getByRole("textbox", { name: "Your message" }), "Hello{Enter}");
    await within(dialog).findByText("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("accepting maps changes nothing about the chat notice and does not send anything", async () => {
    const fetchImpl = okFetch();
    const { user, dialog } = await openChat("en", createHttpAssistantClient({ fetchImpl }));
    const before = within(dialog).getByTestId("chat-privacy-notice").textContent;
    await user.click(within(screen.getByRole("region", { name: "Privacy settings" })).getByRole("button", { name: "Accept external maps" }));
    expect(within(dialog).getByTestId("chat-privacy-notice").textContent).toBe(before);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("the panel never mentions the chat as something the map choice enables", async () => {
    renderApp("/bamberg");
    const region = screen.getByRole("region", { name: "Privacy settings" });
    expect(region.textContent).toMatch(/does not cover the (chat|assistant)|only .*map/i);
  });
});
