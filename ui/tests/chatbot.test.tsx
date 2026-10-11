import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { resolveMockReply } from "../src/features/chat/mockAssistantClient";
import { renderApp } from "./renderApp";

async function openChat(path: string) {
  const utils = renderApp(path);
  const launcher = screen.getByRole("button", { name: "Open the welcome assistant" });
  await utils.user.click(launcher);
  const dialog = screen.getByRole("dialog", { name: "Welcome Assistant" });
  return { ...utils, launcher, dialog };
}

describe("chatbot widget", () => {
  it("opens from the floating launcher with a greeting and city context", async () => {
    const { launcher, dialog } = await openChat("/bamberg");
    expect(launcher).toHaveAttribute("aria-expanded", "true");
    expect(within(dialog).getByText(/Context:/)).toHaveTextContent("Context: Bamberg");
    expect(within(dialog).getByText(/Hello! I can help you find first orientation about Bamberg/)).toBeInTheDocument();
    expect(within(dialog).getByText(/not live AI/)).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Your message" })).toHaveFocus();
  });

  it("shows the Bayreuth context on /bayreuth and a general context on /", async () => {
    const bayreuth = await openChat("/bayreuth");
    expect(within(bayreuth.dialog).getByText(/Context:/)).toHaveTextContent("Context: Bayreuth");
    bayreuth.unmount();

    const home = await openChat("/");
    expect(within(home.dialog).getByText(/Context:/)).toHaveTextContent("Upper Franconia (general)");
  });

  it("sends a message with Enter and shows a typing state, then a sample response", async () => {
    const { user, dialog } = await openChat("/bamberg");
    const input = within(dialog).getByRole("textbox", { name: "Your message" });
    await user.type(input, "What regional tradition should I know in Bamberg?{Enter}");

    const log = within(dialog).getByRole("log");
    expect(within(log).getByText("What regional tradition should I know in Bamberg?")).toBeInTheDocument();
    expect(input).toHaveValue("");
    expect(within(log).getByText("The assistant is preparing a response…")).toBeInTheDocument();

    expect(await within(log).findByText(/Rauchbier/)).toBeInTheDocument();
    expect(within(log).getByText("Sample response")).toBeInTheDocument();
    expect(within(log).queryByText("The assistant is preparing a response…")).not.toBeInTheDocument();
  });

  it("sends with the send button and refuses unsupported housing questions", async () => {
    const { user, dialog } = await openChat("/bamberg");
    await user.type(within(dialog).getByRole("textbox", { name: "Your message" }), "Which apartments are available today in Bamberg?");
    await user.click(within(dialog).getByRole("button", { name: "Send message" }));
    expect(await within(dialog).findByText(/Live housing search is outside the scope of this pilot/)).toBeInTheDocument();
  });

  it("answers the Bayreuth example from a suggestion chip", async () => {
    const { user, dialog } = await openChat("/bayreuth");
    await user.click(
      within(dialog).getByRole("button", { name: "Which public cultural activities can international students visit in Bayreuth?" }),
    );
    expect(await within(dialog).findByText(/many cultural offers are open to the public/)).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Your message" })).toHaveFocus();
  });

  it("does not send empty messages", async () => {
    const { user, dialog } = await openChat("/");
    expect(within(dialog).getByRole("button", { name: "Send message" })).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox", { name: "Your message" }), "   {Enter}");
    expect(within(within(dialog).getByRole("log")).getAllByRole("listitem")).toHaveLength(1);
  });

  it("closes with Escape and returns focus to the launcher", async () => {
    const { user, launcher } = await openChat("/bamberg");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Welcome Assistant" })).not.toBeInTheDocument();
    expect(launcher).toHaveAttribute("aria-expanded", "false");
    expect(launcher).toHaveFocus();
  });

  it("closes with the close button and the launcher toggle", async () => {
    const { user, dialog } = await openChat("/bamberg");
    await user.click(within(dialog).getByRole("button", { name: "Close assistant" }));
    expect(screen.queryByRole("dialog", { name: "Welcome Assistant" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open the welcome assistant" }));
    await user.click(screen.getByRole("button", { name: "Close the welcome assistant" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Welcome Assistant" })).not.toBeInTheDocument());
  });

  it("can be opened from the city hero", async () => {
    const { user } = renderApp("/bayreuth");
    await user.click(screen.getByRole("button", { name: "Ask the assistant" }));
    expect(screen.getByRole("dialog", { name: "Welcome Assistant" })).toBeInTheDocument();
  });

  it("uses German copy when German is selected", async () => {
    const { user } = renderApp("/bamberg");
    await user.click(screen.getByRole("button", { name: "Deutsch" }));
    await user.click(screen.getByRole("button", { name: "Willkommensassistent öffnen" }));
    const dialog = screen.getByRole("dialog", { name: "Willkommensassistent" });
    await user.type(within(dialog).getByRole("textbox", { name: "Deine Nachricht" }), "Welche Wohnungen sind heute in Bamberg verfügbar?{Enter}");
    expect(await within(dialog).findByText(/Live-Wohnungssuche liegt außerhalb des Pilotumfangs/)).toBeInTheDocument();
  });
});

describe("mock assistant responses", () => {
  const ask = (message: string, city: "bamberg" | "bayreuth" | null = null, language: "en" | "de" = "en") =>
    resolveMockReply({ message, city, language });

  it("is deterministic", () => {
    expect(ask("What regional tradition should I know in Bamberg?")).toEqual(ask("What regional tradition should I know in Bamberg?"));
  });

  it("answers the supported examples", () => {
    expect(ask("What regional tradition should I know in Bamberg?").kind).toBe("answer");
    expect(ask("Which public cultural activities can international students visit in Bayreuth?").kind).toBe("answer");
    expect(ask("Welche regionale Tradition sollte ich in Bamberg kennen?", null, "de").text).toMatch(/Rauchbier/);
  });

  it("uses the page city when the question does not name one", () => {
    expect(ask("Which traditions matter here?", "bamberg").text).toMatch(/Bamberg/);
  });

  it("refuses housing, visa, legal, medical and job questions", () => {
    expect(ask("Which apartments are available today in Bamberg?")).toMatchObject({ kind: "out-of-scope" });
    expect(ask("Can you help with my visa?")).toMatchObject({ kind: "out-of-scope" });
    expect(ask("Ich suche ein WG-Zimmer", null, "de")).toMatchObject({ kind: "out-of-scope" });
  });

  it("does not mistake words like “current” or “parents” for housing", () => {
    expect(ask("What do my parents need to know about current festivals?").kind).not.toBe("out-of-scope");
  });

  it("falls back for unknown questions and marks every reply as a sample", () => {
    const reply = ask("What is the meaning of life?");
    expect(reply.kind).toBe("fallback");
    expect(reply.isSample).toBe(true);
  });
});
