import { useI18n } from "@/i18n/LanguageContext";
import { LANGUAGES } from "@/i18n/types";
import { cn } from "@/lib/utils";

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();
  return (
    <div className="inline-flex items-center gap-1" role="group" aria-label={t.language.label}>
      {LANGUAGES.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={language === code}
          aria-label={t.language[code]}
          onClick={() => setLanguage(code)}
          className={cn(
            "h-11 min-w-11 rounded-md px-2 text-sm font-semibold transition-colors",
            language === code ? "text-foreground underline decoration-primary decoration-2 underline-offset-[6px]" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
