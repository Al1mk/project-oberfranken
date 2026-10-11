import { ExternalLink } from "@/components/ui/ExternalLink";
import { useI18n } from "@/i18n/LanguageContext";
import { formatDate } from "@/lib/formatDate";
import type { AssistantSource } from "./assistantClient";

/** The sources one assistant message is based on, shown directly beneath that message. */
export function ChatSources({ sources }: { sources: AssistantSource[] }) {
  const { t, language } = useI18n();
  if (sources.length === 0) return null;

  return (
    <div className="mt-2 w-full pl-1 text-xs [overflow-wrap:anywhere]">
      <p className="font-semibold text-foreground-soft">{t.chat.sourcesLabel}</p>
      <ul className="mt-1 flex flex-col gap-2">
        {sources.map((source) => (
          <li key={source.recordId} data-record-id={source.recordId} data-status={source.recordStatus} className="border-l-2 border-border pl-2">
            <ExternalLink href={source.sourceUrl}>{source.title}</ExternalLink>
            <p className="text-muted-foreground">{t.chat.sourceMeta(source.sourceName, formatDate(source.retrievedAt.slice(0, 10), language))}</p>
            {source.recordStatus === "limited" && <p className="font-semibold text-primary">{t.chat.limitedSource}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
