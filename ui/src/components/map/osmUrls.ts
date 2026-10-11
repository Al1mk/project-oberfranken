import type { GeoPoint } from "../../data/types";

/** Approximate half-extent of the visible area in degrees for a given zoom level. */
function spanForZoom(zoom: number) {
  const lon = 360 / 2 ** zoom;
  return { lon: lon * 1.1, lat: lon * 0.45 };
}

export function buildEmbedUrl({ lat, lon }: GeoPoint, zoom: number): string {
  const span = spanForZoom(zoom);
  const bbox = [lon - span.lon, lat - span.lat, lon + span.lon, lat + span.lat].map((n) => n.toFixed(4)).join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`;
}

export function buildViewUrl({ lat, lon }: GeoPoint, zoom: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`;
}
