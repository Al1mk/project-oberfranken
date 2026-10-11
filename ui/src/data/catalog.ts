import catalogJson from "../../../data/v3.2/catalog.json";
import type { LocalizedText } from "../i18n/types";
import type { CitySlug } from "./types";

/*
 * The one adapter between the generated discovery catalog (data/v3.2/catalog.json,
 * produced by the data track from the canonical Markdown KB) and the UI.
 * The catalog is imported as-is and validated once at load: a malformed release
 * fails loudly instead of rendering wrong facts. Nothing here is hand-edited content.
 */

export type DiscoveryCategory = "sports" | "sights" | "restaurants";
export type ParticipationType = "spectator" | "participant" | "both";

export type CatalogSource = {
  name: string;
  url: string;
  /** ISO date (YYYY-MM-DD). */
  retrievedAt: string;
};

type CatalogBase = {
  id: string;
  city: CitySlug;
  topic: string;
  discoveryCategory: DiscoveryCategory;
  /** Position set by the exporter. It is a stable display order, not a quality ranking. */
  order: number;
  verification: "verified";
  title: LocalizedText;
  summary: LocalizedText;
  whyNotable: LocalizedText;
  source: CatalogSource;
};

export type RestaurantRecord = CatalogBase & {
  recordType: "restaurant";
  discoveryCategory: "restaurants";
  details: {
    cuisine: LocalizedText;
    signatureDish: LocalizedText;
    recommendedOrder: LocalizedText;
    whyOrderIt: LocalizedText;
  };
};

export type SportsClubRecord = CatalogBase & {
  recordType: "sports-club";
  discoveryCategory: "sports";
  details: {
    sport: LocalizedText;
    achievement: LocalizedText | null;
    participationType: ParticipationType;
    homeVenue: string;
  };
};

export type SightRecord = CatalogBase & {
  recordType: "sight";
  discoveryCategory: "sights";
  details: {
    whyVisit: LocalizedText;
    keyHighlight: LocalizedText;
    significance: LocalizedText;
  };
};

export type CatalogRecord = RestaurantRecord | SportsClubRecord | SightRecord;

export type Catalog = {
  schemaVersion: 1;
  generatedAt: string;
  kbVersion: string;
  kbDigest: string;
  records: CatalogRecord[];
};

type RecordOf<C extends DiscoveryCategory> = Extract<CatalogRecord, { discoveryCategory: C }>;

/** Anchor ids of the discovery sections on a city page. */
export const DISCOVERY_ANCHORS: Record<DiscoveryCategory, string> = {
  sports: "sports",
  sights: "places-to-see",
  restaurants: "restaurants",
};

export const DISCOVERY_CATEGORIES = ["sports", "sights", "restaurants"] as const satisfies readonly DiscoveryCategory[];

