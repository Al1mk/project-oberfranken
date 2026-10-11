import { Link } from "react-router";
import { ArrowRight, MapPin } from "lucide-react";
import { PhotoFigure } from "@/components/ui/PhotoFigure";
import { CITY_PAGES } from "@/data/cityPages";
import { PHOTOS } from "@/data/photos";
import { CategoryExplorer } from "@/features/explorer/CategoryExplorer";
import { TownIndex } from "@/features/explorer/TownIndex";
import { useI18n } from "@/i18n/LanguageContext";

const DISCOVER_KEYS = ["culture", "activities", "official"] as const;

export function LandingPage() {
  const { t, localize } = useI18n();

  return (
    <>
      <section aria-labelledby="hero-title">
        <PhotoFigure
          photo={PHOTOS.region}
          priority
          className="w-full"
          imgClassName="h-[min(31rem,52vh)] object-[50%_62%]"
          captionClassName="container-page"
        />
        <div className="container-page grid grid-cols-12 gap-x-10 pt-8 pb-24">
          <div className="col-span-7">
            <p className="text-lg text-muted-foreground">{t.hero.kicker}</p>
            <h1 id="hero-title" className="mt-4 text-display">
              Mein Oberfranken
            </h1>
          </div>
          <div className="col-span-5 self-end pb-2">
            <p className="text-lg leading-relaxed text-foreground-soft">{t.hero.lead}</p>
            <div className="mt-7 flex flex-col items-start gap-3">
              <TownIndex variant="cta" label={t.hero.cta} align="start" />
              <CategoryExplorer label={t.hero.categories} />
            </div>
            <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="size-4 text-primary" aria-hidden="true" />
              {t.hero.pilotNote}
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="discover-title" className="border-t border-border py-24">
        <div className="container-page grid grid-cols-12 gap-x-10">
          <div className="col-span-4">
            <h2 id="discover-title" className="text-title">
              {t.discover.title}
            </h2>
            <p className="mt-4 max-w-sm text-muted-foreground">{t.discover.intro}</p>
          </div>
          <dl className="col-span-8 m-0">
            {DISCOVER_KEYS.map((key) => (
              <div key={key} className="grid grid-cols-[18rem_1fr] gap-8 border-t border-border py-7 first:border-t-0 first:pt-1">
                <dt className="font-serif text-[1.625rem] leading-snug">{t.discover.items[key].title}</dt>
                <dd className="m-0 text-foreground-soft">{t.discover.items[key].text}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="about" aria-labelledby="about-title" className="bg-surface-cool py-24">
        <div className="container-page">
          <div className="grid grid-cols-12 gap-x-10">
            <h2 id="about-title" className="col-span-4 text-title">
              {t.pilot.title}
            </h2>
            <p className="col-span-6 col-start-6 text-foreground-soft">{t.pilot.text}</p>
          </div>

          <ul className="mt-14 grid grid-cols-2 gap-10">
            {Object.values(CITY_PAGES).map((city) => (
              <li key={city.slug}>
                <Link to={`/${city.slug}`} aria-label={t.pilot.openCity(city.name)} className="group block rounded-sm">
                  <img
                    src={city.photo.src}
                    width={city.photo.width}
                    height={city.photo.height}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="aspect-[3/2] w-full object-cover"
                  />
                  <span className="mt-5 flex items-end justify-between gap-6">
                    <span>
                      <span className="block font-serif text-headline group-hover:underline group-hover:decoration-1 group-hover:underline-offset-8">
                        {city.name}
                      </span>
                      <span className="mt-2 block text-muted-foreground">{localize(city.tagline)}</span>
                    </span>
                    <ArrowRight className="mb-2 size-6 shrink-0 text-primary transition-transform duration-150 group-hover:translate-x-1" aria-hidden="true" />
                  </span>
                </Link>
                <p className="mt-2 text-xs text-muted-foreground">{t.photo.credit(city.photo.author, city.photo.license)}</p>
              </li>
            ))}
          </ul>

          <p className="mt-12 text-sm text-muted-foreground">{t.pilot.roadmap}</p>
        </div>
      </section>
    </>
  );
}
