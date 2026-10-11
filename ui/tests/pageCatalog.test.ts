import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import rawPageCatalog from "../../data/v3.2/page-catalog.json";
import manifest from "../../data/v3.2/manifest.json";
import { CATALOG } from "../src/data/catalog";
import { PAGE_CATALOG, parsePageCatalog } from "../src/data/pageCatalog";
import { getRecords, getSourceGroups } from "../src/data/sourceRecords";

describe("generated page catalog", () => {
  it("is the page artifact pinned by the data release manifest", () => {
    const bytes = readFileSync(path.resolve(__dirname, "../../data/v3.2/page-catalog.json"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(manifest.copied["page-catalog.json"].sha256);
    expect(PAGE_CATALOG.kbDigest).toBe(manifest.kb_digest);
  });

  it("preserves every generated record and shares the discovery release", () => {
    expect(PAGE_CATALOG).toEqual(rawPageCatalog);
    expect(PAGE_CATALOG.kbVersion).toBe(CATALOG.kbVersion);
    expect(PAGE_CATALOG.kbDigest).toBe(CATALOG.kbDigest);
    expect(PAGE_CATALOG.records).toHaveLength(18);
    expect(PAGE_CATALOG.records.some((record) => record.status === "limited")).toBe(true);
  });

  it("scopes all three page sections to their pilot city", () => {
    for (const city of ["bamberg", "bayreuth"] as const) {
      for (const category of ["culture-tradition", "activities-participation", "official-newcomer-information"] as const) {
        expect(getRecords(city, category)).toHaveLength(3);
        expect(getRecords(city, category).every((record) => record.city === city && record.category === category)).toBe(true);
      }
    }
  });

  it("groups sources without dropping retrieval dates or limited status", () => {
    for (const city of ["bamberg", "bayreuth"] as const) {
      const groups = getSourceGroups(city);
      expect(groups.flatMap((group) => group.records)).toHaveLength(9);
      for (const group of groups) {
        expect(group.records.every((record) => record.sourceUrl === group.sourceUrl
          && record.sourceName === group.sourceName && record.retrievedAt === group.retrievedAt
          && record.status === group.status)).toBe(true);
      }
    }
  });

  it.each([
    ["a sample status", { status: "mock" }],
    ["an unverified backend status", { status: "source-backed" }],
    ["a non-pilot city", { city: "coburg" }],
    ["a discovery category", { category: "sports" }],
    ["an impossible calendar date", { retrievedAt: "2026-02-31" }],
    ["a non-leap February date", { retrievedAt: "2026-02-29" }],
    ["an April overflow", { retrievedAt: "2026-04-31" }],
    ["a date timestamp", { retrievedAt: "2026-10-08T10:00:00Z" }],
    ["an executable URL", { sourceUrl: "javascript:alert(1)" }],
    ["a relative URL", { sourceUrl: "/sources" }],
    ["a missing publisher", { sourceName: "" }],
    ["a missing translation", { title: { de: "Titel" } }],
    ["an empty summary", { summary: { de: "", en: "" } }],
  ])("rejects %s rather than silently rendering it", (_name, change) => {
    const release = structuredClone(rawPageCatalog);
    Object.assign(release.records[0]!, change);
    expect(() => parsePageCatalog(release)).toThrow(/Invalid page catalog/);
  });

  it("rejects a missing records array and a duplicate record id", () => {
    expect(() => parsePageCatalog({ ...rawPageCatalog, records: null })).toThrow(/records/);
    expect(() => parsePageCatalog({ ...rawPageCatalog, records: [rawPageCatalog.records[0], rawPageCatalog.records[0]] })).toThrow(/duplicate id/);
  });

  it("rejects unsupported release metadata", () => {
    expect(() => parsePageCatalog({ ...rawPageCatalog, schemaVersion: 2 })).toThrow(/schemaVersion/);
    expect(() => parsePageCatalog({ ...rawPageCatalog, kbDigest: "bad" })).toThrow(/kbDigest/);
    expect(() => parsePageCatalog({ ...rawPageCatalog, kbVersion: "" })).toThrow(/kbVersion/);
  });
});
