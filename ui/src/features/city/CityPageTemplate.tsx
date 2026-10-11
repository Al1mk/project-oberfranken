import type { ReactNode } from "react";
import { MapPin } from "lucide-react";
import { LocationMap } from "@/components/map/LocationMap";
import { CATALOG, DISCOVERY_ANCHORS, getCatalogSourceGroups, getDiscovery, type Catalog } from "@/data/catalog";
import { getRecords, getSourceGroups } from "@/data/sourceRecords";
import type { CityPageData } from "@/data/types";
import { useI18n } from "@/i18n/LanguageContext";
import { cn } from "@/lib/utils";
import { CityHero, type CitySectionLink } from "./CityHero";
import { ContentEntry } from "./ContentEntry";
import { RestaurantList, SportsList } from "./DiscoveryEntries";
import { NewcomerInfoList } from "./NewcomerInfoList";
import { SightsCarousel } from "./SightsCarousel";
import { SourcesList } from "./SourcesList";

const SECTION_IDS = {
  ...DISCOVERY_ANCHORS,
  culture: "culture-tradition",
  activities: "activities-participation",
  official: "official-newcomer-information",
  map: "city-map",
  sources: "sources",
} as const;

/** Headings are focus targets: anchor navigation moves focus to them (see AppLayout). */
function Heading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={`${id}-title`} tabIndex={-1} className="text-title">
      {children}
    </h2>
  );
}

function Section({ id, title, intro, tone = "plain", children }: { id: string; title: string; intro?: ReactNode; tone?: "plain" | "cool"; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("py-24", tone === "cool" && "bg-surface-cool")}>
      <div className="container-page">
        <div className="mb-10 max-w-2xl">
          <Heading id={id}>{title}</Heading>
          {intro && <div className="mt-3 text-lg text-muted-foreground">{intro}</div>}
        </div>
        {children}
      </div>
    </section>
  );
}

/**
 * Shared layout for every city page. Places to see, restaurants and sport come from the
 * verified catalog and are hidden when a city has none. Culture, activities and newcomer
 * information retain the generated page catalog's source and verification status.
 */
