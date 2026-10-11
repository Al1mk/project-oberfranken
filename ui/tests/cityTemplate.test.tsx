import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CITY_PAGES } from "../src/data/cityPages";
import { getCatalogSourceGroups, getDiscovery } from "../src/data/catalog";
import { SIGHT_PHOTOS_BY_RECORD } from "../src/data/sights";
import { getRecords, getSourceGroups } from "../src/data/sourceRecords";
import type { CitySlug } from "../src/data/types";
import { renderApp } from "./renderApp";

const REQUIRED_SECTIONS = [
  "Places to see",
  "Restaurants",
  "Sport",
  "Culture & Tradition",
  "Activities & Participation",
  "Official Newcomer Information",
  "City map",
];

describe.each<CitySlug>(["bamberg", "bayreuth"])("city page template: %s", (slug) => {
  const city = CITY_PAGES[slug];
  const otherSlug: CitySlug = slug === "bamberg" ? "bayreuth" : "bamberg";

  it("renders the hero with breadcrumb, intro, art placeholder and explorer entry", () => {
    renderApp(`/${slug}`);
    expect(screen.getByRole("heading", { level: 1, name: city.name })).toBeInTheDocument();
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByText(city.intro.en)).toBeInTheDocument();
    expect(screen.getByText(city.tagline.en, { selector: "p" })).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: city.photo.alt.en }).length).toBeGreaterThan(0);
    expect(screen.getAllByText(`Photo: ${city.photo.author}, ${city.photo.license}`, { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Explore other towns" })).toBeInTheDocument();
  });

  it("renders all required sections", () => {
    renderApp(`/${slug}`);
    for (const title of REQUIRED_SECTIONS) {
      expect(screen.getByRole("region", { name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Open the welcome assistant" })).toBeInTheDocument();
  });

  it("shows this city's records and not the other city's", () => {
    renderApp(`/${slug}`);
    for (const record of getRecords(slug)) {
      expect(screen.getAllByText(record.title.en).length).toBeGreaterThan(0);
    }
    const otherOnly = getRecords(otherSlug).filter(
      (record) => !getRecords(slug).some((own) => own.title.en === record.title.en),
    );
    for (const record of otherOnly) {
      expect(screen.queryByText(record.title.en)).not.toBeInTheDocument();
    }
  });

  it("renders newcomer entries with source name, link and retrieval label", () => {
    renderApp(`/${slug}`);
    const section = screen.getByRole("region", { name: "Official Newcomer Information" });
    const records = getRecords(slug, "official-newcomer-information");
    expect(within(section).getAllByRole("listitem")).toHaveLength(records.length);
    for (const record of records) {
      const entry = section.querySelector<HTMLElement>(`[data-record-id="${record.id}"]`)!;
      expect(within(entry).getByRole("link", { name: new RegExp(record.sourceName) })).toHaveAttribute("href", record.sourceUrl);
    }
    expect(within(section).getByText(/linked official sources/)).toBeInTheDocument();
    expect(within(section).queryByText("Retrieval date pending curation")).not.toBeInTheDocument();
    expect(within(section).getAllByText(/^Retrieved /)).toHaveLength(records.length);
  });

  it("embeds an OpenStreetMap map with an accessible title and attribution, once external maps are accepted", async () => {
    const { user } = renderApp(`/${slug}`);
    await user.click(within(screen.getByRole("region", { name: "Privacy settings" })).getByRole("button", { name: "Accept external maps" }));
    const frame = screen.getByTitle(`Map showing the location of ${city.name}, from OpenStreetMap`);
    expect(frame.getAttribute("src")).toContain("openstreetmap.org/export/embed.html");
    expect(frame.getAttribute("src")).toContain(`marker=${city.location.lat},${city.location.lon}`);
    expect(screen.getByRole("link", { name: /OpenStreetMap contributors/ })).toHaveAttribute(
      "href",
      "https://www.openstreetmap.org/copyright",
    );
  });

  it("lists discovery and page sources with their retrieval and verification provenance", () => {
    renderApp(`/${slug}`);
    const section = screen.getByRole("region", { name: `Sources for ${city.name}` });
    const verified = within(section).getByRole("list", { name: "Sources for sights, restaurants and sport" });
    const page = within(section).getByRole("list", { name: "Sources for culture, activities and newcomer information" });
    expect(within(verified).getAllByRole("listitem")).toHaveLength(getCatalogSourceGroups(slug).length);
    expect(within(page).getAllByRole("listitem")).toHaveLength(getSourceGroups(slug).length);

    for (const group of getCatalogSourceGroups(slug)) {
      expect(within(verified).getAllByRole("link").some((link) => link.getAttribute("href") === group.source.url)).toBe(true);
    }
    const links = [...within(verified).getAllByRole("link"), ...within(page).getAllByRole("link")];
    expect(links).toHaveLength(getCatalogSourceGroups(slug).length + getSourceGroups(slug).length);
    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(link).toHaveTextContent("(opens in a new tab)");
    }
  });

  it("renders city content in German", async () => {
    const { user } = renderApp(`/${slug}`);
    await user.click(screen.getByRole("button", { name: "Deutsch" }));
    expect(screen.getByText(city.intro.de)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Offizielle Informationen für Neuankommende" })).toBeInTheDocument();
    expect(screen.getAllByText(getRecords(slug, "culture-tradition")[0]!.title.de).length).toBeGreaterThan(0);
  });

  it("shows the sights as a carousel with a credit for the active photo", () => {
    renderApp(`/${slug}`);
    const carousel = screen.getByRole("region", { name: `Places to see in ${city.name}` });
    expect(carousel).toHaveAttribute("aria-roledescription", "carousel");
    const sights = getDiscovery(slug, "sights");
    expect(within(carousel).getAllByRole("img")).toHaveLength(sights.length);
    const first = sights[0]!;
    const photo = SIGHT_PHOTOS_BY_RECORD[first.id]!;
    expect(within(carousel).getByText(`Place 1 of ${sights.length}: ${first.title.en}`)).toBeInTheDocument();
    expect(screen.getAllByText(`Photo: ${photo.author}, ${photo.license}`, { exact: false }).length).toBeGreaterThan(0);
  });

  it("gives every sight a German name, description and alt text", async () => {
    const { user } = renderApp(`/${slug}`);
    await user.click(screen.getByRole("button", { name: "Deutsch" }));
    const carousel = screen.getByRole("region", { name: `Sehenswürdigkeiten in ${city.name}` });
    for (const sight of getDiscovery(slug, "sights")) {
      expect(within(carousel).getByRole("img", { name: SIGHT_PHOTOS_BY_RECORD[sight.id]!.alt.de })).toBeInTheDocument();
    }
  });
});
