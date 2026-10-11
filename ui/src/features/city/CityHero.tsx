import { Link } from "react-router";
import { ChevronRight, Info, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhotoFigure } from "@/components/ui/PhotoFigure";
import type { CityPageData } from "@/data/types";
import { useI18n } from "@/i18n/LanguageContext";
import { useChat } from "../chat/ChatContext";
import { TownIndex } from "../explorer/TownIndex";

export type CitySectionLink = { id: string; label: string };

export function CityHero({ city, sections }: { city: CityPageData; sections: CitySectionLink[] }) {
  const { t, localize } = useI18n();
  const { open } = useChat();

  return (
    <section aria-labelledby="city-title">
      <div className="container-page pt-10 pb-20">
        <nav aria-label={t.city.breadcrumb}>
          <ol className="flex items-center gap-2 text-sm text-muted-foreground">
            <li>
              <Link to="/" className="underline decoration-1 underline-offset-4 hover:text-foreground">
                {t.city.home}
              </Link>
            </li>
            <li aria-hidden="true">
              <ChevronRight className="size-3.5" />
            </li>
            <li>
              <span aria-current="page" className="text-foreground">
                {city.name}
              </span>
            </li>
          </ol>
        </nav>

        <div className="mt-10 grid grid-cols-12 items-center gap-x-12">
          <div className="col-span-6">
            <h1 id="city-title" className="text-display">
              {city.name}
            </h1>
            <p className="mt-5 font-serif text-[1.75rem] leading-snug text-foreground-soft">{localize(city.tagline)}</p>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-foreground-soft">{localize(city.intro)}</p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Button onClick={open}>
                <MessageCircle aria-hidden="true" />
                {t.city.askAssistant}
              </Button>
              <TownIndex variant="secondary" label={t.explorer.otherTowns} align="start" />
            </div>
          </div>

          <div className="col-span-6">
            <div className="relative">
              {/* light-blue offset block: echoes the blue layer behind the Oberfranken logo */}
              <span aria-hidden="true" className="absolute inset-0 translate-x-5 translate-y-5 bg-brand-sky" />
              <PhotoFigure photo={city.photo} priority className="relative" imgClassName="aspect-[4/3]" captionClassName="hidden" />
            </div>
            <p className="mt-8 text-right text-xs text-muted-foreground">
              {t.photo.credit(city.photo.author, city.photo.license)},{" "}
              <a href={city.photo.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-1 underline-offset-2 hover:text-foreground">
                {t.photo.viaCommons}
                <span className="sr-only"> {t.meta.opensInNewTab}</span>
              </a>
            </p>
          </div>
        </div>
      </div>

      <nav aria-label={t.city.onThisPage} className="border-y border-border">
        <div className="container-page flex min-h-14 items-center gap-6">
          <span className="text-sm text-muted-foreground">{t.city.onThisPage}</span>
          <ul className="flex gap-1">
            {sections.map((section) => (
              <li key={section.id}>
                {/* A router Link, not a plain anchor: AppLayout scrolls to the hash and focuses the heading. */}
                <Link
                  to={{ hash: `#${section.id}` }}
                  className="inline-flex h-10 items-center rounded-md px-3 text-sm font-medium text-foreground-soft transition-colors hover:bg-accent hover:text-foreground"
                >
                  {section.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <div className="container-page">
        <div className="flex flex-col gap-1 py-5 text-sm text-muted-foreground">
          <p className="flex items-start gap-2">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t.city.dataNotice}
          </p>
          <p className="pl-6">{t.city.freshnessNotice}</p>
        </div>
      </div>
    </section>
  );
}