const CITIES: readonly CitySlug[] = ["bamberg", "bayreuth"];
const PARTICIPATION: readonly ParticipationType[] = ["spectator", "participant", "both"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const SHAPE_BY_TYPE = {
  restaurant: { category: "restaurants", fields: ["cuisine", "signatureDish", "recommendedOrder", "whyOrderIt"] },
  "sports-club": { category: "sports", fields: ["sport", "achievement", "participationType", "homeVenue"] },
  sight: { category: "sights", fields: ["whyVisit", "keyHighlight", "significance"] },
} as const;

class CatalogError extends Error {
  constructor(path: string, problem: string) {
    super(`Invalid catalog at ${path}: ${problem}`);
    this.name = "CatalogError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!isObject(value)) throw new CatalogError(path, "expected an object");
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new CatalogError(path, "expected a non-empty string");
  return value;
}

function localized(value: unknown, path: string): LocalizedText {
  const obj = object(value, path);
  return { de: text(obj.de, `${path}.de`), en: text(obj.en, `${path}.en`) };
}

function isoDate(value: unknown, path: string): string {
  const date = text(value, path);
  const parsed = ISO_DATE.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  // Round-trip so that 2026-02-31 is rejected instead of being normalized to 3 March.
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new CatalogError(path, "expected an ISO date (YYYY-MM-DD)");
  return date;
}

function httpsUrl(value: unknown, path: string): string {
  const raw = text(value, path);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new CatalogError(path, "expected an absolute URL");
  }
  if (parsed.protocol !== "https:") throw new CatalogError(path, "expected an https URL");
  return raw;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new CatalogError(path, `expected one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function parseDetails(type: keyof typeof SHAPE_BY_TYPE, value: unknown, path: string): CatalogRecord["details"] {
  const details = object(value, path);
  const required = SHAPE_BY_TYPE[type].fields;
  const unexpected = Object.keys(details).filter((key) => !(required as readonly string[]).includes(key));
  if (unexpected.length > 0) throw new CatalogError(path, `unexpected field ${unexpected.join(", ")}`);
  for (const field of required) if (!(field in details)) throw new CatalogError(`${path}.${field}`, "missing field");

  switch (type) {
    case "restaurant":
      return {
        cuisine: localized(details.cuisine, `${path}.cuisine`),
        signatureDish: localized(details.signatureDish, `${path}.signatureDish`),
        recommendedOrder: localized(details.recommendedOrder, `${path}.recommendedOrder`),
        whyOrderIt: localized(details.whyOrderIt, `${path}.whyOrderIt`),
      };
    case "sports-club":
      return {
        sport: localized(details.sport, `${path}.sport`),
        // `achievement` is genuinely optional in the KB: null means "none documented", never an empty string.
        achievement: details.achievement === null ? null : localized(details.achievement, `${path}.achievement`),
        participationType: oneOf(details.participationType, PARTICIPATION, `${path}.participationType`),
        homeVenue: text(details.homeVenue, `${path}.homeVenue`),
      };
    case "sight":
      return {
        whyVisit: localized(details.whyVisit, `${path}.whyVisit`),
        keyHighlight: localized(details.keyHighlight, `${path}.keyHighlight`),
        significance: localized(details.significance, `${path}.significance`),
      };
  }
}

function parseRecord(value: unknown, index: number): CatalogRecord {
  const path = `records[${index}]`;
  const record = object(value, path);
  const type = oneOf(record.recordType, Object.keys(SHAPE_BY_TYPE) as (keyof typeof SHAPE_BY_TYPE)[], `${path}.recordType`);
  const category = oneOf(record.discoveryCategory, DISCOVERY_CATEGORIES, `${path}.discoveryCategory`);
  if (category !== SHAPE_BY_TYPE[type].category) throw new CatalogError(`${path}.discoveryCategory`, `${type} records belong to ${SHAPE_BY_TYPE[type].category}`);
  if (record.verification !== "verified") throw new CatalogError(`${path}.verification`, "only verified records may enter the catalog");
  if (typeof record.order !== "number" || !Number.isInteger(record.order)) throw new CatalogError(`${path}.order`, "expected an integer");

  const source = object(record.source, `${path}.source`);
  return {
    id: text(record.id, `${path}.id`),
    city: oneOf(record.city, CITIES, `${path}.city`),
    topic: text(record.topic, `${path}.topic`),
    recordType: type,
    discoveryCategory: category,
    order: record.order,
    verification: "verified",
    title: localized(record.title, `${path}.title`),
    summary: localized(record.summary, `${path}.summary`),
    whyNotable: localized(record.whyNotable, `${path}.whyNotable`),
    source: {
      name: text(source.name, `${path}.source.name`),
      url: httpsUrl(source.url, `${path}.source.url`),
      retrievedAt: isoDate(source.retrievedAt, `${path}.source.retrievedAt`),
    },
    details: parseDetails(type, record.details, `${path}.details`),
  } as CatalogRecord;
}

/** Validates an unknown value as a catalog release. Throws on any deviation from the schema. */
export function parseCatalog(value: unknown): Catalog {
  const root = object(value, "catalog");
  if (root.schemaVersion !== 1) throw new CatalogError("schemaVersion", "unsupported schema version");
  if (!Array.isArray(root.records)) throw new CatalogError("records", "expected an array");

  const digest = text(root.kbDigest, "kbDigest");
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new CatalogError("kbDigest", "expected a SHA-256 hex digest");

  const records = root.records.map(parseRecord);
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id)) throw new CatalogError("records", `duplicate id ${record.id}`);
    seen.add(record.id);
  }
  return {
    schemaVersion: 1,
    generatedAt: isoDate(root.generatedAt, "generatedAt"),
    kbVersion: text(root.kbVersion, "kbVersion"),
    kbDigest: digest,
    records,
  };
}

export const CATALOG: Catalog = parseCatalog(catalogJson);

/** Records of one city and category, in the exporter's order. */
export function getDiscovery<C extends DiscoveryCategory>(city: CitySlug, category: C, catalog: Catalog = CATALOG): RecordOf<C>[] {
  return catalog.records
    .filter((record): record is RecordOf<C> => record.city === city && record.discoveryCategory === category)
    .sort((a, b) => a.order - b.order);
}

/** Pilot cities that have at least one verified entry in the category. */
export function getCitiesWithCategory(category: DiscoveryCategory, catalog: Catalog = CATALOG): CitySlug[] {
  return CITIES.filter((city) => getDiscovery(city, category, catalog).length > 0);
}

/** Verified catalog sources of a city, grouped so each URL is listed once. */
export function getCatalogSourceGroups(city: CitySlug, catalog: Catalog = CATALOG) {
  const groups = new Map<string, { source: CatalogSource; records: CatalogRecord[] }>();
  for (const record of catalog.records.filter((r) => r.city === city).sort((a, b) => a.order - b.order)) {
    const group = groups.get(record.source.url);
    if (group) group.records.push(record);
    else groups.set(record.source.url, { source: record.source, records: [record] });
  }
  return [...groups.values()];
}
