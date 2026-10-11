import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { ArrowRight, ChevronDown, Clock, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CITIES, ENABLED_CITIES, cityMatchesQuery, displayCityName } from "@/data/cities";
import { CITY_PAGES } from "@/data/cityPages";
import type { City } from "@/data/types";
import { useI18n } from "@/i18n/LanguageContext";
import { cn } from "@/lib/utils";

type TownIndexProps = {
  /** Visual style of the trigger. */
  variant: "cta" | "nav" | "secondary";
  label: string;
  align?: "start" | "center" | "end";
};

const COLUMNS = 4;


const triggerStyles = {
  cta: "",
  secondary: "",
  nav: "inline-flex h-11 items-center gap-1 rounded-md px-3 text-[0.9375rem] font-medium text-foreground-soft transition-colors hover:text-foreground data-[state=open]:text-foreground",
} as const;

/**
 * The town index: an expandable directory of all 53 towns in Oberfranken.
 * Radix Popover (via shadcn/ui) provides outside-click, Escape, focus return and
 * aria-expanded; the list itself is a single tab stop with arrow-key navigation.
 */
export function TownIndex({ variant, label, align = "start" }: TownIndexProps) {
  const { t, localize } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [comingSoon, setComingSoon] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const titleId = useId();
  const hintId = useId();

  const filtered = useMemo(() => CITIES.filter((city) => cityMatchesQuery(city, query)), [query]);
  const tabStopId = filtered.some((city) => city.id === activeId) ? activeId : (filtered[0]?.id ?? null);
  /** Towns run A to Z down each column, so the grid has this many rows. */
  const rows = Math.ceil(filtered.length / COLUMNS);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setQuery("");
      setComingSoon(null);
      setActiveId(null);
    }
  }

  function focusItem(id: string | undefined) {
    if (!id) return;
    setActiveId(id);
    itemRefs.current.get(id)?.focus();
  }

  function handleListKeyDown(event: KeyboardEvent) {
    if (filtered.length === 0) return;
    const index = Math.max(0, filtered.findIndex((city) => city.id === tabStopId));
    const last = filtered.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowDown") next = Math.min(last, index + 1);
    else if (event.key === "ArrowUp") next = Math.max(0, index - 1);
    else if (event.key === "ArrowRight") next = Math.min(last, index + rows);
    else if (event.key === "ArrowLeft") next = Math.max(0, index - rows);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next === null) return;
    event.preventDefault();
    focusItem(filtered[next]?.id);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(tabStopId ?? undefined);
    } else if (event.key === "Enter" && filtered.length === 1) {
      event.preventDefault();
      itemRefs.current.get(filtered[0]!.id)?.click();
    }
  }

  function register(id: string) {
    return (element: HTMLElement | null) => {
      if (element) itemRefs.current.set(id, element);
      else itemRefs.current.delete(id);
    };
  }

  function renderTown(city: City) {
    const shared = {
      ref: register(city.id),
      tabIndex: city.id === tabStopId ? 0 : -1,
      onFocus: () => setActiveId(city.id),
    };
    const base =
      "block w-full rounded-sm px-2 py-0.5 text-left font-serif text-[1.0625rem] leading-snug whitespace-nowrap transition-colors focus-visible:outline-offset-0";
    if (city.enabled && city.slug) {
      return (
        <Link
          {...shared}
          to={`/${city.slug}`}
          onClick={() => handleOpenChange(false)}
          className={cn(base, "text-primary underline decoration-primary/40 decoration-1 underline-offset-4 hover:decoration-primary")}
        >
          {displayCityName(city.name)}{" "}
          <span className="sr-only">{t.explorer.availableTag}</span>
        </Link>
      );
    }
    const selected = comingSoon === city.name;
    return (
      <button
        {...shared}
        type="button"
        onClick={() => setComingSoon(city.name)}
        aria-describedby={selected ? `${hintId}-status` : undefined}
        className={cn(base, "text-foreground-soft hover:bg-accent hover:text-foreground", selected && "bg-surface-cool text-foreground")}
      >
        {displayCityName(city.name)}{" "}
        <span className="sr-only">{t.explorer.soonTag}</span>
      </button>
    );
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        {variant === "nav" ? (
          <button type="button" className={triggerStyles.nav}>
            {label}
            <ChevronDown className="size-4 transition-transform duration-200 in-data-[state=open]:rotate-180" aria-hidden="true" />
          </button>
        ) : (
          <Button variant={variant === "cta" ? "default" : "outline"} size={variant === "cta" ? "lg" : "default"} className="group">
            {label}
            <ChevronDown className="transition-transform duration-200 group-data-[state=open]:rotate-180" aria-hidden="true" />
          </Button>
        )}
      </PopoverTrigger>

      <PopoverContent align={align} aria-labelledby={titleId} className="max-h-(--radix-popover-content-available-height) w-[min(72rem,calc(100vw-3rem))] overflow-y-auto p-0">
        <div className="flex items-start justify-between gap-6 px-8 pt-7 pb-5">
          <div>
            <h2 id={titleId} className="text-[1.75rem] leading-tight">
              {t.explorer.title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{t.explorer.subtitle(CITIES.length, ENABLED_CITIES.length)}</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="relative block">
              <span className="sr-only">{t.explorer.filterLabel}</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                type="search"
                value={query}
                placeholder={t.explorer.filterPlaceholder}
                autoComplete="off"
                spellCheck={false}
                className="w-72 pl-9"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setComingSoon(null);
                }}
                onKeyDown={handleInputKeyDown}
              />
            </label>
            <Button variant="ghost" size="icon" aria-label={t.explorer.close} onClick={() => handleOpenChange(false)}>
              <X aria-hidden="true" />
            </Button>
          </div>
        </div>

        <section aria-label={t.explorer.available} className="px-8 pb-6">
          <h3 className="mb-3 font-sans text-sm font-medium text-muted-foreground" aria-hidden="true">
            {t.explorer.available}
          </h3>
          <ul className="grid grid-cols-2 gap-4">
            {ENABLED_CITIES.map((city) => {
              const page = city.slug ? CITY_PAGES[city.slug] : undefined;
              if (!page) return null;
              return (
                <li key={city.id}>
                  <Link
                    to={`/${page.slug}`}
                    onClick={() => handleOpenChange(false)}
                    className="group/row grid grid-cols-[6rem_1fr_auto] items-center gap-5 rounded-md p-2 pr-4 transition-colors hover:bg-accent"
                  >
                    <img src={page.photo.src} alt="" width={96} height={72} className="h-[4.5rem] w-24 object-cover" />
                    <span>
                      <span className="block font-serif text-[1.75rem] leading-tight text-foreground">{page.name}</span>
                      <span className="block text-sm text-muted-foreground">{localize(page.tagline)}</span>
                    </span>
                    <ArrowRight className="size-5 text-primary transition-transform duration-150 group-hover/row:translate-x-1" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-label={t.explorer.allTowns(CITIES.length)} aria-describedby={hintId} className="border-t border-border-cool bg-accent px-8 pt-5 pb-7">
          <h3 className="mb-3 font-sans text-sm font-medium text-muted-foreground" aria-hidden="true">
            {t.explorer.allTowns(CITIES.length)}
          </h3>
          <p id={hintId} className="sr-only">
            {t.explorer.keyboardHint}
          </p>
          {filtered.length === 0 ? (
            <p className="py-4 text-muted-foreground">{t.explorer.noResults(query.trim())}</p>
          ) : (
            <ul
              className="grid grid-flow-col gap-x-6 gap-y-0.5"
              style={{ gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, auto)` }}
              onKeyDown={handleListKeyDown}
            >
              {filtered.map((city) => (
                <li key={city.id}>{renderTown(city)}</li>
              ))}
            </ul>
          )}
        </section>

        <div
          id={`${hintId}-status`}
          role="status"
          aria-live="polite"
          className={cn(
            "flex items-center gap-2 rounded-b-lg px-8 text-sm font-medium text-foreground-soft",
            comingSoon && "border-t border-border-cool py-3.5",
          )}
        >
          {comingSoon && (
            <>
              <Clock className="size-4 text-primary" aria-hidden="true" />
              <span>{t.explorer.comingSoon(comingSoon)}</span>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
