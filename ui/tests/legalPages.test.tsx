import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LEGAL_CONFIG } from "../src/data/legalConfig";
import { renderApp } from "./renderApp";

const DRAFT = { en: "Internal demo draft — not approved for publication", de: "Interner Demo-Entwurf – nicht zur Veröffentlichung freigegeben" };
const UNSET = { en: "[not set]", de: "[nicht festgelegt]" };

function allValues(value: unknown): unknown[] {
  return typeof value === "object" && value !== null ? Object.values(value).flatMap(allValues) : [value];
}

describe("legalConfig", () => {
  it("leaves every operator, contact and hosting field unset (null): nothing is invented", () => {
    const unknownParts = [LEGAL_CONFIG.operator, LEGAL_CONFIG.privacyContact, LEGAL_CONFIG.hosting];
    for (const part of unknownParts) for (const value of allValues(part)) expect(value).toBeNull();
    expect(LEGAL_CONFIG.status).toBe("internal-demo-draft");
  });
});

describe.each(["en", "de"] as const)("legal pages in %s", (lang) => {
  async function open(path: string) {
    const utils = renderApp(path);
    if (lang === "de") await utils.user.click(screen.getByRole("button", { name: "Deutsch" }));
    return utils;
  }
  const main = () => screen.getByRole("main");

  it.each(["/impressum", "/datenschutz"])("%s opens directly, with the draft status shown prominently", async (path) => {
    await open(path);
    expect(screen.getByRole("heading", { level: 1, name: path === "/impressum" ? "Impressum" : lang === "en" ? "Privacy policy (Datenschutz)" : "Datenschutzerklärung" })).toBeInTheDocument();
    const banner = within(main()).getByRole("note");
    expect(banner).toHaveTextContent(DRAFT[lang]);
    // The banner comes before the content, so it is the first thing read after the heading.
    expect(main().querySelector("h1")!.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.title).toMatch(path === "/impressum" ? /Impressum/ : /Datenschutz|Privacy/);
  });

  it("the Impressum shows every operator field as unset and invents nothing", async () => {
    await open("/impressum");
    const text = main().textContent ?? "";
    expect(text.split(UNSET[lang]).length - 1).toBeGreaterThanOrEqual(3); // address, real e-mail, phone
    expect(text).toContain(lang === "en" ? "Not yet finally determined" : "Noch nicht abschließend festgelegt");
    expect(main().querySelector('a[href="mailto:example@gmail.com"]')).toBeNull();
    expect(text).not.toMatch(/\+?\d[\d\s/-]{7,}\d/); // no phone number
    expect(text).not.toMatch(/Ali Moradkhani|Moradkhani/);
    expect(text).toMatch(lang === "en" ? /not (yet )?confirmed/i : /nicht (bestätigt|festgelegt)/i);
    expect(text).not.toMatch(/(endorsed|supported) by|University of|Universität (Bamberg|Bayreuth|Coburg)\b.*(Träger|betrieben)/i);
  });

  it("the Datenschutz describes only the verified data flows and leaves legal bases open", async () => {
    await open("/datenschutz");
    const text = main().textContent ?? "";
    expect(text).toContain("mein-oberfranken:language:v1"); // the one existing storage key, named honestly
    expect(text).toMatch(/OpenStreetMap/);
    expect(text).toMatch(/OpenRouter/);
    expect(text).toMatch(/DeepInfra/);
    expect(text).toMatch(lang === "en" ? /personal data/i : /personenbezogene/i);
    expect(text).toMatch(lang === "en" ? /not (yet )?(been )?(determined|decided|confirmed)/i : /nicht (festgelegt|bestimmt|entschieden|bestätigt)/i);
    expect(text.split(UNSET[lang]).length - 1).toBeGreaterThanOrEqual(2); // operator and hosting
    // No compliance claims, no invented legal bases, no invented processing locations.
    expect(text).not.toMatch(/GDPR[- ]compliant|DSGVO[- ]konform|fully compliant|exempt|ausgenommen|Art\.\s*\d|Artikel\s*\d|§\s*\d/i);
    expect(text).not.toMatch(/\b(Frankfurt|Ireland|Irland|Germany|Deutschland)\b.*(server|hosted|gehostet)/i);
  });

  it("the Datenschutz keeps map permission and chat processing separate and says withdrawal does not erase earlier data", async () => {
    await open("/datenschutz");
    const text = main().textContent ?? "";
    expect(text).toMatch(lang === "en" ? /does not (allow|authori[sz]e|cover) (the )?chat/i : /gilt nicht für den Chat|erlaubt nicht.*Chat/i);
    expect(text).toMatch(lang === "en" ? /does not (erase|delete|undo)/i : /nicht (gelöscht|rückgängig)/i);
    expect(text).toMatch(lang === "en" ? /does not persist conversation history/i : /speichert keinen Gesprächsverlauf/i);
  });

  it.each(["/", "/bamberg", "/bayreuth", "/impressum", "/datenschutz", "/does-not-exist"])("the footer links to both pages on %s", async (path) => {
    await open(path);
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "Impressum" })).toHaveAttribute("href", "/impressum");
    expect(within(footer).getByRole("link", { name: lang === "en" ? "Privacy policy (Datenschutz)" : "Datenschutz" })).toHaveAttribute("href", "/datenschutz");
    expect(within(footer).getByRole("button", { name: lang === "en" ? "Privacy settings" : "Datenschutzeinstellungen" })).toBeInTheDocument();
  });

  it("the footer links work by click and do not require any choice or chat use", async () => {
    const { user } = await open("/bamberg");
    await user.click(within(screen.getByRole("contentinfo")).getByRole("link", { name: "Impressum" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/impressum");
    expect(screen.getByRole("heading", { level: 1, name: "Impressum" })).toBeInTheDocument();
  });

  it("the privacy panel links to the policy", async () => {
    await open("/bamberg");
    const region = screen.getByRole("region", { name: lang === "en" ? "Privacy settings" : "Datenschutzeinstellungen" });
    expect(within(region).getByRole("link", { name: /Datenschutz|Privacy policy/ })).toHaveAttribute("href", "/datenschutz");
  });
});
