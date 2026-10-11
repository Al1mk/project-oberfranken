export const LANGUAGES = ["en", "de"] as const;

export type Language = (typeof LANGUAGES)[number];

export type LocalizedText = {
  en: string;
  de: string;
};
