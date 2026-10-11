import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getRecords } from "../src/data/sourceRecords";
import { formatDate } from "../src/lib/formatDate";
import { renderApp } from "./renderApp";

const SECTIONS = ["culture-tradition", "activities-participation", "official-newcomer-information"] as const;

describe.each(["bamberg", "bayreuth"] as const)("sourced pilot page: %s", (city) => {
  it.each(["en", "de"] as const)("renders sourced sections with real dates and limited labels in %s", async (language) => {
    const { user } = renderApp(`/${city}`);
    if (language === "de") await user.click(screen.getByRole("button", { name: "Deutsch" }));
    for (const category of SECTIONS) {
      const section = document.getElementById(category)!;
      expect(section).toBeInTheDocument();
      expect(section.querySelectorAll("[data-record-id]")).toHaveLength(3);
      for (const record of getRecords(city, category)) {
        const entry = section.querySelector<HTMLElement>(`[data-record-id="${record.id}"]`)!;
        expect(entry).toBeInTheDocument();
        expect(within(entry).getByRole("heading", { name: record.title[language] })).toBeInTheDocument();
        expect(within(entry).getByText(record.summary[language])).toBeInTheDocument();
        expect(within(entry).getByRole("link", { name: new RegExp(record.sourceName) })).toHaveAttribute("href", record.sourceUrl);
        expect(record.retrievedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
        const date = formatDate(record.retrievedAt!, language);
        expect(within(entry).getByText(language === "en" ? `Retrieved ${date}` : `Abgerufen am ${date}`)).toBeInTheDocument();
        const labels = language === "en"
          ? { verified: "Verified source", limited: "Limited source" }
          : { verified: "Geprüfte Quelle", limited: "Eingeschränkte Quelle" };
        expect(within(entry).getByText(labels[record.status])).toBeInTheDocument();
        expect(within(entry).queryByText(labels[record.status === "verified" ? "limited" : "verified"])).not.toBeInTheDocument();
      }
    }
  });

  it.each(["en", "de"] as const)("labels limited sources in %s", async (language) => {
    const { user } = renderApp(`/${city}`);
    if (language === "de") await user.click(screen.getByRole("button", { name: "Deutsch" }));
    expect(screen.queryAllByText(language === "en" ? "Limited source" : "Eingeschränkte Quelle").length).toBeGreaterThan(0);
  });

  it.each(["en", "de"] as const)("removes city sample labels and the sample-source subsection in %s", async (language) => {
    const { user } = renderApp(`/${city}`);
    if (language === "de") await user.click(screen.getByRole("button", { name: "Deutsch" }));
    expect(screen.queryByRole("list", { name: language === "en" ? "Sources for sample content" : "Quellen der Beispielinhalte" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Sample content:|Beispieldaten:/)).not.toBeInTheDocument();
  });
});
