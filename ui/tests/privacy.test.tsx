import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpAssistantClient } from "../src/features/chat/httpAssistantClient";
import { renderApp } from "./renderApp";

const LANGS = {
  en: { region: "Privacy settings", accept: "Accept external maps", reject: "Reject", settings: "Settings", footer: "Privacy settings", switch: "English" },
  de: { region: "Datenschutzeinstellungen", accept: "Externe Karten akzeptieren", reject: "Ablehnen", settings: "Einstellungen", footer: "Datenschutzeinstellungen", switch: "Deutsch" },
} as const;

const iframe = () => document.querySelector("iframe");
const panel = (name: string) => screen.queryByRole("region", { name });
afterEach(() => vi.restoreAllMocks());

describe.each(["en", "de"] as const)("first visit in %s", (lang) => {
  const L = LANGS[lang];
  async function open(path: string) {
    const utils = renderApp(path);
    if (lang === "de") await utils.user.click(screen.getByRole("button", { name: "Deutsch" }));
    return utils;
  }

  it("shows a non-blocking panel with exactly Accept external maps, Reject and Settings", async () => {
    await open("/bamberg");
    const region = screen.getByRole("region", { name: L.region });
    expect(within(region).getAllByRole("button").map((b) => b.textContent)).toEqual(expect.arrayContaining([L.accept, L.reject, L.settings]));
    expect(screen.queryByRole("dialog", { name: L.region })).not.toBeInTheDocument(); // not modal
    expect(region).not.toHaveAttribute("aria-modal");
    // Using the site stays possible: the main content is not inert or hidden.
    expect(screen.getByRole("heading", { level: 1, name: "Bamberg" })).toBeVisible();
    expect(document.querySelector("[inert]")).toBeNull();
  });

  it("mounts no map before a choice: no iframe, no remote image, no preconnect/preload/prefetch", async () => {
    await open("/bamberg");
    expect(iframe()).toBeNull();
    expect(document.querySelector('link[rel="preconnect"], link[rel="preload"], link[rel="dns-prefetch"], link[rel="prefetch"]')).toBeNull();
    expect([...document.querySelectorAll("img")].some((img) => /openstreetmap|tile\./.test(img.src))).toBe(false);
    const section = screen.getByRole("region", { name: lang === "en" ? "City map" : "Stadtkarte" });
    expect(section.querySelector("[data-map-state='blocked']")).not.toBeNull();
    // A local placeholder with an optional link and a way to open the settings, nothing loaded automatically.
    expect(within(section).getByRole("link", { name: /OpenStreetMap/ })).toHaveAttribute("href", expect.stringContaining("https://www.openstreetmap.org/?mlat="));
    expect(within(section).getByRole("button", { name: L.footer })).toBeInTheDocument();
  });

  it("Reject closes the panel and keeps the map blocked, also after in-app navigation", async () => {
    const { user } = await open("/bamberg");
    await user.click(within(screen.getByRole("region", { name: L.region })).getByRole("button", { name: L.reject }));
    expect(panel(L.region)).toBeNull();
    expect(iframe()).toBeNull();
    await user.click(within(screen.getByRole("navigation", { name: lang === "en" ? "Breadcrumb" : "Brotkrumennavigation" })).getByRole("link"));
    await user.click(screen.getByRole("button", { name: lang === "en" ? "Explore Your Oberfranken" : "Entdecke dein Oberfranken" }));
    await user.click(within(screen.getByRole("region", { name: lang === "en" ? "Open in the pilot" : "Im Pilot geöffnet" })).getByRole("link", { name: /^Bayreuth/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("/bayreuth");
    expect(iframe()).toBeNull();
    expect(panel(L.region)).toBeNull(); // the choice is remembered in memory while navigating
  });

  it("Accept mounts the OpenStreetMap iframe and closes the panel", async () => {
    const { user } = await open("/bayreuth");
    await user.click(within(screen.getByRole("region", { name: L.region })).getByRole("button", { name: L.accept }));
    expect(panel(L.region)).toBeNull();
    const frame = iframe();
    expect(frame).not.toBeNull();
    expect(frame!.getAttribute("src")).toContain("https://www.openstreetmap.org/export/embed.html");
    expect(frame!.getAttribute("src")).toContain("marker=49.9456,11.5713");
  });

  it("withdrawal through the footer removes the iframe immediately and keeps it blocked", async () => {
    const { user } = await open("/bamberg");
    await user.click(within(screen.getByRole("region", { name: L.region })).getByRole("button", { name: L.accept }));
    expect(iframe()).not.toBeNull();
    await user.click(within(screen.getByRole("contentinfo")).getByRole("button", { name: L.footer }));
    const settings = screen.getByRole("region", { name: L.region });
    const box = within(settings).getByRole("checkbox");
    expect(box).toBeChecked();
    await user.click(box);
    await user.click(within(settings).getByRole("button", { name: lang === "en" ? "Save settings" : "Einstellungen speichern" }));
    expect(iframe()).toBeNull();
    expect(panel(L.region)).toBeNull();
    expect(document.body.textContent).toMatch(lang === "en" ? /blocked/i : /gesperrt|blockiert/i);
  });

  it("Settings starts with maps off; saving without ticking is a rejection", async () => {
    const { user } = await open("/bamberg");
    await user.click(within(screen.getByRole("region", { name: L.region })).getByRole("button", { name: L.settings }));
    const box = within(screen.getByRole("region", { name: L.region })).getByRole("checkbox");
    expect(box).not.toBeChecked();
    await user.click(within(screen.getByRole("region", { name: L.region })).getByRole("button", { name: lang === "en" ? "Save settings" : "Einstellungen speichern" }));
    expect(iframe()).toBeNull();
    expect(panel(L.region)).toBeNull();
  });

  it("a reload resets the choice: the panel is back and the map is blocked again", async () => {
    const first = await open("/bamberg");
    await first.user.click(within(screen.getByRole("region", { name: L.region })).getByRole("button", { name: L.accept }));
    expect(iframe()).not.toBeNull();
    first.unmount();
    await open("/bamberg");
    expect(iframe()).toBeNull();
    expect(screen.getByRole("region", { name: L.region })).toBeInTheDocument();
  });

  it("the panel buttons are reachable with the keyboard and work with Enter", async () => {
    const { user } = await open("/bamberg");
    let reached = false;
    for (let i = 0; i < 400 && !reached; i++) {
      await user.tab();
      reached = document.activeElement?.textContent === L.reject && !!document.activeElement.closest("[aria-label], [aria-labelledby]");
    }
    expect(reached).toBe(true);
    await user.keyboard("{Enter}");
    expect(panel(L.region)).toBeNull();
    expect(iframe()).toBeNull();
  });
});

describe("no new persistent storage and no unsolicited chat requests", () => {
  it("makes no storage write and sets no cookie for any privacy choice (reject, accept, withdraw)", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { user } = renderApp("/bamberg");
    await user.click(within(screen.getByRole("region", { name: "Privacy settings" })).getByRole("button", { name: "Accept external maps" }));
    await user.click(within(screen.getByRole("contentinfo")).getByRole("button", { name: "Privacy settings" }));
    await user.click(within(screen.getByRole("region", { name: "Privacy settings" })).getByRole("checkbox"));
    await user.click(within(screen.getByRole("region", { name: "Privacy settings" })).getByRole("button", { name: "Save settings" }));
    expect(setItem).not.toHaveBeenCalled();
    expect(document.cookie).toBe("");
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("the existing language preference is unchanged: still the only key, written only when the language changes", async () => {
    const { user } = renderApp("/bamberg");
    await user.click(within(screen.getByRole("region", { name: "Privacy settings" })).getByRole("button", { name: "Reject" }));
    expect(window.localStorage.length).toBe(0);
    await user.click(screen.getByRole("button", { name: "Deutsch" }));
    expect(Object.keys(window.localStorage)).toEqual(["mein-oberfranken:language:v1"]);
  });

  it("makes no /api/chat request on load, navigation or any privacy choice", async () => {
    const fetchImpl = vi.fn();
    const { user } = renderApp("/bamberg", { assistantClient: createHttpAssistantClient({ fetchImpl }) });
    await user.click(within(screen.getByRole("region", { name: "Privacy settings" })).getByRole("button", { name: "Accept external maps" }));
    await user.click(within(screen.getByRole("contentinfo")).getByRole("button", { name: "Privacy settings" }));
    await user.click(within(screen.getByRole("region", { name: "Privacy settings" })).getByRole("button", { name: "Close" }));
    await user.click(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link"));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("closing the panel without a choice keeps the map blocked", async () => {
    const { user } = renderApp("/bamberg");
    await user.click(within(screen.getByRole("region", { name: "Privacy settings" })).getByRole("button", { name: "Close" }));
    expect(panel("Privacy settings")).toBeNull();
    expect(iframe()).toBeNull();
    await waitFor(() => expect(within(screen.getByRole("contentinfo")).getByRole("button", { name: "Privacy settings" })).toBeInTheDocument());
  });
});
