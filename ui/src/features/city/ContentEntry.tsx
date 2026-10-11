import { ExternalLink } from "@/components/ui/ExternalLink";
import type { SourceRecord } from "@/data/types";
import { useI18n } from "@/i18n/LanguageContext";
import { RetrievalDate } from "./RetrievalDate";

/** One source record rendered as an editorial text block (no card). */
export function ContentEntry({ record }: { record: SourceRecord }) {
  const { t, localize } = useI18n();
  return (
    <article data-record-id={record.id} className="flex flex-col border-t border-foreground pt-5">
      <h3 className="text-[1.5rem] leading-snug">{localize(record.title)}</h3>
      <p className="mt-3 flex-1 text-foreground-soft">{localize(record.summary)}</p>
      <p className="mt-5 text-sm">
        <span className="text-muted-foreground">{t.city.sourceLabel}: </span>
        <ExternalLink href={record.sourceUrl}>{record.sourceName}</ExternalLink>
      </p>
      <p className="mt-2 text-sm text-muted-foreground">{t.city.statusLabels[record.status]}</p>
      <RetrievalDate value={record.retrievedAt} className="mt-1 text-sm text-muted-foreground" />
    </article>
  );
}
