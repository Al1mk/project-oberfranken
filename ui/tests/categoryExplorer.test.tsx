import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { AppProviders } from "../src/App";
import { AppLayout } from "../src/components/layout/AppLayout";
import { CATALOG, type Catalog } from "../src/data/catalog";
import { createMockAssistantClient } from "../src/features/chat/mockAssistantClient";
import { CategoryExplorer } from "../src/features/explorer/CategoryExplorer";
import { CityPage } from "../src/pages/CityPage";
import { renderApp } from "./renderApp";

async function openCategories(path = "/") {
  const utils = renderApp(path);
  const trigger = screen.getByRole("button", { name: "Categories" });
  await utils.user.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Choose a category" });
  return { ...utils, trigger, dialog };
}

describe("category button", () => {
  it("sits directly below the Explore button in the hero, and the header is unchanged", () => {
    renderApp("/");
    const explore = screen.getByRole("button", { name: "Explore Your Oberfranken" });
    const categories = screen.getByRole("button", { name: "Categories" });
    expect(explore.compareDocumentPosition(categories) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(explore.parentElement).toBe(categories.parentElement);
    const header = screen.getByRole("banner");
    expect(within(header).queryByRole("button", { name: "Categories" })).not.toBeInTheDocument();
  });

  it("is German on the German page", async () => {
    const { user } = renderApp("/");
    await user.click(screen.getByRole("button", { name: "Deutsch" }));
    await user.click(screen.getByRole("button", { name: "Kategorien" }));
    const dialog = screen.getByRole("dialog", { name: "Wähle eine Kategorie" });
    expect(within(dialog).getByRole("button", { name: "Sehenswürdigkeiten" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Sport" })).toBeInTheDocument();
  });

  it("keeps the 53-town directory intact", async () => {
    const { user } = renderApp("/");
    await user.click(screen.getByRole("button", { name: "Explore Your Oberfranken" }));
    expect(screen.getByRole("region", { name: "All 53 towns" })).toBeInTheDocument();
  });
});

describe("step 1: categories", () => {
  it("lists Sport, Places to see and Restaurants and focuses the first", async () => {
    const { dialog } = await openCategories();
    const buttons = within(dialog).getAllByRole("button").filter((button) => button.hasAttribute("data-category"));
    expect(buttons.map((button) => button.textContent)).toEqual(["Sport", "Places to see", "Restaurants"]);
    expect(buttons[0]).toHaveFocus();
  });

  it("moves with arrow keys, Home and End without wrapping", async () => {
    const { user, dialog } = await openCategories();
    const [sport, sights, restaurants] = ["Sport", "Places to see", "Restaurants"].map((name) => within(dialog).getByRole("button", { name }));
    await user.keyboard("{ArrowDown}");
    expect(sights).toHaveFocus();
    await user.keyboard("{End}");
    expect(restaurants).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(restaurants).toHaveFocus();
    await user.keyboard("{Home}");
    expect(sport).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(sport).toHaveFocus();
  });
});

describe("step 2: cities", () => {
  it("shows only the pilot cities and links to the exact section", async () => {
    const { user, dialog } = await openCategories();
    await user.click(within(dialog).getByRole("button", { name: "Restaurants" }));
    expect(screen.getByRole("dialog", { name: "Restaurants: choose a city" })).toBe(dialog);
    const links = within(dialog).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/bamberg#restaurants", "/bayreuth#restaurants"]);
    expect(links[0]).toHaveFocus();
    expect(within(dialog).getByRole("button", { name: "Back to categories" })).toHaveTextContent("Back");
  });

  it("moves with arrow keys, Home and End", async () => {
    const { user, dialog } = await openCategories();
    await user.click(within(dialog).getByRole("button", { name: "Places to see" }));
    const [bamberg, bayreuth] = within(dialog).getAllByRole("link");
    await user.keyboard("{ArrowDown}");
    expect(bayreuth).toHaveFocus();
    await user.keyboard("{Home}");
    expect(bamberg).toHaveFocus();
    await user.keyboard("{End}");
    expect(bayreuth).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(bamberg).toHaveFocus();
  });

  it("Back returns to the categories and restores focus to the one chosen", async () => {
    const { user, dialog } = await openCategories();
    await user.click(within(dialog).getByRole("button", { name: "Places to see" }));
    await user.click(within(dialog).getByRole("button", { name: "Back to categories" }));
    expect(screen.getByRole("dialog", { name: "Choose a category" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Places to see" })).toHaveFocus();
  });

  it.each([
    ["Sport", "Bamberg", "/bamberg#sports", "sports-title"],
    ["Sport", "Bayreuth", "/bayreuth#sports", "sports-title"],
    ["Places to see", "Bamberg", "/bamberg#places-to-see", "places-to-see-title"],
    ["Places to see", "Bayreuth", "/bayreuth#places-to-see", "places-to-see-title"],
    ["Restaurants", "Bamberg", "/bamberg#restaurants", "restaurants-title"],
    ["Restaurants", "Bayreuth", "/bayreuth#restaurants", "restaurants-title"],
  ])("%s in %s opens %s and focuses the section heading", async (category, city, destination, headingId) => {
    const { user, dialog } = await openCategories();
    await user.click(within(dialog).getByRole("button", { name: category }));
    await user.click(within(dialog).getByRole("link", { name: new RegExp(`^${city}`) }));
    expect(screen.getByTestId("location")).toHaveTextContent(destination);
    expect(screen.queryByRole("dialog", { name: /choose/i })).not.toBeInTheDocument();
    await waitFor(() => expect(document.getElementById(headingId)).toHaveFocus());
    expect(document.getElementById(headingId)).toBeInTheDocument();
  });
});

describe("closing", () => {
  it("closes with Escape and returns focus to the trigger", async () => {
    const { user, trigger } = await openCategories();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Choose a category" })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on an outside click", async () => {
    const { user, trigger } = await openCategories();
    await user.click(document.body);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose a category" })).not.toBeInTheDocument());
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("starts at step 1 again after closing from step 2", async () => {
    const { user, trigger, dialog } = await openCategories();
    await user.click(within(dialog).getByRole("button", { name: "Sport" }));
    await user.keyboard("{Escape}");
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Choose a category" })).toBeInTheDocument();
  });
});

describe("availability is derived from the catalog", () => {
  const without = (keep: (record: Catalog["records"][number]) => boolean): Catalog => ({ ...CATALOG, records: CATALOG.records.filter(keep) });

  function renderWith(catalog: Catalog) {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AppProviders assistantClient={createMockAssistantClient({ delayMs: 1 })}>
          <CategoryExplorer label="Categories" catalog={catalog} />
        </AppProviders>
      </MemoryRouter>,
    );
    return user;
  }

  it("lists only cities that have verified entries in the category", async () => {
    const user = renderWith(without((r) => !(r.city === "bayreuth" && r.discoveryCategory === "restaurants")));
    await user.click(screen.getByRole("button", { name: "Categories" }));
    await user.click(screen.getByRole("button", { name: "Restaurants" }));
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/bamberg#restaurants");
  });

  it("says so when a category has no verified entries", async () => {
    const user = renderWith(without((r) => r.discoveryCategory !== "sports"));
    await user.click(screen.getByRole("button", { name: "Categories" }));
    await user.click(screen.getByRole("button", { name: "Sport" }));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("No verified entries in this category yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to categories" })).toBeInTheDocument();
  });
});

describe("same-page hash navigation", () => {
  it("scrolls to and focuses the heading when already on the city page", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/bamberg"]}>
        <AppProviders assistantClient={createMockAssistantClient({ delayMs: 1 })}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route
                path="bamberg"
                element={
                  <>
                    <CategoryExplorer label="Categories" />
                    <CityPage slug="bamberg" />
                  </>
                }
              />
            </Route>
          </Routes>
        </AppProviders>
      </MemoryRouter>,
    );

    for (const [category, headingId] of [["Restaurants", "restaurants-title"], ["Sport", "sports-title"], ["Restaurants", "restaurants-title"]] as const) {
      await user.click(screen.getByRole("button", { name: "Categories" }));
      const dialog = screen.getByRole("dialog", { name: "Choose a category" });
      await user.click(within(dialog).getByRole("button", { name: category }));
      await user.click(within(dialog).getByRole("link", { name: /^Bamberg/ }));
      await waitFor(() => expect(document.getElementById(headingId)).toHaveFocus());
      expect(document.getElementById(headingId!.replace("-title", ""))!.scrollIntoView).toHaveBeenCalled();
    }
  });
});
