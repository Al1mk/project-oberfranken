import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppProviders, AppRoutes } from "../src/App";
import { createMockAssistantClient } from "../src/features/chat/mockAssistantClient";

/*
 * Real history (BrowserRouter + window.history), not MemoryRouter. jsdom does not run the browser's
 * "scroll to fragment" step, which in Chrome undoes the focus the app set inside popstate: the heading
 * is focused, then the browser blurs it (observed trace in the vault log). This stand-in models that:
 * after each popstate, the FIRST focus that lands is blurred again. It is a model; the real browser
 * check is recorded in the vault log.
 */
function browserFragmentStep() {
  let armed = false;
  const onPopState = () => {
    armed = true;
  };
  const onFocusIn = (event: FocusEvent) => {
    if (!armed) return;
    armed = false;
    queueMicrotask(() => (event.target as HTMLElement).blur());
  };
  window.addEventListener("popstate", onPopState);
  document.addEventListener("focusin", onFocusIn);
  return () => {
    window.removeEventListener("popstate", onPopState);
    document.removeEventListener("focusin", onFocusIn);
  };
}

function renderAt(path: string) {
  window.history.pushState({}, "", path);
  return {
    user: userEvent.setup(),
    ...render(
      <BrowserRouter>
        <AppProviders assistantClient={createMockAssistantClient({ delayMs: 1 })}>
          <AppRoutes />
        </AppProviders>
      </BrowserRouter>,
    ),
  };
}

const focusedId = () => document.activeElement?.id;
const settled = async (id: string) => {
  await waitFor(() => expect(focusedId()).toBe(id));
  // Give the browser's own later steps a chance to undo it.
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(focusedId()).toBe(id);
};
const back = async () => {
  window.history.back();
  await waitFor(() => expect(window.location.hash).not.toBe(""), { timeout: 500 }).catch(() => undefined);
};

describe.each([
  ["bamberg", "en"],
  ["bamberg", "de"],
  ["bayreuth", "en"],
  ["bayreuth", "de"],
] as const)("browser history focus on %s/%s", (slug, language) => {
  let stopFragmentStep: () => void;
  beforeEach(() => {
    stopFragmentStep = browserFragmentStep();
  });
  afterEach(() => {
    stopFragmentStep();
    window.history.pushState({}, "", "/");
  });

  it("the very first Back, then Forward and repeated cycles, focus the destination heading", async () => {
    const { user } = renderAt(`/${slug}`);
    if (language === "de") await user.click(screen.getByRole("button", { name: "Deutsch" }));
    const nav = screen.getByRole("navigation", { name: language === "de" ? "Auf dieser Seite" : "On this page" });
    await user.click(within(nav).getByRole("link", { name: "Restaurants" }));
    await settled("restaurants-title");
    await user.click(within(nav).getByRole("link", { name: "Sport" }));
    await settled("sports-title");

    for (let cycle = 0; cycle < 3; cycle++) {
      await back();
      await waitFor(() => expect(window.location.hash).toBe("#restaurants"));
      await settled("restaurants-title");
      window.history.forward();
      await waitFor(() => expect(window.location.hash).toBe("#sports"));
      await settled("sports-title");
    }
  });

  it("does not steal focus from where the user moved it after the traversal", async () => {
    const { user } = renderAt(`/${slug}`);
    if (language === "de") await user.click(screen.getByRole("button", { name: "Deutsch" }));
    const nav = screen.getByRole("navigation", { name: language === "de" ? "Auf dieser Seite" : "On this page" });
    await user.click(within(nav).getByRole("link", { name: "Restaurants" }));
    await settled("restaurants-title");
    await user.click(within(nav).getByRole("link", { name: "Sport" }));
    await settled("sports-title");
    await back();
    await settled("restaurants-title");
    const skip = screen.getByRole("link", { name: language === "de" ? "Zum Hauptinhalt springen" : "Skip to main content" });
    skip.focus();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(skip).toHaveFocus();
  });
});
