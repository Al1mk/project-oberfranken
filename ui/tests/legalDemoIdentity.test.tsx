import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LEGAL_CONFIG } from "../src/data/legalConfig";
import { renderApp } from "./renderApp";

const COPY = {
  en: { project: "Project Group 7 – student demonstrator", operator: "Name of the operator", pending: "Not yet finally determined", address: "Postal address", sample: /demo example.*not a confirmed contact address/i },
  de: { project: "Projektgruppe 7 – studentischer Demonstrator", operator: "Name des Betreibers", pending: "Noch nicht abschließend festgelegt", address: "Postanschrift", sample: /demo-beispiel.*keine bestätigte kontaktadresse/i },
};

describe.each(["en", "de"] as const)("demo identity in %s", (lang) => {
  it.each(["/impressum", "/datenschutz"])("%s separates project identity from the unresolved legal operator", async (path) => {
    const { user } = renderApp(path);
    if (lang === "de") await user.click(screen.getByRole("button", { name: "Deutsch" }));
    const main = screen.getByRole("main");
    expect(within(main).getByText(COPY[lang].project)).toBeInTheDocument();
    const operator = within(main).getByText(COPY[lang].operator, { selector: "dt" }).nextElementSibling!;
    expect(operator).toHaveTextContent(COPY[lang].pending);
    expect(operator).not.toHaveTextContent(/group|gruppe\s*7/i);
    const address = within(main).getByText(COPY[lang].address, { selector: "dt" }).nextElementSibling!;
    expect(address).toHaveTextContent(lang === "en" ? "[not set]" : "[nicht festgelegt]");
    expect(within(main).getByRole("note")).toBeInTheDocument();
  });

  it.each(["/impressum", "/datenschutz"])("%s labels example@gmail.com as a demo example, not a working contact", async (path) => {
    const { user } = renderApp(path);
    if (lang === "de") await user.click(screen.getByRole("button", { name: "Deutsch" }));
    const main = screen.getByRole("main");
    const examples = within(main).getAllByText("example@gmail.com", { exact: false });
    expect(examples).toHaveLength(path === "/datenschutz" ? 2 : 1);
    for (const example of examples) {
      expect(example.closest("dd")).toHaveTextContent(COPY[lang].sample);
    }
    expect(main.querySelector('a[href="mailto:example@gmail.com"]')).toBeNull();
  });
});

it("keeps legal operator and privacy-contact facts unset rather than inserting the demo mailbox", () => {
  expect(LEGAL_CONFIG.operator.name).toBeNull();
  expect(LEGAL_CONFIG.operator.address).toBeNull();
  expect(LEGAL_CONFIG.operator.email).toBeNull();
  expect(LEGAL_CONFIG.privacyContact.email).toBeNull();
});
