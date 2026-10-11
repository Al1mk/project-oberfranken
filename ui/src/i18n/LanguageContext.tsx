import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { TRANSLATIONS, type Messages } from "./translations";
import { LANGUAGES, type Language, type LocalizedText } from "./types";

export const LANGUAGE_STORAGE_KEY = "mein-oberfranken:language:v1";
const DEFAULT_LANGUAGE: Language = "en";

function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

function readStoredLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(stored) ? stored : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Messages;
  /** Picks the current language from a localized content field. */
  localize: (text: LocalizedText) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(readStoredLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      // Storage may be unavailable (private mode); the choice still applies for this session.
    }
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      t: TRANSLATIONS[language],
      localize: (text) => text[language],
    }),
    [language, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useI18n must be used inside <LanguageProvider>");
  return context;
}
