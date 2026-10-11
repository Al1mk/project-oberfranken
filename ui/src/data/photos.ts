import type { LocalizedText } from "../i18n/types";

/**
 * Openly licensed photos from Wikimedia Commons, stored locally in /public/images.
 * Every photo is shown with author and licence (required for CC BY-SA).
 */
export type Photo = {
  src: string;
  width: number;
  height: number;
  alt: LocalizedText;
  author: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
};

export const PHOTOS = {
  region: {
    src: "/images/region-walberla.webp",
    width: 2000,
    height: 1333,
    alt: {
      en: "Green hills of the Walberla in Franconian Switzerland under a wide sky",
      de: "Grüne Hügel des Walberla in der Fränkischen Schweiz unter weitem Himmel",
    },
    author: "Neusächsin",
    license: "CC0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Walberla_Kirchehrenberg.jpg",
  },
  bamberg: {
    src: "/images/bamberg-altes-rathaus.webp",
    width: 1600,
    height: 1240,
    alt: {
      en: "Bamberg's Old Town Hall standing on a bridge over the river Regnitz",
      de: "Das Alte Rathaus in Bamberg auf einer Brücke über der Regnitz",
    },
    author: "Ermell",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Bamberg_Altes_Rathaus_17RM1565-PSD.jpg",
  },
  bayreuth: {
    src: "/images/bayreuth-festspielhaus.webp",
    width: 1600,
    height: 1067,
    alt: {
      en: "The Bayreuth Festspielhaus behind trees and a flower bed",
      de: "Das Bayreuther Festspielhaus hinter Bäumen und einem Blumenbeet",
    },
    author: "El Grafo",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Festspielhaus_Bayreuth_2016.jpg",
  },
} satisfies Record<string, Photo>;
