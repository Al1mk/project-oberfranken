import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "./renderApp";

const LANGS = {
  en: { region: "Privacy settings", accept: "Accept external maps", reject: "Reject", settings: "Settings", close: "Close", closeButton: "Close without saving", save: "Save settings", footer: "Privacy settings", switch: "English" },
  de: { region: "Datenschutzeinstellungen", accept: "Externe Karten akzeptieren", reject: "Ablehnen", settings: "Einstellungen", close: "Schließen", closeButton: "Schließen ohne Speichern", save: "Einstellungen speichern", footer: "Datenschutzeinstellungen", switch: "Deutsch" },
} as const;

describe.each(["en", "de"] as const)("privacy panel keyboard and focus in %s", (lang) => {
  const L = LANGS[lang];
  async function open(path = "/bamberg") {
    const utils = renderApp(path);
    if (lang === "de") {
      await utils.user.click(screen.getByRole("button", { name: "Deutsch" }));
      (document.activeElement as HTMLElement).blur(); // start from the top of the page, as after a fresh load
    }
    return utils;
  }
  const region = () => screen.getByRole("region", { name: L.region });
  const footerButton = () => within(screen.getByRole("contentinfo")).getByRole("button", { name: L.footer });
  const mapButton = () => within(document.querySelector("[data-map-state='blocked']") as HTMLElement).getByRole("button", { name: L.footer });

  describe("first visit", () => {
    it("sits right after the skip link and before the header in the DOM", async () => {
      await open();
      const skip = document.querySelector("a[href='#main']")!;
      const header = screen.getByRole("banner");
      expect(skip.compareDocumentPosition(region()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(region().compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("Tab enters the panel straight after the skip link and walks it in order, then leaves it", async () => {
      const { user } = await open();
      const inPanel = within(region()).getAllByRole("button").concat(within(region()).getAllByRole("link"));
      expect(inPanel.length).toBeGreaterThanOrEqual(5);
      await user.tab(); // skip link
      expect(document.activeElement).toBe(document.querySelector("a[href='#main']"));
      await user.tab();
      expect(document.activeElement).toBe(within(region()).getByRole("button", { name: L.close }));
      await user.tab();
      expect(document.activeElement).toBe(within(region()).getByRole("button", { name: L.accept }));
      await user.tab();
      expect(document.activeElement).toBe(within(region()).getByRole("button", { name: L.reject }));
      await user.tab();
      expect(document.activeElement).toBe(within(region()).getByRole("button", { name: L.settings }));
      await user.tab();
      expect(document.activeElement).toBe(within(region()).getByRole("link"));
      await user.tab(); // out of the panel, into the page: no trap
      expect(region().contains(document.activeElement)).toBe(false);
      expect(screen.getByRole("banner").contains(document.activeElement)).toBe(true);
    });

    it("Shift+Tab from the header re-enters the panel at its last control", async () => {
      const { user } = await open();
      const firstHeaderStop = within(screen.getByRole("banner")).getAllByRole("link")[0]!;
      firstHeaderStop.focus();
      await user.tab({ shift: true });
      expect(document.activeElement).toBe(within(region()).getByRole("link"));
    });

    it("does not take focus on its own and has no modal semantics or positive tabindex", async () => {
      await open();
      expect(region().contains(document.activeElement)).toBe(false);
      expect(region()).not.toHaveAttribute("aria-modal");
      expect(region().querySelector("[tabindex]:not([tabindex='0']):not([tabindex='-1'])")).toBeNull();
    });

    it.each(["accept", "reject", "close"] as const)("%s with focus inside the panel moves focus to the footer Privacy settings button", async (action) => {
      const { user } = await open();
      await user.click(within(region()).getByRole("button", { name: L[action] }));
      expect(screen.queryByRole("region", { name: L.region })).toBeNull();
      expect(document.activeElement).toBe(footerButton());
    });

    it("Settings view entry focuses the checkbox; Close without saving then restores to the footer button", async () => {
      const { user } = await open();
      await user.click(within(region()).getByRole("button", { name: L.settings }));
      expect(document.activeElement).toBe(within(region()).getByRole("checkbox"));
      await user.click(within(region()).getByRole("button", { name: L.closeButton }));
      expect(document.activeElement).toBe(footerButton());
    });

    it("Save from the first-visit settings view restores focus to the footer button", async () => {
      const { user } = await open();
      await user.click(within(region()).getByRole("button", { name: L.settings }));
      await user.click(within(region()).getByRole("button", { name: L.save }));
      expect(document.activeElement).toBe(footerButton());
    });
  });

  describe("reopening from a trigger", () => {
    it("the footer button opens settings with the checkbox focused and gets focus back on Close", async () => {
      const { user } = await open();
      await user.click(within(region()).getByRole("button", { name: L.reject }));
      await user.click(footerButton());
      expect(document.activeElement).toBe(within(region()).getByRole("checkbox"));
      await user.click(within(region()).getByRole("button", { name: L.close }));
      expect(document.activeElement).toBe(footerButton());
    });

    it("opening again while the settings are already open still moves focus to the checkbox", async () => {
      const { user } = await open();
      await user.click(within(region()).getByRole("button", { name: L.reject }));
      await user.click(footerButton());
      within(region()).getByRole("button", { name: L.save }).focus();
      await user.click(footerButton());
      expect(document.activeElement).toBe(within(region()).getByRole("checkbox"));
    });

    it("the map placeholder button is remembered and gets focus back when closing without a change", async () => {
      const { user } = await open();
      await user.click(within(region()).getByRole("button", { name: L.reject }));
      const trigger = mapButton();
      await user.click(trigger);
      expect(document.activeElement).toBe(within(region()).getByRole("checkbox"));
      await user.click(within(region()).getByRole("button", { name: L.closeButton }));
      expect(document.activeElement).toBe(trigger);
    });

    it("when accepting removes the map placeholder trigger, focus falls back to the footer button", async () => {
      const { user } = await open();
      await user.click(within(region()).getByRole("button", { name: L.reject }));
      const trigger = mapButton();
      await user.click(trigger);
      await user.click(within(region()).getByRole("checkbox"));
      await user.click(within(region()).getByRole("button", { name: L.save }));
      expect(trigger.isConnected).toBe(false);
      expect(document.querySelector("iframe")).not.toBeNull();
      expect(document.activeElement).toBe(footerButton());
    });

    it("falls back to main when neither the invoker nor the footer button is usable", async () => {
      const { user } = await open();
      await user.click(within(region()).getByRole("button", { name: L.reject }));
      await user.click(footerButton());
      footerButton().remove();
      await user.click(within(region()).getByRole("button", { name: L.close }));
      expect(document.activeElement).toBe(document.getElementById("main"));
    });
  });

  describe("never steals focus", () => {
    it("a dismissal while focus is elsewhere leaves focus where it is", async () => {
      await open();
      const elsewhere = within(screen.getByRole("banner")).getAllByRole("link")[0]!;
      elsewhere.focus();
      fireEvent.click(within(region()).getByRole("button", { name: L.reject })); // no focus move, like an assistive or scripted click
      expect(screen.queryByRole("region", { name: L.region })).toBeNull();
      expect(document.activeElement).toBe(elsewhere);
    });

    it("following the privacy-policy link from the panel is left to normal route focus handling", async () => {
      const { user } = await open();
      await user.click(within(region()).getByRole("link"));
      expect(screen.getByTestId("location")).toHaveTextContent("/datenschutz");
      expect(document.activeElement).toBe(document.getElementById("main"));
      expect(document.activeElement).not.toBe(footerButton());
    });
  });
});
