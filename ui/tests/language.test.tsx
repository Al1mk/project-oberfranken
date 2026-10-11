import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LANGUAGE_STORAGE_KEY } from "../src/i18n/LanguageContext";
import { renderApp } from "./renderApp";

describe("language switching", () => {
  it("displays English by default", () => {
    renderApp("/");
    expect(screen.getByRole("button", { name: "Explore Your Oberfranken" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.lang).toBe("en");
  });

  it("switches visible interface copy to German without changing the URL", async () => {
    const { user } = renderApp("/bamberg");
    await user.click(screen.getByRole("button", { name: "Deutsch" }));

    expect(screen.getByRole("button", { name: "Deutsch" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("navigation", { name: "Hauptnavigation" })).toHaveTextContent("Start");
    expect(screen.getByRole("heading", { level: 2, name: "Kultur & Tradition" })).toBeInTheDocument();
    expect(screen.getByText("Fluss, Dächer und eine lebendige Altstadt", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Willkommensassistent öffnen" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("de");
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/bamberg$/);
  });

  it("shows the German CTA on the landing page", async () => {
    const { user } = renderApp("/");
    await user.click(screen.getByRole("button", { name: "Deutsch" }));
    expect(screen.getByRole("button", { name: "Entdecke dein Oberfranken" })).toBeInTheDocument();
  });

  it("persists the selection and restores it after a reload", async () => {
    const first = renderApp("/");
    await first.user.click(screen.getByRole("button", { name: "Deutsch" }));
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("de");
    first.unmount();

    renderApp("/");
    expect(screen.getByRole("button", { name: "Entdecke dein Oberfranken" })).toBeInTheDocument();
  });

  it("ignores an invalid stored value", () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "fr");
    renderApp("/");
    expect(screen.getByRole("button", { name: "Explore Your Oberfranken" })).toBeInTheDocument();
  });
});
