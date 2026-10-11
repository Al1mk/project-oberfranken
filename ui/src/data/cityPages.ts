import { PHOTOS } from "./photos";
import type { CityPageData, CitySlug } from "./types";

export const CITY_PAGES: Record<CitySlug, CityPageData> = {
  bamberg: {
    slug: "bamberg",
    name: "Bamberg",
    tagline: {
      en: "River, rooftops and a living old town",
      de: "Fluss, Dächer und eine lebendige Altstadt",
    },
    intro: {
      en: "A first orientation for international students and newcomers: local culture, ways to take part, and where to find official information when you arrive in Bamberg.",
      de: "Eine erste Orientierung für internationale Studierende und Neuankommende: lokale Kultur, Möglichkeiten zum Mitmachen und wo du offizielle Informationen findest, wenn du in Bamberg ankommst.",
    },
    location: { lat: 49.8917, lon: 10.8858 },
    mapZoom: 14,
    assistantExample: {
      en: "What regional tradition should I know in Bamberg?",
      de: "Welche regionale Tradition sollte ich in Bamberg kennen?",
    },
    photo: PHOTOS.bamberg,
  },
  bayreuth: {
    slug: "bayreuth",
    name: "Bayreuth",
    tagline: {
      en: "Music, gardens and a university town",
      de: "Musik, Gärten und eine Universitätsstadt",
    },
    intro: {
      en: "A first orientation for international students and newcomers: local culture, ways to take part, and where to find official information when you arrive in Bayreuth.",
      de: "Eine erste Orientierung für internationale Studierende und Neuankommende: lokale Kultur, Möglichkeiten zum Mitmachen und wo du offizielle Informationen findest, wenn du in Bayreuth ankommst.",
    },
    location: { lat: 49.9456, lon: 11.5713 },
    mapZoom: 14,
    assistantExample: {
      en: "Which public cultural activities can international students visit in Bayreuth?",
      de: "Welche öffentlichen Kulturangebote können internationale Studierende in Bayreuth besuchen?",
    },
    photo: PHOTOS.bayreuth,
  },
};

export function getCityPage(slug: string): CityPageData | undefined {
  return Object.hasOwn(CITY_PAGES, slug) ? CITY_PAGES[slug as CitySlug] : undefined;
}
