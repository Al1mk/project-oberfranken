import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { AppProviders, AppRoutes } from "../src/App";
import type { AssistantClient } from "../src/features/chat/assistantClient";
import { createMockAssistantClient } from "../src/features/chat/mockAssistantClient";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.hash}</output>;
}

export function renderApp(path = "/", { assistantClient }: { assistantClient?: AssistantClient } = {}) {
  const user = userEvent.setup();
  const utils = render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders assistantClient={assistantClient ?? createMockAssistantClient({ delayMs: 20 })}>
        <AppRoutes />
        <LocationProbe />
      </AppProviders>
    </MemoryRouter>,
  );
  return { user, ...utils };
}
