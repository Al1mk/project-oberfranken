import { Button } from "@/components/ui/button";
import { CITY_PAGES } from "@/data/cityPages";
import type { CitySlug } from "@/data/types";
import { useI18n } from "@/i18n/LanguageContext";

const PILOT_CITIES: readonly CitySlug[] = ["bamberg", "bayreuth"];

type CityClarificationProps = {
  onChoose: (city: CitySlug) => void;
  onCancel: () => void;
  disabled: boolean;
};

/** The Bamberg / Bayreuth choice under a clarification reply. Native buttons: Tab, Enter and Space work without custom keys. */
export function CityClarification({ onChoose, onCancel, disabled }: CityClarificationProps) {
  const { t } = useI18n();
  return (
    <div role="group" aria-label={t.chat.cityChoiceLabel} className="mt-2 flex flex-wrap gap-2">
      {PILOT_CITIES.map((slug) => (
        <Button key={slug} variant="outline" className="px-4" disabled={disabled} onClick={() => onChoose(slug)}>
          {CITY_PAGES[slug].name}
        </Button>
      ))}
      <Button variant="ghost" className="px-4" disabled={disabled} onClick={onCancel}>
        {t.chat.cityChoiceCancel}
      </Button>
    </div>
  );
}
