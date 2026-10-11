import { useEffect } from "react";
import { CITY_PAGES } from "../data/cityPages";
import type { CitySlug } from "../data/types";
import { CityPageTemplate } from "../features/city/CityPageTemplate";
import { useI18n } from "../i18n/LanguageContext";

export function CityPage({ slug }: { slug: CitySlug }) {
  const { t } = useI18n();
  const city = CITY_PAGES[slug];

  useEffect(() => {
    document.title = `${city.name} · ${t.meta.productName}`;
  }, [city.name, t.meta.productName]);

  return <CityPageTemplate city={city} />;
}
