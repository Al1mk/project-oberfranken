import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { AppProviders } from "../src/App";
import { CATALOG, getDiscovery, type Catalog } from "../src/data/catalog";
import { CITY_PAGES } from "../src/data/cityPages";
import { createMockAssistantClient } from "../src/features/chat/mockAssistantClient";
import { CityPageTemplate } from "../src/features/city/CityPageTemplate";
import type { CitySlug } from "../src/data/types";
import { renderApp } from "./renderApp";

const CITIES: CitySlug[] = ["bamberg", "bayreuth"];
const LANGUAGES = [
  { code: "en", button: "English", retrieved: "Retrieved 8 October 2026", source: "Source", participation: { spectator: "Watch as a spectator", both: "Watch or take part" } },
  { code: "de", button: "Deutsch", retrieved: "Abgerufen am 8. Oktober 2026", source: "Quelle", participation: { spectator: "Als Zuschauer dabei sein", both: "Zuschauen oder mitmachen" } },
] as const;

async function renderCity(slug: CitySlug, language: "en" | "de") {
  const utils = renderApp(`/${slug}`);
  if (language === "de") await utils.user.click(screen.getByRole("button", { name: "Deutsch" }));
  return utils;
}

describe.each(CITIES)("catalog-driven discovery on %s", (slug) => {
  describe.each(LANGUAGES)("in $code", ({ code, retrieved, source, participation }) => {
    it("shows every restaurant with all required facts, exactly as the catalog has them", async () => {
      await renderCity(slug, code);
      const section = screen.getByRole("region", { name: "Restaurants" });
      const records = getDiscovery(slug, "restaurants");
      expect(within(section).getAllByRole("article")).toHaveLength(records.length);
      for (const record of records) {
        const entry = section.querySelector<HTMLElement>(`[data-record-id="${record.id}"]`)!;
        const view = within(entry);
        expect(view.getByRole("heading", { name: record.title[code] })).toBeInTheDocument();
        // Some values repeat inside an entry (dish and recommended order; source and title), so match any.
        for (const text of [
          record.summary[code],
          record.whyNotable[code],
          record.details.cuisine[code],
          record.details.signatureDish[code],
          record.details.recommendedOrder[code],
          record.details.whyOrderIt[code],
        ]) {
          expect(view.getAllByText(text).length).toBeGreaterThan(0);
        }
        const link = view.getByRole("link", { name: new RegExp(record.source.name) });
        expect(link).toHaveAttribute("href", record.source.url);
        expect(view.getByText(retrieved)).toBeInTheDocument();
        expect(view.getByText(`${source}:`)).toBeInTheDocument();
      }
    });

    it("shows every sports club; the achievement only when the catalog has one", async () => {
      await renderCity(slug, code);
      const section = screen.getByRole("region", { name: "Sport" });
      const records = getDiscovery(slug, "sports");
      expect(within(section).getAllByRole("article")).toHaveLength(records.length);
      for (const record of records) {
        const entry = section.querySelector<HTMLElement>(`[data-record-id="${record.id}"]`)!;
        const view = within(entry);
        expect(view.getByRole("heading", { name: record.title[code] })).toBeInTheDocument();
        for (const text of [record.summary[code], record.whyNotable[code], record.details.sport[code], record.details.homeVenue]) {
          expect(view.getAllByText(text).length).toBeGreaterThan(0);
        }
        const label = code === "en" ? "Achievement" : "Erfolg";
        if (record.details.achievement) {
          expect(view.getByText(label)).toBeInTheDocument();
          expect(view.getByText(record.details.achievement[code])).toBeInTheDocument();
        } else {
          expect(view.queryByText(label)).not.toBeInTheDocument();
          expect(entry.textContent).not.toMatch(/null|undefined/);
        }
        expect(view.getByText(participation[record.details.participationType as "spectator" | "both"])).toBeInTheDocument();
        expect(view.getByRole("link", { name: new RegExp(record.source.name) })).toHaveAttribute("href", record.source.url);
        expect(view.getByText(retrieved)).toBeInTheDocument();
      }
    });

    // Which slide is active comes from scroll layout, which jsdom lacks: following the slide is checked in a real browser.
    it("shows the details and source of the first sight under the carousel", async () => {
      await renderCity(slug, code);
      const section = screen.getByRole("region", { name: code === "en" ? "Places to see" : "Sehenswürdigkeiten" });
      const [first] = getDiscovery(slug, "sights");
      const entry = () => within(section).getByRole("article");

      expect(entry()).toHaveAttribute("data-record-id", first!.id);
      for (const text of [first!.details.whyVisit[code], first!.details.keyHighlight[code], first!.details.significance[code]]) {
        expect(within(entry()).getByText(text)).toBeInTheDocument();
      }
      expect(within(entry()).getByRole("link", { name: new RegExp(first!.source.name) })).toHaveAttribute("href", first!.source.url);
      expect(within(entry()).getByText(retrieved)).toBeInTheDocument();
    });
  });

  it("orders the sections and the in-page links: places, restaurants, sport, then the sample sections", () => {
    renderApp(`/${slug}`);
    const titles = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    const expected = ["Places to see", "Restaurants", "Sport", "Culture & Tradition", "Activities & Participation", "Official Newcomer Information", "City map", "Sources"];
    const headings = expected.map((title) => (title === "Sources" ? `Sources for ${slug === "bamberg" ? "Bamberg" : "Bayreuth"}` : title));
    expect(titles.filter((title) => headings.includes(title!))).toEqual(headings);

    const nav = screen.getByRole("navigation", { name: "On this page" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual(expected);
    // Router links: the full path keeps the hash working when opened in a new tab.
    expect(within(nav).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(
      ["places-to-see", "restaurants", "sports", "culture-tradition", "activities-participation", "official-newcomer-information", "city-map", "sources"].map((id) => `/${slug}#${id}`),
    );
  });

  it("shows sources and dates in the sourced page sections without sample badges", () => {
    renderApp(`/${slug}`);
    const badge = "Sample content: not yet connected to the knowledge base";
    for (const name of ["Culture & Tradition", "Activities & Participation", "Official Newcomer Information"]) {
      const section = screen.getByRole("region", { name });
      expect(within(section).queryByText(badge)).not.toBeInTheDocument();
      expect(within(section).getAllByText(/^Retrieved /)).toHaveLength(3);
    }
    for (const name of ["Places to see", "Restaurants", "Sport"]) {
      expect(within(screen.getByRole("region", { name })).queryByText(badge)).not.toBeInTheDocument();
    }
  });

  it("never shows the limited restaurants, ratings, prices or opening hours", () => {
    renderApp(`/${slug}`);
    const page = document.body.textContent ?? "";
    expect(page).not.toMatch(/Brauhaus zum Sternla|Liebesbier/);
    expect(page).not.toMatch(/[★€]|\bstars?\b|\bratings?\b|\btop-rated\b|\bopen (?:daily|until)\b/i);
    expect(screen.getByText(/shows no opening hours, prices, availability, rankings or current menus/)).toBeInTheDocument();
  });
});

describe("a city without entries in a category", () => {
  const withoutRestaurants: Catalog = { ...CATALOG, records: CATALOG.records.filter((r) => !(r.city === "bamberg" && r.discoveryCategory === "restaurants")) };

  function renderTemplate(catalog: Catalog) {
    render(
      <MemoryRouter>
        <AppProviders assistantClient={createMockAssistantClient({ delayMs: 1 })}>
          <CityPageTemplate city={CITY_PAGES.bamberg} catalog={catalog} />
        </AppProviders>
      </MemoryRouter>,
    );
  }

  it("hides the empty section and its link", () => {
    renderTemplate(withoutRestaurants);
    expect(screen.queryByRole("region", { name: "Restaurants" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "On this page" })).queryByRole("link", { name: "Restaurants" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Sport" })).toBeInTheDocument();
  });

  it("lists the remaining verified sources and drops the hidden ones", () => {
    renderTemplate(withoutRestaurants);
    const verified = within(screen.getByRole("region", { name: /^Sources for / })).getByRole("list", { name: "Sources for sights, restaurants and sport" });
    const hidden = CATALOG.records.filter((r) => r.city === "bamberg" && r.discoveryCategory === "restaurants");
    for (const record of hidden) {
      expect(within(verified).queryByText(record.title.en)).not.toBeInTheDocument();
    }
  });
});
