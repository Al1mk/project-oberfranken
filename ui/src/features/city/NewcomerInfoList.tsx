import { ExternalLink } from "@/components/ui/ExternalLink";
import type { SourceRecord } from "@/data/types";
import { useI18n } from "@/i18n/LanguageContext";
import { RetrievalDate } from "./RetrievalDate";

export function NewcomerInfoList({ records }: { records: SourceRecord[] }) {
  const { t, localize } = useI18n();
  return (
    <ul className="border-t border-foreground">
      {records.map((record) => (
        <li key={record.id} data-record-id={record.id} className="border-b border-border py-6">
          <h3 className="text-[1.5rem] leading-snug">{localize(record.title)}</h3>
          <p className="mt-2 max-w-2xl text-foreground-soft">{localize(record.summary)}</p>
          <p className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
            <span>
              <span className="text-muted-foreground">{t.city.sourceLabel}: </span>
              <ExternalLink href={record.sourceUrl}>{record.sourceName}</ExternalLink>
            </span>
            <RetrievalDate value={record.retrievedAt} className="text-muted-foreground" />
            <span className="text-muted-foreground">{t.city.statusLabels[record.status]}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}
