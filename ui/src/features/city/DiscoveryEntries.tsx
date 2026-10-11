import type { ReactNode } from "react";
import { ExternalLink } from "@/components/ui/ExternalLink";
import type { CatalogSource, RestaurantRecord, SightRecord, SportsClubRecord } from "@/data/catalog";
import { useI18n } from "@/i18n/LanguageContext";
import { RetrievalDate } from "./RetrievalDate";

type Fact = { label: string; value: string };

/** Label/value pairs of one catalog entry. Values are shown exactly as the catalog has them. */
function Facts({ facts }: { facts: Fact[] }) {
  return (
    <dl className="m-0 mt-4 flex flex-col gap-3">
      {facts.map((fact) => (
        <div key={fact.label}>
          <dt className="text-xs font-semibold text-muted-foreground">{fact.label}</dt>
          <dd className="m-0 text-[0.9375rem] text-foreground-soft [overflow-wrap:anywhere]">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EntrySource({ source }: { source: CatalogSource }) {
  const { t } = useI18n();
  return (
    <p className="mt-5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
      <span>
        <span className="text-muted-foreground">{t.city.sourceLabel}: </span>
        <ExternalLink href={source.url}>{source.name}</ExternalLink>
      </span>
      <RetrievalDate value={source.retrievedAt} className="text-muted-foreground" />
    </p>
  );
}

function Entry({ id, title, summary, source, children }: { id: string; title: string; summary: string; source: CatalogSource; children: ReactNode }) {
  return (
    <article data-record-id={id} className="flex flex-col border-t border-foreground pt-5">
      <h3 className="text-[1.5rem] leading-snug">{title}</h3>
      <p className="mt-3 text-foreground-soft">{summary}</p>
      {children}
      <div className="mt-auto">
        <EntrySource source={source} />
      </div>
    </article>
  );
}

export function RestaurantList({ records }: { records: RestaurantRecord[] }) {
  const { t, localize } = useI18n();
  const d = t.city.sections.details;
  return (
    <div className="grid grid-cols-3 gap-10">
      {records.map((record) => (
        <Entry key={record.id} id={record.id} title={localize(record.title)} summary={localize(record.summary)} source={record.source}>
          <Facts
            facts={[
              { label: d.whyNotable, value: localize(record.whyNotable) },
              { label: d.cuisine, value: localize(record.details.cuisine) },
              { label: d.signatureDish, value: localize(record.details.signatureDish) },
              { label: d.recommendedOrder, value: localize(record.details.recommendedOrder) },
              { label: d.whyOrderIt, value: localize(record.details.whyOrderIt) },
            ]}
          />
        </Entry>
      ))}
    </div>
  );
}

export function SportsList({ records }: { records: SportsClubRecord[] }) {
  const { t, localize } = useI18n();
  const d = t.city.sections.details;
  return (
    <div className="grid grid-cols-3 gap-10">
      {records.map((record) => {
        const { achievement, sport, participationType, homeVenue } = record.details;
        const facts: Fact[] = [
          { label: d.whyNotable, value: localize(record.whyNotable) },
          { label: d.sport, value: localize(sport) },
          // Only shown when the catalog documents one (null means none).
          ...(achievement ? [{ label: d.achievement, value: localize(achievement) }] : []),
          { label: d.participation, value: d.participationTypes[participationType] },
          { label: d.homeVenue, value: homeVenue },
        ];
        return (
          <Entry key={record.id} id={record.id} title={localize(record.title)} summary={localize(record.summary)} source={record.source}>
            <Facts facts={facts} />
          </Entry>
        );
      })}
    </div>
  );
}

/** Text details of the sight currently shown in the carousel. */
export function SightDetails({ record }: { record: SightRecord }) {
  const { t, localize } = useI18n();
  const d = t.city.sections.details;
  return (
    <article data-record-id={record.id} className="container-page mt-8 grid grid-cols-12 gap-x-12 border-t border-foreground pt-6">
      <div className="col-span-5">
        <h3 className="text-[1.5rem] leading-snug">{localize(record.title)}</h3>
        <p className="mt-3 text-foreground-soft">{localize(record.summary)}</p>
        <EntrySource source={record.source} />
      </div>
      <div className="col-span-7">
        <Facts
          facts={[
            { label: d.whyNotable, value: localize(record.whyNotable) },
            { label: d.whyVisit, value: localize(record.details.whyVisit) },
            { label: d.keyHighlight, value: localize(record.details.keyHighlight) },
            { label: d.significance, value: localize(record.details.significance) },
          ]}
        />
      </div>
    </article>
  );
}