export function CityPageTemplate({ city, catalog = CATALOG }: { city: CityPageData; catalog?: Catalog }) {
  const { t, localize } = useI18n();
  const s = t.city.sections;

  const sights = getDiscovery(city.slug, "sights", catalog);
  const restaurants = getDiscovery(city.slug, "restaurants", catalog);
  const sports = getDiscovery(city.slug, "sports", catalog);

  const sectionLinks: CitySectionLink[] = [
    ...(sights.length > 0 ? [{ id: SECTION_IDS.sights, label: s.sights.title }] : []),
    ...(restaurants.length > 0 ? [{ id: SECTION_IDS.restaurants, label: s.restaurants.title }] : []),
    ...(sports.length > 0 ? [{ id: SECTION_IDS.sports, label: s.sports.title }] : []),
    { id: SECTION_IDS.culture, label: s.culture.title },
    { id: SECTION_IDS.activities, label: s.activities.title },
    { id: SECTION_IDS.official, label: s.official.title },
    { id: SECTION_IDS.map, label: s.map.title },
    { id: SECTION_IDS.sources, label: s.sources.title },
  ];

  const verifiedSources = getCatalogSourceGroups(city.slug, catalog).map((group) => ({
    sourceName: group.source.name,
    sourceUrl: group.source.url,
    usedFor: group.records.map((record) => localize(record.title)),
    retrievedAt: group.source.retrievedAt,
    status: "verified" as const,
  }));
  const pageSources = getSourceGroups(city.slug).map((group) => ({
    sourceName: group.sourceName,
    sourceUrl: group.sourceUrl,
    usedFor: group.records.map((record) => localize(record.title)),
    retrievedAt: group.retrievedAt,
    status: group.status,
  }));

  return (
    <>
      <CityHero city={city} sections={sectionLinks} />

      {sights.length > 0 && (
        <section id={SECTION_IDS.sights} aria-labelledby={`${SECTION_IDS.sights}-title`} className="overflow-x-clip py-24">
          <div className="container-page mb-10">
            <div className="max-w-3xl">
              <Heading id={SECTION_IDS.sights}>{s.sights.title}</Heading>
              <p className="mt-3 text-lg text-muted-foreground">{s.sights.intro(city.name)}</p>
            </div>
          </div>
          <SightsCarousel city={city} sights={sights} />
        </section>
      )}

      {restaurants.length > 0 && (
        <Section id={SECTION_IDS.restaurants} title={s.restaurants.title} intro={s.restaurants.intro(city.name)} tone="cool">
          <RestaurantList records={restaurants} />
        </Section>
      )}

      {sports.length > 0 && (
        <Section id={SECTION_IDS.sports} title={s.sports.title} intro={s.sports.intro(city.name)}>
          <SportsList records={sports} />
        </Section>
      )}

      <Section id={SECTION_IDS.culture} title={s.culture.title} intro={s.culture.intro} tone="cool">
        <div className="grid grid-cols-3 gap-10">
          {getRecords(city.slug, "culture-tradition").map((record) => (
            <ContentEntry key={record.id} record={record} />
          ))}
        </div>
      </Section>

      <Section
        id={SECTION_IDS.activities}
        title={s.activities.title}
        intro={
          <>
            <p>{s.activities.intro}</p>
            <p className="mt-2 text-base">{s.activities.notice}</p>
          </>
        }
      >
        <div className="grid grid-cols-3 gap-10">
          {getRecords(city.slug, "activities-participation").map((record) => (
            <ContentEntry key={record.id} record={record} />
          ))}
        </div>
      </Section>

      <section id={SECTION_IDS.official} aria-labelledby={`${SECTION_IDS.official}-title`} className="bg-surface-cool py-24">
        <div className="container-page grid grid-cols-12 items-start gap-x-12">
          <div className="sticky top-[calc(var(--header-height)+2rem)] col-span-5">
            <Heading id={SECTION_IDS.official}>{s.official.title}</Heading>
            <p className="mt-3 text-lg text-muted-foreground">{s.official.intro}</p>
            <p className="mt-6 border-l-2 border-primary pl-4 text-sm text-foreground-soft">{s.official.notice}</p>
          </div>
          <div className="col-span-7">
            <NewcomerInfoList records={getRecords(city.slug, "official-newcomer-information")} />
          </div>
        </div>
      </section>

      <Section id={SECTION_IDS.map} title={s.map.title} intro={s.map.intro(city.name)}>
        <div className="grid grid-cols-12 items-start gap-x-12">
          <dl className="col-span-3 m-0">
            <dt className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="size-4" aria-hidden="true" />
              {s.map.coordinates}
            </dt>
            <dd className="m-0 mt-1 font-medium tabular-nums">
              {city.location.lat.toFixed(4)}° N, {city.location.lon.toFixed(4)}° E
            </dd>
          </dl>
          <div className="col-span-9">
            <LocationMap
              location={city.location}
              zoom={city.mapZoom}
              title={s.map.frameTitle(city.name)}
              openLargerLabel={s.map.openLarger}
              attributionPrefix={s.map.attributionPrefix}
              attributionLinkLabel={s.map.attributionLink}
            />
          </div>
        </div>
      </Section>

      <Section id={SECTION_IDS.sources} title={s.sources.heading(city.name)} intro={s.sources.intro} tone="cool">
        <div className="flex flex-col gap-12">
          {verifiedSources.length > 0 && (
            <div>
              <h3 className="mb-4 text-[1.5rem] leading-snug">{s.sources.verifiedTitle}</h3>
              <SourcesList rows={verifiedSources} label={s.sources.verifiedTitle} />
            </div>
          )}
          <div>
            <h3 className="mb-4 text-[1.5rem] leading-snug">{s.sources.pageTitle}</h3>
            <SourcesList rows={pageSources} label={s.sources.pageTitle} />
          </div>
        </div>
      </Section>
    </>
  );
}
