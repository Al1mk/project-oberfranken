import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import rawCatalog from "../../data/v3.2/catalog.json";
import manifest from "../../data/v3.2/manifest.json";
import { CATALOG, DISCOVERY_ANCHORS, getCatalogSourceGroups, getCitiesWithCategory, getDiscovery, parseCatalog, type Catalog } from "../src/data/catalog";

// Loosely typed on purpose: the tests corrupt the release in ways the real types forbid.
type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const clone = () => structuredClone(rawCatalog) as Loose;
const catalogPath = path.resolve(__dirname, "../../data/v3.2/catalog.json");

describe("discovery catalog (data/v3.2/catalog.json)", () => {
  it("is the exact file the data track released", () => {
    const sha256 = createHash("sha256").update(readFileSync(catalogPath)).digest("hex");
    expect(sha256).toBe(manifest.copied["catalog.json"].sha256);
    expect(CATALOG.kbDigest).toBe(manifest.kb_digest);
  });

  it("has release metadata", () => {
    expect(CATALOG.schemaVersion).toBe(1);
    expect(CATALOG.kbVersion).toMatch(/^\d{4}-\d{2}-\d{2}-v/);
    expect(CATALOG.kbDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(CATALOG.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("has unique ids and only verified records", () => {
    const ids = CATALOG.records.map((record) => record.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CATALOG.records.every((record) => record.verification === "verified")).toBe(true);
  });

  it("keeps the limited restaurants out of discovery", () => {
    const ids = CATALOG.records.map((record) => record.id);
    expect(ids).not.toContain("BA-REST-04");
    expect(ids).not.toContain("BY-REST-03");
  });

  it("maps every record type to its category, topic and pilot city", () => {
    const categoryOf = { restaurant: "restaurants", "sports-club": "sports", sight: "sights" } as const;
    for (const record of CATALOG.records) {
      expect(record.discoveryCategory).toBe(categoryOf[record.recordType]);
      expect(["bamberg", "bayreuth"]).toContain(record.city);
      expect(record.id.startsWith(record.city === "bamberg" ? "BA-" : "BY-")).toBe(true);
    }
    expect(new Set(CATALOG.records.filter((r) => r.recordType === "sports-club").map((r) => r.topic))).toEqual(new Set(["activities-fun"]));
    expect(new Set(CATALOG.records.filter((r) => r.recordType === "sight").map((r) => r.topic))).toEqual(new Set(["cultural-places"]));
    expect(new Set(CATALOG.records.filter((r) => r.recordType === "restaurant").map((r) => r.topic))).toEqual(new Set(["regional-food"]));
  });

  it("has German and English text, an https source and a retrieval date on every record", () => {
    for (const record of CATALOG.records) {
      for (const field of [record.title, record.summary, record.whyNotable]) {
        expect(field.de.trim()).not.toBe("");
        expect(field.en.trim()).not.toBe("");
      }
      expect(record.source.name.trim()).not.toBe("");
      expect(record.source.url).toMatch(/^https:\/\//);
      expect(record.source.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("carries the type-specific details, with null achievements only on sports clubs", () => {
    for (const record of CATALOG.records) {
      if (record.recordType === "restaurant") {
        expect(Object.keys(record.details).sort()).toEqual(["cuisine", "recommendedOrder", "signatureDish", "whyOrderIt"]);
      } else if (record.recordType === "sight") {
        expect(Object.keys(record.details).sort()).toEqual(["keyHighlight", "significance", "whyVisit"]);
      } else {
        expect(Object.keys(record.details).sort()).toEqual(["achievement", "homeVenue", "participationType", "sport"]);
        expect(["spectator", "participant", "both"]).toContain(record.details.participationType);
      }
    }
    const sports = CATALOG.records.filter((record) => record.recordType === "sports-club");
    expect(sports.some((record) => record.details.achievement === null)).toBe(true);
    expect(sports.some((record) => record.details.achievement !== null)).toBe(true);
  });

  it("offers every pilot city restaurants, sports and sights", () => {
    for (const category of ["restaurants", "sports", "sights"] as const) {
      expect(getCitiesWithCategory(category)).toEqual(["bamberg", "bayreuth"]);
    }
  });

  it("returns records in the exporter's order, scoped to the city", () => {
    const sights = getDiscovery("bayreuth", "sights");
    expect(sights.every((record) => record.city === "bayreuth")).toBe(true);
    expect(sights.map((record) => record.order)).toEqual([...sights.map((record) => record.order)].sort((a, b) => a - b));
  });

  it("groups each source url once", () => {
    const groups = getCatalogSourceGroups("bamberg");
    expect(new Set(groups.map((group) => group.source.url)).size).toBe(groups.length);
    expect(groups.flatMap((group) => group.records)).toHaveLength(CATALOG.records.filter((record) => record.city === "bamberg").length);
  });

  it("names the anchors the category menu links to", () => {
    expect(DISCOVERY_ANCHORS).toEqual({ sports: "sports", sights: "places-to-see", restaurants: "restaurants" });
  });
});

describe("parseCatalog rejects a malformed release", () => {
  const reject = (mutate: (catalog: Loose) => void, message: RegExp) => {
    const catalog = clone();
    mutate(catalog);
    expect(() => parseCatalog(catalog)).toThrow(message);
  };

  it("accepts the real catalog", () => {
    expect(parseCatalog(clone()).records).toHaveLength(CATALOG.records.length);
  });

  it("rejects bad metadata", () => {
    reject((c) => (c.schemaVersion = 2), /schemaVersion/);
    reject((c) => (c.kbDigest = "abc"), /kbDigest/);
    reject((c) => (c.records = {}), /records/);
  });

  it("rejects duplicate ids", () => {
    reject((c) => (c.records[1].id = c.records[0].id), /duplicate id/);
  });

  it("rejects limited records and unknown cities, types and categories", () => {
    reject((c) => (c.records[0].verification = "limited"), /verified/);
    reject((c) => (c.records[0].city = "coburg"), /city/);
    reject((c) => (c.records[0].recordType = "museum"), /recordType/);
    reject((c) => (c.records[0].discoveryCategory = "restaurants"), /discoveryCategory/);
  });

  it("rejects missing or empty localized fields", () => {
    reject((c) => delete c.records[0].title.de, /title\.de/);
    reject((c) => (c.records[0].summary.en = "  "), /summary\.en/);
  });

  it("rejects non-https sources and bad dates", () => {
    reject((c) => (c.records[0].source.url = "http://example.org"), /https/);
    reject((c) => (c.records[0].source.url = "javascript:alert(1)"), /https/);
    reject((c) => (c.records[0].source.retrievedAt = "08.10.2026"), /ISO date/);
    reject((c) => (c.records[0].source.retrievedAt = "2026-02-31"), /ISO date/);
    reject((c) => (c.generatedAt = "2026-13-01"), /ISO date/);
  });

  it("rejects wrong type-specific details but accepts a null achievement", () => {
    const sportIndex = rawCatalog.records.findIndex((record) => record.recordType === "sports-club");
    reject((c) => delete c.records[sportIndex].details.homeVenue, /homeVenue/);
    reject((c) => (c.records[sportIndex].details.participationType = "vip"), /participationType/);
    reject((c) => (c.records[sportIndex].details.price = "5 EUR"), /unexpected field/);
    reject((c) => (c.records[sportIndex].details.achievement = { de: "", en: "x" }), /achievement/);
    const catalog = clone();
    catalog.records[sportIndex].details.achievement = null;
    expect((parseCatalog(catalog) as Catalog).records[sportIndex]).toBeDefined();
  });
});
