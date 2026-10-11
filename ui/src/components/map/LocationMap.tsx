import { usePrivacy } from "@/features/privacy/PrivacyContext";
import { useI18n } from "@/i18n/LanguageContext";
import type { GeoPoint } from "../../data/types";
import { Button } from "../ui/button";
import { ExternalLink } from "../ui/ExternalLink";
import { buildEmbedUrl, buildViewUrl } from "./osmUrls";

type LocationMapProps = {
  location: GeoPoint;
  zoom: number;
  /** Accessible title for the embedded map frame. */
  title: string;
  openLargerLabel: string;
  attributionPrefix: string;
  attributionLinkLabel: string;
};

/**
 * API-key-free map showing a single location via the OpenStreetMap embed.
 * No geolocation, tracking or routing. Swap the implementation here
 * (e.g. Leaflet or MapLibre) without touching the pages that use it.
 */
export function LocationMap({ location, zoom, title, openLargerLabel, attributionPrefix, attributionLinkLabel }: LocationMapProps) {
  const { t } = useI18n();
  const { mapsAllowed, openSettings } = usePrivacy();

  // Until external maps are explicitly accepted nothing is mounted that could contact OpenStreetMap:
  // no iframe, no remote thumbnail, no preconnect or preload. The link below is followed only if the user clicks it.
  if (!mapsAllowed) {
    return (
      <figure className="m-0" data-map-state="blocked">
        <div className="flex aspect-[16/9] flex-col items-start justify-center gap-4 border border-border-cool bg-surface-cool p-8">
          <p className="max-w-xl text-foreground-soft">{t.privacy.mapBlocked}</p>
          <Button variant="outline" onClick={(event) => openSettings(event.currentTarget)}>
            {t.privacy.footerSettings}
          </Button>
        </div>
        <figcaption className="mt-3 flex justify-end text-sm">
          <ExternalLink href={buildViewUrl(location, zoom)}>{openLargerLabel}</ExternalLink>
        </figcaption>
      </figure>
    );
  }
  return (
    <figure className="m-0">
      <div className="aspect-[16/9] overflow-hidden border border-border-cool bg-background">
        <iframe
          className="block h-full w-full border-0"
          title={title}
          src={buildEmbedUrl(location, zoom)}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
      <figcaption className="mt-3 flex justify-between gap-4 text-sm">
        <span className="text-muted-foreground">
          {attributionPrefix}{" "}
          <ExternalLink href="https://www.openstreetmap.org/copyright">{attributionLinkLabel}</ExternalLink>
        </span>
        <ExternalLink href={buildViewUrl(location, zoom)}>{openLargerLabel}</ExternalLink>
      </figcaption>
    </figure>
  );
}
