import { ExternalLink } from "@/components/ui/ExternalLink";
import { useI18n } from "@/i18n/LanguageContext";
import { hostnameOf } from "@/lib/formatDate";
import { RetrievalDate } from "./RetrievalDate";

export type SourceRow = {
  sourceName: string;
  sourceUrl: string;
  /** Titles of the entries that rely on this source. */
  usedFor: string[];
  retrievedAt?: string;
  status?: "verified" | "limited";
};

export function SourcesList({ rows, label }: { rows: SourceRow[]; label: string }) {
  const { t } = useI18n();
  return (
    <ul aria-label={label} className="border-t border-foreground">
      {rows.map((row) => (
        <li key={JSON.stringify([row.sourceUrl, row.sourceName, row.retrievedAt, row.status])} className="grid grid-cols-[16rem_1fr_13rem] items-baseline gap-8 border-b border-border py-5 text-sm">
          <div className="[overflow-wrap:anywhere]">
            <p className="font-semibold text-foreground">{row.sourceName}</p>
            <ExternalLink href={row.sourceUrl}>{hostnameOf(row.sourceUrl)}</ExternalLink>
            {row.status && <p className="mt-1 text-muted-foreground">{t.city.statusLabels[row.status]}</p>}
          </div>
          <p className="text-foreground-soft">
            <span className="text-muted-foreground">{t.city.sections.sources.usedFor}: </span>
            {row.usedFor.join(", ")}
          </p>
          <RetrievalDate value={row.retrievedAt} className="text-right text-muted-foreground" />
        </li>
      ))}
    </ul>
  );
}
