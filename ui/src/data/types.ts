import type { LocalizedText } from "../i18n/types";
import type { Photo } from "./photos";

/** Cities that have a full internal page in the pilot. */
export type CitySlug = "bamberg" | "bayreuth";

export type City = {
  id: string;
  name: string;
  /** Route slug — only set for enabled pilot cities. */
  slug: CitySlug | null;
  enabled: boolean;
};

export type ContentCategory =
  | "culture-tradition"
  | "activities-participation"
  | "official-newcomer-information";

/**
 * A bilingual page projection generated from canonical Markdown.
 * Source-backed records retain limited status until human verification.
 */
export type SourceRecord = {
  id: string;
  city: CitySlug;
  category: ContentCategory;
  title: LocalizedText;
  summary: LocalizedText;
  sourceName: string;
  sourceUrl: string;
  /** ISO date (YYYY-MM-DD) of when the source was retrieved. */
  retrievedAt: string;
  status: "verified" | "limited";
};

export type GeoPoint = {
  lat: number;
  lon: number;
};

export type CityPageData = {
  slug: CitySlug;
  name: string;
  tagline: LocalizedText;
  intro: LocalizedText;
  location: GeoPoint;
  mapZoom: number;
  /** Example question offered in the assistant for this city. */
  assistantExample: LocalizedText;
  photo: Photo;
};
