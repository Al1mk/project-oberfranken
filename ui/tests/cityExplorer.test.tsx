import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CITIES, displayCityName } from "../src/data/cities";
import { renderApp } from "./renderApp";

async function openExplorer(path = "/") {
  const utils = renderApp(path);
  const trigger = screen.getByRole("button", { name: "Explore Your Oberfranken" });
  await utils.user.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Towns of Oberfranken" });
  return { ...utils, trigger, dialog };
}

describe("city explorer", () => {
  it("is collapsed until the CTA is clicked", async () => {
    renderApp("/");
    const trigger = screen.getByRole("button", { name: "Explore Your Oberfranken" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog", { name: "Towns of Oberfranken" })).not.toBeInTheDocument();
  });

  it("opens from the CTA, exposes its state and focuses the filter", async () => {
    const { trigger, dialog } = await openExplorer();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", dialog.id);
    expect(within(dialog).getByRole("searchbox", { name: "Filter towns" })).toHaveFocus();
  });

  it("lists every one of the 53 town names", async () => {
    const { dialog } = await openExplorer();
    const list = within(dialog).getByRole("region", { name: "All 53 towns" });
    for (const city of CITIES) {
      const role = city.enabled ? "link" : "button";
      expect(within(list).getByRole(role, { name: new RegExp(`^${displayCityName(city.name).replace(/\./g, "\\.")}\\b`) })).toBeInTheDocument();
    }
    expect(within(list).getAllByRole("link")).toHaveLength(2);
    expect(within(list).getAllByRole("button")).toHaveLength(51);
  });

  it("navigates to /bamberg when Bamberg is selected", async () => {
    const { user, dialog } = await openExplorer();
    const list = within(dialog).getByRole("region", { name: "All 53 towns" });
    await user.click(within(list).getByRole("link", { name: /^Bamberg/ }));
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/bamberg$/);
    expect(screen.getByRole("heading", { level: 1, name: "Bamberg" })).toBeInTheDocument();
  });

  it("navigates to /bayreuth via the featured pilot link", async () => {
    const { user, dialog } = await openExplorer();
    const featured = within(dialog).getByRole("region", { name: "Open in the pilot" });
    await user.click(within(featured).getByRole("link", { name: /^Bayreuth/ }));
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/bayreuth$/);
    expect(screen.getByRole("heading", { level: 1, name: "Bayreuth" })).toBeInTheDocument();
  });

  it("shows “Coming soon” for other towns without navigating", async () => {
    const { user, dialog } = await openExplorer();
    await user.click(within(dialog).getByRole("button", { name: /^Coburg/ }));
    expect(within(dialog).getByRole("status")).toHaveTextContent("Coburg is coming soon.");
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
    expect(screen.getByRole("dialog", { name: "Towns of Oberfranken" })).toBeInTheDocument();
  });

  it("localizes the “Coming soon” message", async () => {
    const { user } = renderApp("/");
    await user.click(screen.getByRole("button", { name: "Deutsch" }));
    await user.click(screen.getByRole("button", { name: "Entdecke dein Oberfranken" }));
    const dialog = screen.getByRole("dialog", { name: "Städte in Oberfranken" });
    await user.click(within(dialog).getByRole("button", { name: /^Hof/ }));
    expect(within(dialog).getByRole("status")).toHaveTextContent("Hof folgt bald.");
  });

  it("closes with Escape and returns focus to the trigger", async () => {
    const { user, trigger } = await openExplorer();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Towns of Oberfranken" })).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("closes when clicking outside", async () => {
    const { user, trigger } = await openExplorer();
    await user.click(screen.getByRole("heading", { level: 1 }));
    expect(screen.queryByRole("dialog", { name: "Towns of Oberfranken" })).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("closes with the close button", async () => {
    const { user, dialog, trigger } = await openExplorer();
    await user.click(within(dialog).getByRole("button", { name: "Close town directory" }));
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("supports arrow-key navigation through the list", async () => {
    const { user, dialog } = await openExplorer();
    await user.keyboard("{ArrowDown}");
    expect(within(dialog).getByRole("button", { name: /^Arzberg/ })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(within(dialog).getByRole("button", { name: /^Bad Berneck/ })).toHaveFocus();
    await user.keyboard("{End}");
    expect(within(dialog).getByRole("button", { name: /^Wunsiedel/ })).toHaveFocus();
    await user.keyboard("{Home}{Enter}");
    expect(within(dialog).getByRole("status")).toHaveTextContent("Arzberg is coming soon.");
  });

  it("keeps a single tab stop inside the town list", async () => {
    const { dialog } = await openExplorer();
    const list = within(dialog).getByRole("region", { name: "All 53 towns" });
    const focusable = [...list.querySelectorAll("a, button")].filter((el) => el.getAttribute("tabindex") === "0");
    expect(focusable).toHaveLength(1);
  });

  it("filters the list and shows an empty state", async () => {
    const { user, dialog } = await openExplorer();
    const input = within(dialog).getByRole("searchbox", { name: "Filter towns" });
    const list = within(dialog).getByRole("region", { name: "All 53 towns" });
    await user.type(input, "schwarz");
    expect(within(list).getAllByRole("button")).toHaveLength(2);
    await user.clear(input);
    await user.type(input, "zzz");
    expect(within(list).getByText("No town matches “zzz”.")).toBeInTheDocument();
  });

  it("can be reopened from a city page", async () => {
    const { user } = renderApp("/bamberg");
    const trigger = screen.getByRole("button", { name: "Explore other towns" });
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Towns of Oberfranken" })).toBeInTheDocument();
  });

  it("arranges the towns in aligned columns that read A to Z downwards", async () => {
    const { dialog } = await openExplorer();
    const list = within(dialog).getByRole("region", { name: "All 53 towns" }).querySelector("ul")!;
    expect(list.style.gridTemplateColumns).toBe("repeat(4, minmax(0, 1fr))");
    expect(list.style.gridTemplateRows).toBe("repeat(14, auto)");
    expect(list.className).toContain("grid-flow-col");
  });

  it("moves between columns with the left and right arrow keys", async () => {
    const { user, dialog } = await openExplorer();
    await user.keyboard("{ArrowDown}{ArrowRight}");
    // Arzberg is first; one column to the right is 14 places further (the 15th town).
    expect(within(dialog).getByRole("button", { name: new RegExp(`^${CITIES[14]!.name.replace(/\./g, "\\.")}`) })).toHaveFocus();
  });
});
