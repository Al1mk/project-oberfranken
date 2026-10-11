import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "./renderApp";

describe("routes", () => {
  it("renders the landing page at /", () => {
    renderApp("/");
    expect(screen.getByRole("heading", { level: 1, name: /Mein Oberfranken/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Explore Your Oberfranken" })).toBeInTheDocument();
    expect(screen.getByText(/pilot focuses on Bamberg and Bayreuth/)).toBeInTheDocument();
  });

  it("renders Bamberg at /bamberg", () => {
    renderApp("/bamberg");
    expect(screen.getByRole("heading", { level: 1, name: "Bamberg" })).toBeInTheDocument();
  });

  it("renders Bayreuth at /bayreuth", () => {
    renderApp("/bayreuth");
    expect(screen.getByRole("heading", { level: 1, name: "Bayreuth" })).toBeInTheDocument();
  });

  it("has no route for non-pilot towns", () => {
    renderApp("/coburg");
    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
  });

  it("shows the same global header on every route", () => {
    for (const path of ["/", "/bamberg", "/bayreuth"]) {
      const { unmount } = renderApp(path);
      const nav = screen.getByRole("navigation", { name: "Main navigation" });
      expect(nav).toHaveTextContent("Home");
      expect(nav).toHaveTextContent("Explore");
      expect(nav).toHaveTextContent("About");
      expect(screen.getByRole("group", { name: "Language" })).toBeInTheDocument();
      unmount();
    }
  });
});

describe("brand logo", () => {
  it("shows the Oberfranken logo in the header and footer", () => {
    const { container } = renderApp("/");
    const header = container.querySelector("header")!;
    const footer = container.querySelector("footer")!;
    expect(header.querySelector('img[src="/logo.svg"]')).toBeInTheDocument();
    expect(footer.querySelector('img[src="/logo.svg"]')).toBeInTheDocument();
  });
});
