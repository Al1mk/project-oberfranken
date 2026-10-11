import pageCatalogJson from "../../../data/v3.2/page-catalog.json";
import type { LocalizedText } from "../i18n/types";
import { isIsoDate } from "../lib/isoDate";
import { CATALOG } from "./catalog";
import type { ContentCategory, SourceRecord } from "./types";

export type PageCatalog = {
  schemaVersion: 1;
  kbVersion: string;
  kbDigest: string;
  records: SourceRecord[];
};

const CATEGORIES: readonly ContentCategory[] = ["culture-tradition", "activities-participation", "official-newcomer-information"];

function invalid(path: string, detail: string): never {
  throw new Error(`Invalid page catalog at ${path}: ${detail}`);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(path, "expected an object");
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") invalid(path, "expected a non-empty string");
  return value as string;
}

function localized(value: unknown, path: string): LocalizedText {
  const pair = object(value, path);
  return { de: text(pair.de, `${path}.de`), en: text(pair.en, `${path}.en`) };
}

/** The sole boundary for the generated page catalog; no fallback to sample facts. */
export function parsePageCatalog(value: unknown): PageCatalog {
  const root = object(value, "catalog");
  if (root.schemaVersion !== 1) invalid("schemaVersion", "unsupported schema version");
  const kbVersion = text(root.kbVersion, "kbVersion");
  const kbDigest = text(root.kbDigest, "kbDigest");
  if (!/^[0-9a-f]{64}$/.test(kbDigest)) invalid("kbDigest", "expected a SHA-256 hex digest");
  if (!Array.isArray(root.records)) invalid("records", "expected an array");
  const seen = new Set<string>();
  const records = root.records.map((value, index): SourceRecord => {
    const path = `records[${index}]`;
    const record = object(value, path);
    const id = text(record.id, `${path}.id`);
    if (seen.has(id)) invalid(`${path}.id`, `duplicate id ${id}`);
    seen.add(id);
    if (record.city !== "bamberg" && record.city !== "bayreuth") invalid(`${path}.city`, "expected a pilot city");
    if (!(CATEGORIES as readonly unknown[]).includes(record.category)) invalid(`${path}.category`, "expected a page content category");
    if (record.status !== "verified" && record.status !== "limited") invalid(`${path}.status`, "expected verified or limited");
    const retrievedAt = text(record.retrievedAt, `${path}.retrievedAt`);
    if (!isIsoDate(retrievedAt)) invalid(`${path}.retrievedAt`, "expected an ISO date (YYYY-MM-DD)");
    const sourceUrl = text(record.sourceUrl, `${path}.sourceUrl`);
    let protocol: string;
    try { protocol = new URL(sourceUrl).protocol; } catch { invalid(`${path}.sourceUrl`, "expected an absolute URL"); }
    if (protocol !== "https:") invalid(`${path}.sourceUrl`, "expected an https URL");
    return {
      id, city: record.city, category: record.category as ContentCategory,
      title: localized(record.title, `${path}.title`), summary: localized(record.summary, `${path}.summary`),
      sourceName: text(record.sourceName, `${path}.sourceName`), sourceUrl, retrievedAt, status: record.status,
    };
  });
  return { schemaVersion: 1, kbVersion, kbDigest, records };
}

export const PAGE_CATALOG = parsePageCatalog(pageCatalogJson);
if (PAGE_CATALOG.kbVersion !== CATALOG.kbVersion || PAGE_CATALOG.kbDigest !== CATALOG.kbDigest) {
  invalid("catalog", "page and discovery catalogs must belong to the same release");
}
