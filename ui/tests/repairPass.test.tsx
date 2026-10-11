import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createHttpAssistantClient } from "../src/features/chat/httpAssistantClient";
import { createMockAssistantClient } from "../src/features/chat/mockAssistantClient";
import { renderApp } from "./renderApp";

const T = {
  en: {
    region: "Privacy settings", accept: "Accept external maps", settings: "Settings", save: "Save settings", closeButton: "Close without saving", footer: "Privacy settings",
    launcher: "Open the welcome assistant", dialog: "Welcome Assistant", switch: "Deutsch",
    notice: [/project's server/i, /source pointers/i, /evidence/i, /finding a source/i, /page memory/i, /OpenRouter/, /DeepInfra/, /do not enter personal data/i],
    policy: [/project's own server|demo's own server/i, /source pointers/i, /evidence/i, /finding a source/i, /page memory/i, /does not (persist|store)[^.]*history/i],
    cookies: [/demo's own code sets no cookies/i, /not (been )?audited/i],
    noOverclaim: /The site sets no cookies/i,
  },
  de: {
    region: "Datenschutzeinstellungen", accept: "Externe Karten akzeptieren", settings: "Einstellungen", save: "Einstellungen speichern", closeButton: "Schließen ohne Speichern", footer: "Datenschutzeinstellungen",
    launcher: "Willkommensassistent öffnen", dialog: "Willkommensassistent", switch: "English",
    notice: [/Server dieses Projekts/, /Quellenhinweise/, /Quellenprüfung/, /gefundene[nr]? (Quelle|Treffer)/i, /Arbeitsspeicher dieser Seite/, /OpenRouter/, /DeepInfra/, /keine personenbezogenen Daten/],
    policy: [/eigenen Server/, /Quellenhinweise/, /Quellenprüfung/, /gefundene[nr]? (Quelle|Treffer)/i, /Arbeitsspeicher/, /speichert keinen (Chat-|Gesprächs)?[Vv]erlauf/],
    cookies: [/eigene Code[^.]*setzt keine Cookies/i, /nicht (geprüft|überprüft)/i],
    noOverclaim: /Die Seite setzt keine Cookies/i,
  },
} as const;

const isFixed = (el: Element) => el.className.split(/\s+/).includes("fixed");

describe.each(["en", "de"] as const)("repair pass in %s", (lang) => {
  const L = T[lang];
  async function open(path: string) {
    const utils = renderApp(path, { assistantClient: createMockAssistantClient({ delayMs: 1 }) });
    if (lang === "de") {
      await utils.user.click(screen.getByRole("button", { name: "Deutsch" }));
      (document.activeElement as HTMLElement).blur();
    }
    return utils;
  }
  const region = () => screen.getByRole("region", { name: L.region });

  describe("panel on the legal pages", () => {
    it.each(["/impressum", "/datenschutz"])("%s: renders in normal document flow, not as a fixed overlay", async (path) => {
      await open(path);
      expect(isFixed(region())).toBe(false);
      expect(region()).toHaveAttribute("data-placement", "inline");
    });

    it("keeps the floating overlay on city pages and on the home page", async () => {
      await open("/bamberg");
      expect(isFixed(region())).toBe(true);
      expect(region()).toHaveAttribute("data-placement", "floating");
    });

    it("keeps the early DOM order (after the skip link, before the header) on a legal page", async () => {
      await open("/impressum");
      const skip = document.querySelector("a[href='#main']")!;
      expect(skip.compareDocumentPosition(region()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(region().compareDocumentPosition(screen.getByRole("banner")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("is still available and labelled, and is neither dismissed nor decided by visiting a legal page", async () => {
      const { user } = await open("/datenschutz");
      expect(region()).toBeVisible();
      expect(region()).not.toHaveAttribute("aria-modal");
      expect(document.querySelector("iframe")).toBeNull();
      await user.click(within(screen.getByRole("contentinfo")).getByRole("link", { name: "Impressum" }));
      expect(region()).toBeVisible(); // still undecided after moving between legal pages
    });

    it("both panel views work inline: Settings view focuses the checkbox, Close without saving restores to the footer button", async () => {
      const { user } = await open("/impressum");
      await user.click(within(region()).getByRole("button", { name: L.settings }));
      expect(isFixed(region())).toBe(false);
      expect(document.activeElement).toBe(within(region()).getByRole("checkbox"));
      await user.click(within(region()).getByRole("button", { name: L.closeButton }));
      expect(document.activeElement).toBe(within(screen.getByRole("contentinfo")).getByRole("button", { name: L.footer }));
    });

    it("accepting on a legal page still only changes the map choice (nothing mounted there, no chat request)", async () => {
      const fetchImpl = vi.fn();
      const utils = renderApp("/impressum", { assistantClient: createHttpAssistantClient({ fetchImpl }) });
      if (lang === "de") await utils.user.click(screen.getByRole("button", { name: "Deutsch" }));
      await utils.user.click(within(region()).getByRole("button", { name: L.accept }));
      expect(screen.queryByRole("region", { name: L.region })).toBeNull();
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  describe("accurate copy", () => {
    it("HTTP chat notice describes the real server-side flow", async () => {
      const { user } = renderApp("/bamberg", { assistantClient: createHttpAssistantClient({ fetchImpl: vi.fn() }) });
      if (lang === "de") await user.click(screen.getByRole("button", { name: "Deutsch" }));
      await user.click(screen.getByRole("button", { name: L.launcher }));
      const notice = within(screen.getByRole("dialog", { name: L.dialog })).getByTestId("chat-privacy-notice");
      for (const phrase of L.notice) expect(notice.textContent).toMatch(phrase);
    });

    it("mock notice stays a sample-mode notice and does not describe a provider flow", async () => {
      const { user } = await open("/bamberg");
      await user.click(screen.getByRole("button", { name: L.launcher }));
      const notice = within(screen.getByRole("dialog", { name: L.dialog })).getByTestId("chat-privacy-notice");
      expect(notice.textContent).not.toMatch(/OpenRouter|DeepInfra/);
      expect(notice.textContent).toMatch(lang === "en" ? /Sample mode/ : /Beispielmodus/);
    });

    it("Datenschutz chat section states the evidence gate and in-memory conversation", async () => {
      await open("/datenschutz");
      const text = document.querySelector("article")!.textContent!;
      for (const phrase of L.policy) expect(text).toMatch(phrase);
    });

    it("Datenschutz qualifies the cookie statement to the demo's own code and does not claim the OSM embed was audited", async () => {
      await open("/datenschutz");
      const text = document.querySelector("article")!.textContent!;
      expect(text).not.toMatch(L.noOverclaim);
      for (const phrase of L.cookies) expect(text).toMatch(phrase);
    });
  });
});
