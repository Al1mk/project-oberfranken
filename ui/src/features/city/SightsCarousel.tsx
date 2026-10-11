import { useState } from "react";
import { PhotoCredit } from "@/components/ui/PhotoFigure";
import FocusPullCarousel from "@/components/ui/focus-pull-carousel";
import type { SightRecord } from "@/data/catalog";
import { SIGHT_PHOTOS_BY_RECORD } from "@/data/sights";
import type { CityPageData } from "@/data/types";
import { useI18n } from "@/i18n/LanguageContext";
import { SightDetails } from "./DiscoveryEntries";

/**
 * The verified sights of a city as a focus-pull photo strip. Texts come from the catalog;
 * the photo registry only supplies the picture and its credit.
 */
export function SightsCarousel({ city, sights }: { city: CityPageData; sights: SightRecord[] }) {
  const { t, localize } = useI18n();
  const [active, setActive] = useState(0);
  const labels = t.city.sections.sights;
  const current = sights[active] ?? sights[0];
  const currentPhoto = current ? SIGHT_PHOTOS_BY_RECORD[current.id] : undefined;

  return (
    <>
      <FocusPullCarousel
        slides={sights.map((sight) => {
          const photo = SIGHT_PHOTOS_BY_RECORD[sight.id];
          return {
            ...(photo && { image: photo.src, alt: localize(photo.alt) }),
            title: localize(sight.title),
            caption: localize(sight.summary),
          };
        })}
        height="38rem"
        cardWidth="min(54vw, 42rem)"
        aspect="3 / 2"
        autoplay={0}
        background="var(--background)"
        ink="var(--foreground)"
        ariaLabel={labels.carouselLabel(city.name)}
        labels={labels}
        onChange={setActive}
      />
      {currentPhoto && (
        <p className="container-page mt-3 text-right text-xs text-muted-foreground">
          <PhotoCredit photo={currentPhoto} />
        </p>
      )}
      {current && <SightDetails record={current} />}
    </>
  );
}
