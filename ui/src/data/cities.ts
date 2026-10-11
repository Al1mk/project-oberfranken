import type { City, CitySlug } from "./types";

/** The 53 officially designated towns (Städte) in Oberfranken, alphabetized. */
const CITY_NAMES = [
  "Arzberg",
  "Bad Berneck i.Fichtelgebirge",
  "Bad Rodach",
  "Bad Staffelstein",
  "Bamberg",
  "Baunach",
  "Bayreuth",
  "Betzenstein",
  "Burgkunstadt",
  "Coburg",
  "Creußen",
  "Ebermannstadt",
  "Forchheim",
  "Gefrees",
  "Goldkronach",
  "Gräfenberg",
  "Hallstadt",
  "Helmbrechts",
  "Hof",
  "Hohenberg a.d.Eger",
  "Hollfeld",
  "Kirchenlamitz",
  "Kronach",
  "Kulmbach",
  "Kupferberg",
  "Lichtenberg",
  "Lichtenfels",
  "Ludwigsstadt",
  "Marktleuthen",
  "Marktredwitz",
  "Münchberg",
  "Naila",
  "Neustadt b.Coburg",
  "Pegnitz",
  "Pottenstein",
  "Rehau",
  "Rödental",
  "Schauenstein",
  "Scheßlitz",
  "Schlüsselfeld",
  "Schönwald",
  "Schwarzenbach a.d.Saale",
  "Schwarzenbach a.Wald",
  "Selb",
  "Selbitz",
  "Seßlach",
  "Stadtsteinach",
  "Teuschnitz",
  "Waischenfeld",
  "Wallenfels",
  "Weismain",
  "Weißenstadt",
  "Wunsiedel",
] as const;

const ENABLED_SLUGS: Record<string, CitySlug> = {
  Bamberg: "bamberg",
  Bayreuth: "bayreuth",
};

/** Lowercase, transliterate German characters and strip punctuation. */
export function normalizeForSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function toId(name: string): string {
  return normalizeForSearch(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const CITIES: readonly City[] = CITY_NAMES.map((name) => {
  const slug = ENABLED_SLUGS[name] ?? null;
  return { id: toId(name), name, slug, enabled: slug !== null };
});

export const ENABLED_CITIES: readonly City[] = CITIES.filter((city) => city.enabled);

/** "Schwarzenbach a.d.Saale" reads better as "Schwarzenbach a.d. Saale". Search still uses the official name. */
export function displayCityName(name: string): string {
  return name.replace(/\.(?=[A-ZÄÖÜ])/g, ". ");
}

/** Matches either the umlaut spelling or its ae/oe/ue transliteration. */
export function cityMatchesQuery(city: City, query: string): boolean {
  const q = normalizeForSearch(query.trim());
  if (q === "") return true;
  const name = normalizeForSearch(city.name);
  const loose = (s: string) => s.replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u");
  return name.includes(q) || loose(name).includes(loose(q));
}
