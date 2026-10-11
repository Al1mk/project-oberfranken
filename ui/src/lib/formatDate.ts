import type { Language } from "../i18n/types";

const LOCALES: Record<Language, string> = { en: "en-GB", de: "de-DE" };

/** Formats an ISO date (YYYY-MM-DD) for display. */
export function formatDate(isoDate: string, language: Language): string {
  return new Intl.DateTimeFormat(LOCALES[language], { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${isoDate}T00:00:00Z`));
}

export function hostnameOf(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}
