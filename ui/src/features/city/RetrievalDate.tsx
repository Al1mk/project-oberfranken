import { useI18n } from "../../i18n/LanguageContext";
import { formatDate } from "../../lib/formatDate";

export function RetrievalDate({ value, className }: { value?: string; className?: string }) {
  const { t, language } = useI18n();
  return (
    <span className={className}>
      {value ? t.city.sections.sources.retrieved(formatDate(value, language)) : t.city.sections.sources.notRetrieved}
    </span>
  );
}
