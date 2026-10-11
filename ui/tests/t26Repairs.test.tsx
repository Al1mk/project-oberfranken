import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { CityPage } from "../src/pages/CityPage";
import { describe, expect, it, vi } from "vitest";
import { AppProviders } from "../src/App";
import { AppLayout } from "../src/components/layout/AppLayout";
import { CATALOG, getDiscovery, type Catalog } from "../src/data/catalog";
import type { AssistantClient, AssistantReply, AssistantRequest } from "../src/features/chat/assistantClient";
import { AssistantError } from "../src/features/chat/assistantContract";
import { selectAssistantClient } from "../src/features/chat/createAssistantClient";
import { createMockAssistantClient } from "../src/features/chat/mockAssistantClient";
import { CategoryExplorer } from "../src/features/explorer/CategoryExplorer";
import { renderApp } from "./renderApp";

const tabStops = (root: HTMLElement) => within(root).queryAllByRole("button").concat(within(root).queryAllByRole("link")).filter((el) => el.hasAttribute("data-roving") && el.tabIndex === 0);

async function openCategories(path = "/") {
  const utils = renderApp(path);
  const trigger = screen.getByRole("button", { name: "Categories" });
  await utils.user.click(trigger);
  return { ...utils, trigger, dialog: screen.getByRole("dialog", { name: "Choose a category" }) };
}

describe("F1: one tab stop per list (roving tabindex)", () => {
  it("step 1 has exactly one tab stop, and it follows arrow keys, Home and End", async () => {
    const { user, dialog } = await openCategories();
    expect(tabStops(dialog)).toHaveLength(1);
    expect(tabStops(dialog)[0]).toHaveTextContent("Sport");
    await user.keyboard("{ArrowDown}");
    expect(tabStops(dialog)).toHaveLength(1);
    expect(tabStops(dialog)[0]).toHaveTextContent("Places to see");
    await user.keyboard("{End}");
    expect(tabStops(dialog)[0]).toHaveTextContent("Restaurants");
    await user.keyboard("{Home}");
    expect(tabStops(dialog)[0]).toHaveTextContent("Sport");
  });

  it("step 2 has exactly one tab stop and keeps it through arrow keys", async () => {
    const { user, dialog } = await openCategories();
    await user.click(within(dialog).getByRole("button", { name: "Restaurants" }));
    expect(tabStops(dialog)).toHaveLength(1);
    expect(tabStops(dialog)[0]).toHaveTextContent(/^Bamberg/);
    await user.keyboard("{ArrowDown}");
    expect(tabStops(dialog)).toHaveLength(1);
    expect(tabStops(dialog)[0]).toHaveTextContent(/^Bayreuth/);
  });

  it("Tab leaves the list and Shift+Tab returns to the one tab stop", async () => {
    const { user, dialog } = await openCategories();
    await user.keyboard("{ArrowDown}");
    await user.tab();
    expect(dialog.contains(document.activeElement) && document.activeElement?.hasAttribute("data-roving")).toBeFalsy();
    await user.tab({ shift: true });
    expect(document.activeElement).toHaveTextContent("Places to see");
  });

  it("Back restores focus and the tab stop to the chosen category", async () => {
    const { user, dialog } = await openCategories();
    await user.keyboard("{End}");
    await user.keyboard("{Enter}");
    await user.click(within(dialog).getByRole("button", { name: "Back to categories" }));
    expect(within(dialog).getByRole("button", { name: "Restaurants" })).toHaveFocus();
    expect(tabStops(dialog)).toHaveLength(1);
    expect(tabStops(dialog)[0]).toHaveTextContent("Restaurants");
  });
});

