import { useEffect, useState, type ReactNode } from "react";
import { Route, Routes } from "react-router";
import { AppLayout } from "./components/layout/AppLayout";
import { ChatProvider } from "./features/chat/ChatContext";
import type { AssistantClient } from "./features/chat/assistantClient";
import { createAssistantClientFromEnv } from "./features/chat/createAssistantClient";
import { PrivacyProvider } from "./features/privacy/PrivacyContext";
import { LanguageProvider, useI18n } from "./i18n/LanguageContext";
import { CityPage } from "./pages/CityPage";
import { LandingPage } from "./pages/LandingPage";
import { LegalPage } from "./pages/LegalPage";
import { NotFoundPage } from "./pages/NotFoundPage";

/** Bootstrap: chooses the assistant client once (mock or HTTP, see createAssistantClient). Tests pass their own. */
export function AppProviders({ children, assistantClient }: { children: ReactNode; assistantClient?: AssistantClient }) {
  const [client] = useState(() => assistantClient ?? createAssistantClientFromEnv());
  return (
    <LanguageProvider>
      <PrivacyProvider>
        <ChatProvider client={assistantClient ?? client}>{children}</ChatProvider>
      </PrivacyProvider>
    </LanguageProvider>
  );
}

function HomeRoute() {
  const { t } = useI18n();
  useEffect(() => {
    document.title = `${t.meta.productName} – ${t.meta.productSuffix}`;
  }, [t]);
  return <LandingPage />;
}

/** Only the two pilot cities have routes; all other towns are listed but not routable. */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomeRoute />} />
        <Route path="bamberg" element={<CityPage slug="bamberg" />} />
        <Route path="bayreuth" element={<CityPage slug="bayreuth" />} />
        <Route path="impressum" element={<LegalPage kind="impressum" />} />
        <Route path="datenschutz" element={<LegalPage kind="datenschutz" />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
