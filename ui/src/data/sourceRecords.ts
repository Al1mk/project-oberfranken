import { PAGE_CATALOG } from "./pageCatalog";
import type { CitySlug, ContentCategory, SourceRecord } from "./types";

export const SOURCE_RECORDS: readonly SourceRecord[] = PAGE_CATALOG.records;

export function getRecords(city: CitySlug, category?: ContentCategory): SourceRecord[] {
  return SOURCE_RECORDS.filter((record) => record.city === city && (category === undefined || record.category === category));
}

export type SourceGroup = {
  sourceName: string;
  sourceUrl: string;
  retrievedAt: string;
  status: SourceRecord["status"];
  records: SourceRecord[];
};

/** Keep retrieval dates and verification levels distinct even when a URL is shared. */
export function getSourceGroups(city: CitySlug): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const record of getRecords(city)) {
    const key = JSON.stringify([record.sourceUrl, record.sourceName, record.retrievedAt, record.status]);
    const group = groups.get(key);
    if (group) group.records.push(record);
    else groups.set(key, {
      sourceName: record.sourceName, sourceUrl: record.sourceUrl, retrievedAt: record.retrievedAt,
      status: record.status, records: [record],
    });
  }
  return [...groups.values()];
}
