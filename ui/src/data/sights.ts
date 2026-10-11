import type { Photo } from "./photos";
import { PHOTOS } from "./photos";

const CC_BY_SA_4 = { license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/" } as const;
const CC_BY_SA_3 = { license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/" } as const;

/** Commons file page for a file name, e.g. "Bamberg Dom 1230769.jpg". */
const commons = (file: string) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, "_"))}`;

/** Sight photos, stored locally in /public/images/sights. Every one is credited where it is shown. */
const SIGHT_PHOTOS = {
  bambergDom: {
    src: "/images/sights/bamberg-dom.webp",
    width: 1920,
    height: 1440,
    alt: { en: "The four towers of Bamberg Cathedral above the red roofs of the old town", de: "Die vier Türme des Bamberger Doms über den roten Dächern der Altstadt" },
    author: "Ermell",
    ...CC_BY_SA_4,
    sourceUrl: commons("Bamberg Dom 1230769.jpg"),
  },
  bambergKleinVenedig: {
    src: "/images/sights/bamberg-klein-venedig.webp",
    width: 1920,
    height: 1280,
    alt: { en: "Little Venice: half-timbered fishermen's houses along the river Regnitz", de: "Klein-Venedig: Fachwerkhäuser der Fischer am Ufer der Regnitz" },
    author: "MaxEmanuel",
    license: "CC0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourceUrl: commons("Klein-Venedig (Bamberg) 05.jpg"),
  },
  bambergRosengarten: {
    src: "/images/sights/bamberg-rosengarten.webp",
    width: 1920,
    height: 1272,
    alt: { en: "Roses and statues in front of a pavilion in the Rosengarten of the New Residence", de: "Rosen und Statuen vor einem Pavillon im Rosengarten der Neuen Residenz" },
    author: "Tilman2007",
    ...CC_BY_SA_3,
    sourceUrl: commons("Bamberg, Neue Residenz, Rosengarten-005.jpg"),
  },
  bambergMichelsberg: {
    src: "/images/sights/bamberg-michelsberg.webp",
    width: 1920,
    height: 1440,
    alt: { en: "Michelsberg Abbey with its two towers on a green hill", de: "Kloster Michelsberg mit seinen zwei Türmen auf einem grünen Hügel" },
    author: "Ermell",
    ...CC_BY_SA_4,
    sourceUrl: commons("Bamberg Kloster Michelsberg 4298743.jpg"),
  },
  bayreuthOpernhaus: {
    src: "/images/sights/bayreuth-opernhaus.webp",
    width: 1920,
    height: 1280,
    alt: { en: "The baroque facade of the Margravial Opera House with statues on the roof", de: "Die Barockfassade des Markgräflichen Opernhauses mit Statuen auf dem Dach" },
    author: "Immanuel Giel",
    license: "Public domain",
    licenseUrl: "https://commons.wikimedia.org/wiki/Commons:Licensing#Public_domain",
    sourceUrl: commons("Bayreuth Fassade.jpg"),
  },
  bayreuthEremitage: {
    src: "/images/sights/bayreuth-eremitage.webp",
    width: 1920,
    height: 1440,
    alt: { en: "The Old Palace of the Hermitage park with a flower garden", de: "Das Alte Schloss im Park der Eremitage mit Blumengarten" },
    author: "Zairon",
    ...CC_BY_SA_3,
    sourceUrl: commons("Bayreuth Eremitage Altes Schloss Außen.JPG"),
  },
  bayreuthNeuesSchloss: {
    src: "/images/sights/bayreuth-neues-schloss.webp",
    width: 1920,
    height: 1224,
    alt: { en: "The New Palace in Bayreuth seen across its lawn", de: "Das Neue Schloss in Bayreuth, gesehen über den Rasen" },
    author: "Roehrensee",
    ...CC_BY_SA_4,
    sourceUrl: commons("Neues Schloss Bayreuth IMG 3393.jpg"),
  },
  bayreuthWahnfried: {
    src: "/images/sights/bayreuth-wahnfried.webp",
    width: 1920,
    height: 1280,
    alt: { en: "Haus Wahnfried, Richard Wagner's house, among autumn trees", de: "Haus Wahnfried, das Wohnhaus Richard Wagners, zwischen Herbstbäumen" },
    author: "DALIBRI",
    ...CC_BY_SA_4,
    sourceUrl: commons("Bayreuth - Haus Wahnfried 003.jpg"),
  },
} satisfies Record<string, Photo>;

/**
 * Photo per catalog record id. Only the photo and its credit live here; every factual
 * sight text comes from the catalog. A sight without an entry is shown without a photo.
 */
export const SIGHT_PHOTOS_BY_RECORD: Readonly<Record<string, Photo>> = {
  "BA-SIGHT-01": SIGHT_PHOTOS.bambergDom,
  "BA-SIGHT-02": PHOTOS.bamberg,
  "BA-SIGHT-03": SIGHT_PHOTOS.bambergKleinVenedig,
  "BA-SIGHT-04": SIGHT_PHOTOS.bambergRosengarten,
  "BA-SIGHT-05": SIGHT_PHOTOS.bambergMichelsberg,
  "BY-SIGHT-01": SIGHT_PHOTOS.bayreuthOpernhaus,
  "BY-SIGHT-02": PHOTOS.bayreuth,
  "BY-SIGHT-03": SIGHT_PHOTOS.bayreuthEremitage,
  "BY-SIGHT-04": SIGHT_PHOTOS.bayreuthNeuesSchloss,
  "BY-SIGHT-05": SIGHT_PHOTOS.bayreuthWahnfried,
};