describe("F2: dismissal restores focus to the trigger", () => {
  it("outside click closes and returns focus to Categories", async () => {
    const { user, trigger } = await openCategories();
    await user.click(screen.getByRole("heading", { level: 1 }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose a category" })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("the close button returns focus to the trigger", async () => {
    const { user, trigger, dialog } = await openCategories();
    await user.click(within(dialog).getByRole("button", { name: "Close category menu" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("Escape still returns focus to the trigger", async () => {
    const { user, trigger } = await openCategories();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("choosing a city focuses the destination heading, not the trigger", async () => {
    const { user, trigger, dialog } = await openCategories();
    await user.click(within(dialog).getByRole("button", { name: "Sport" }));
    await user.click(within(dialog).getByRole("link", { name: /^Bamberg/ }));
    await waitFor(() => expect(document.getElementById("sports-title")).toHaveFocus());
    expect(trigger).not.toHaveFocus();
  });
});

describe("empty category", () => {
  const noSports: Catalog = { ...CATALOG, records: CATALOG.records.filter((r) => r.discoveryCategory !== "sports") };

  it("announces the empty result and moves focus to Back", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AppProviders assistantClient={createMockAssistantClient({ delayMs: 1 })}>
          <CategoryExplorer label="Categories" catalog={noSports} />
        </AppProviders>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Categories" }));
    await user.click(screen.getByRole("button", { name: "Sport" }));
    expect(screen.getByRole("status")).toHaveTextContent("No verified entries in this category yet.");
    expect(screen.getByRole("button", { name: "Back to categories" })).toHaveFocus();
  });
});

describe("F3: in-page links of the city hero", () => {
  const sectionLinks = [
    ["Restaurants", "#restaurants", "restaurants-title"],
    ["Sport", "#sports", "sports-title"],
    ["Places to see", "#places-to-see", "places-to-see-title"],
  ] as const;

  it.each(sectionLinks)("clicking the %s link scrolls to and focuses its heading", async (name, href, headingId) => {
    const { user } = renderApp("/bamberg");
    const nav = screen.getByRole("navigation", { name: "On this page" });
    await user.click(within(nav).getByRole("link", { name }));
    expect(screen.getByTestId("location")).toHaveTextContent(`/bamberg${href}`);
    await waitFor(() => expect(document.getElementById(headingId)).toHaveFocus());
    expect(document.getElementById(href.slice(1))!.scrollIntoView).toHaveBeenCalled();
  });

  it("works in German too", async () => {
    const { user } = renderApp("/bayreuth");
    await user.click(screen.getByRole("button", { name: "Deutsch" }));
    await user.click(within(screen.getByRole("navigation", { name: "Auf dieser Seite" })).getByRole("link", { name: "Sport" }));
    await waitFor(() => expect(document.getElementById("sports-title")).toHaveFocus());
  });

  it("clicking the same link twice focuses the heading again", async () => {
    const { user } = renderApp("/bamberg");
    const link = within(screen.getByRole("navigation", { name: "On this page" })).getByRole("link", { name: "Restaurants" });
    await user.click(link);
    await waitFor(() => expect(document.getElementById("restaurants-title")).toHaveFocus());
    (document.activeElement as HTMLElement).blur();
    await user.click(link);
    await waitFor(() => expect(document.getElementById("restaurants-title")).toHaveFocus());
  });

  it("a direct hash on load focuses the heading", async () => {
    renderApp("/bayreuth#restaurants");
    await waitFor(() => expect(document.getElementById("restaurants-title")).toHaveFocus());
  });

  it("history Back and Forward re-focus the heading of the hash they land on", async () => {
    const user = userEvent.setup();
    function HistoryButtons() {
      const navigate = useNavigate();
      return (
        <>
          <button onClick={() => void navigate(-1)}>history back</button>
          <button onClick={() => void navigate(1)}>history forward</button>
        </>
      );
    }
    render(
      <MemoryRouter initialEntries={["/bamberg"]}>
        <AppProviders assistantClient={createMockAssistantClient({ delayMs: 1 })}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="bamberg" element={<CityPage slug="bamberg" />} />
            </Route>
          </Routes>
          <HistoryButtons />
        </AppProviders>
      </MemoryRouter>,
    );
    const nav = screen.getByRole("navigation", { name: "On this page" });
    await user.click(within(nav).getByRole("link", { name: "Restaurants" }));
    await waitFor(() => expect(document.getElementById("restaurants-title")).toHaveFocus());
    await user.click(within(nav).getByRole("link", { name: "Sport" }));
    await waitFor(() => expect(document.getElementById("sports-title")).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "history back" }));
    await waitFor(() => expect(document.getElementById("restaurants-title")).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "history forward" }));
    await waitFor(() => expect(document.getElementById("sports-title")).toHaveFocus());
  });
});

describe("F4: retry sends the failed request unchanged", () => {
  const reply: AssistantReply = { text: "Here you go.", kind: "fallback", isSample: false, sources: [] };

  function scripted(outcomes: (AssistantReply | Error)[]) {
    const send = vi.fn(async (request: AssistantRequest) => {
      void request;
      const next = outcomes.shift()!;
      if (next instanceof Error) throw next;
      return next;
    });
    return { client: { mode: "http", send } satisfies AssistantClient, send };
  }

  it("keeps the original language and city after the user switches both before retrying", async () => {
    const { client, send } = scripted([new AssistantError("http", "HTTP 500", 500), reply, reply]);
    const { user } = renderApp("/bamberg", { assistantClient: client });
    await user.click(screen.getByRole("button", { name: "Open the welcome assistant" }));
    const dialog = screen.getByRole("dialog", { name: "Welcome Assistant" });
    await user.type(within(dialog).getByRole("textbox", { name: "Your message" }), "Where to eat?{Enter}");
    await screen.findByRole("alert");

    // Switch the language, then really change city through the page's own town directory.
    await user.click(screen.getByRole("button", { name: "Deutsch" }));
    await user.click(screen.getByRole("button", { name: "Weitere Städte entdecken" }));
    const towns = screen.getByRole("dialog", { name: "Städte in Oberfranken" });
    await user.click(within(within(towns).getByRole("region", { name: "Im Pilot geöffnet" })).getByRole("link", { name: /^Bayreuth/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("/bayreuth");
    expect(within(dialog).getByText(/Kontext:/)).toHaveTextContent("Bayreuth");

    await user.click(within(dialog).getByRole("button", { name: "Erneut versuchen" }));
    await screen.findByText("Here you go.");
    expect(send.mock.calls[1]![0]).toEqual({ message: "Where to eat?", city: "bamberg", language: "en" });
    expect(within(dialog).getAllByText("Where to eat?")).toHaveLength(1);

    // A new message uses the current context again.
    await user.type(within(dialog).getByRole("textbox", { name: "Deine Nachricht" }), "Noch eine{Enter}");
    await waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    expect(send.mock.calls[2]![0]).toEqual({ message: "Noch eine", city: "bayreuth", language: "de" });
  });

  it("clears the retry request after a success", async () => {
    const { client } = scripted([new AssistantError("network", "x"), reply]);
    const { user } = renderApp("/bamberg", { assistantClient: client });
    await user.click(screen.getByRole("button", { name: "Open the welcome assistant" }));
    const dialog = screen.getByRole("dialog", { name: "Welcome Assistant" });
    await user.type(within(dialog).getByRole("textbox", { name: "Your message" }), "hi{Enter}");
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    await screen.findByText("Here you go.");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});

describe("F5: sights show whyNotable", () => {
  it.each(["bamberg", "bayreuth"] as const)("shows the localized whyNotable of the active sight on %s, with source", async (slug) => {
    for (const code of ["en", "de"] as const) {
      const { user, unmount } = renderApp(`/${slug}`);
      if (code === "de") await user.click(screen.getByRole("button", { name: "Deutsch" }));
      const section = screen.getByRole("region", { name: code === "en" ? "Places to see" : "Sehenswürdigkeiten" });
      const [first] = getDiscovery(slug, "sights");
      const article = within(section).getByRole("article");
      expect(article).toHaveAttribute("data-record-id", first!.id);
      expect(within(article).getByText(code === "en" ? "Why it is notable" : "Was den Ort besonders macht")).toBeInTheDocument();
      expect(within(article).getByText(first!.whyNotable[code])).toBeInTheDocument();
      expect(within(article).getByRole("link", { name: new RegExp(first!.source.name) })).toHaveAttribute("href", first!.source.url);
      unmount();
    }
  });
});

describe("chat endpoint is fixed by contract", () => {
  it("the HTTP client always posts to /api/chat; there is no endpoint override", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const client = selectAssistantClient({ mode: "http", production: true, endpoint: "https://evil.example/chat" } as never);
      await client.send({ message: "x", city: null, language: "en" }).catch(() => undefined);
      expect(fetchSpy.mock.calls[0]![0]).toBe("/api/chat");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("copy matches the real mix of verified and source-backed content", () => {
  it("landing page and footer no longer claim everything is sample data", () => {
    renderApp("/");
    const page = document.body.textContent ?? "";
    expect(page).not.toMatch(/Everything you see is sample content/);
    expect(page).not.toMatch(/All content is sample data/);
    expect(page).toMatch(/verified project catalog/i);
  });

  it("German landing page and footer match too", async () => {
    const { user } = renderApp("/");
    await user.click(screen.getByRole("button", { name: "Deutsch" }));
    const page = document.body.textContent ?? "";
    expect(page).not.toMatch(/Alle Inhalte sind Beispieldaten/);
    expect(page).not.toMatch(/Alle Inhalte sind Beispieldaten zum Testen/);
    expect(page).toMatch(/geprüft/i);
  });

  it("the sights intro is neutral and does not use handwritten city facts", () => {
    renderApp("/bayreuth");
    const section = screen.getByRole("region", { name: "Places to see" });
    expect(within(section).queryByText(/Richard Wagner Festival\. It also has/)).not.toBeInTheDocument();
    expect(within(section).getByText("Verified places to see in Bayreuth. Browse the photos or use the arrows.")).toBeInTheDocument();
  });
});

describe("Sources headings", () => {
  it.each([
    ["bamberg", "en", "Sources for Bamberg", "Sources for sights, restaurants and sport", "Sources for culture, activities and newcomer information"],
    ["bayreuth", "en", "Sources for Bayreuth", "Sources for sights, restaurants and sport", "Sources for culture, activities and newcomer information"],
    ["bamberg", "de", "Quellen zu Bamberg", "Quellen zu Sehenswürdigkeiten, Restaurants und Sport", "Quellen zu Kultur, Aktivitäten und Informationen für Neuankommende"],
    ["bayreuth", "de", "Quellen zu Bayreuth", "Quellen zu Sehenswürdigkeiten, Restaurants und Sport", "Quellen zu Kultur, Aktivitäten und Informationen für Neuankommende"],
  ] as const)("%s/%s", async (slug, code, main, verified, page) => {
    const { user } = renderApp(`/${slug}`);
    if (code === "de") await user.click(screen.getByRole("button", { name: "Deutsch" }));
    const section = screen.getByRole("region", { name: main });
    expect(within(section).getByRole("heading", { level: 2, name: main })).toBeInTheDocument();
    expect(within(section).getByRole("heading", { level: 3, name: verified })).toBeInTheDocument();
    expect(within(section).getByRole("heading", { level: 3, name: page })).toBeInTheDocument();
    expect(within(section).getByRole("list", { name: verified })).toBeInTheDocument();
    expect(within(section).getByRole("list", { name: page })).toBeInTheDocument();
    expect(within(section).getAllByText(code === "en" ? "Limited source" : "Eingeschränkte Quelle").length).toBeGreaterThan(0);
  });

  it("keeps the short link label in the in-page navigation", () => {
    renderApp("/bamberg");
    expect(within(screen.getByRole("navigation", { name: "On this page" })).getByRole("link", { name: "Sources" })).toHaveAttribute("href", "/bamberg#sources");
  });
});
