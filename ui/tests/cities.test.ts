import { describe, expect, it } from "vitest";
import { CITIES, ENABLED_CITIES, cityMatchesQuery } from "../src/data/cities";
import { CITY_PAGES } from "../src/data/cityPages";

const EXPECTED = [
  "Arzberg", "Bad Berneck i.Fichtelgebirge", "Bad Rodach", "Bad Staffelstein", "Bamberg", "Baunach", "Bayreuth",
  "Betzenstein", "Burgkunstadt", "Coburg", "Creußen", "Ebermannstadt", "Forchheim", "Gefrees", "Goldkronach",
  "Gräfenberg", "Hallstadt", "Helmbrechts", "Hof", "Hohenberg a.d.Eger", "Hollfeld", "Kirchenlamitz", "Kronach",
  "Kulmbach", "Kupferberg", "Lichtenberg", "Lichtenfels", "Ludwigsstadt", "Marktleuthen", "Marktredwitz", "Münchberg",
  "Naila", "Neustadt b.Coburg", "Pegnitz", "Pottenstein", "Rehau", "Rödental", "Schauenstein", "Scheßlitz",
  "Schlüsselfeld", "Schönwald", "Schwarzenbach a.d.Saale", "Schwarzenbach a.Wald", "Selb", "Selbitz", "Seßlach",
  "Stadtsteinach", "Teuschnitz", "Waischenfeld", "Wallenfels", "Weismain", "Weißenstadt", "Wunsiedel",
];

describe("city data", () => {
  it("contains all 53 towns in the given alphabetical order", () => {
    expect(CITIES).toHaveLength(53);
    expect(CITIES.map((city) => city.name)).toEqual(EXPECTED);
  });

  it("uses unique ids", () => {
    expect(new Set(CITIES.map((city) => city.id)).size).toBe(53);
    expect(CITIES.find((city) => city.name === "Schwarzenbach a.d.Saale")?.id).toBe("schwarzenbach-a-d-saale");
  });

  it("enables only Bamberg and Bayreuth, each with a slug and page data", () => {
    expect(ENABLED_CITIES.map((city) => [city.name, city.slug])).toEqual([
      ["Bamberg", "bamberg"],
      ["Bayreuth", "bayreuth"],
    ]);
    for (const city of CITIES.filter((c) => !c.enabled)) expect(city.slug).toBeNull();
    expect(Object.keys(CITY_PAGES).sort()).toEqual(["bamberg", "bayreuth"]);
  });

  it("matches queries with or without umlauts", () => {
    const schoenwald = CITIES.find((city) => city.name === "Schönwald")!;
    expect(cityMatchesQuery(schoenwald, "schönw")).toBe(true);
    expect(cityMatchesQuery(schoenwald, "schoenw")).toBe(true);
    expect(cityMatchesQuery(schoenwald, "schonw")).toBe(true);
    expect(cityMatchesQuery(schoenwald, "bay")).toBe(false);
  });
});

