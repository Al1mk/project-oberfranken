import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CATALOG, DISCOVERY_ANCHORS, DISCOVERY_CATEGORIES, getCitiesWithCategory, getDiscovery, type Catalog, type DiscoveryCategory } from "@/data/catalog";
import { getCityPage } from "@/data/cityPages";
import { useI18n } from "@/i18n/LanguageContext";

type Step = "categories" | "cities";

const itemStyles =
  "flex w-full items-center justify-between gap-4 rounded-md px-3 py-3 text-left font-serif text-[1.25rem] leading-snug text-foreground transition-colors hover:bg-accent";

/**
 * Two-step category discovery: pick a category, then a pilot city. Which cities appear is
 * derived from the verified catalog, never from a hand-written table. Radix Popover supplies
 * Escape, outside click and focus return; navigating moves focus to the destination heading instead.
 */
export function CategoryExplorer({ label, catalog = CATALOG }: { label: string; catalog?: Catalog }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("categories");
  const [category, setCategory] = useState<DiscoveryCategory | null>(null);
  /** The one list item that is a tab stop (roving tabindex); Tab leaves the list from here. */
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const navigating = useRef(false);
  const titleId = useId();
  const hintId = useId();

  const categoryLabel = category ? t.categories.items[category] : "";
  const cities = category ? getCitiesWithCategory(category, catalog) : [];

  function items(): HTMLElement[] {
    return Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-roving]") ?? []);
  }

  /** Tab stop of the current step: the active item if it exists here, else the first. */
  const firstKey = step === "categories" ? DISCOVERY_CATEGORIES[0] : cities[0];
  const tabStopKey = (step === "categories" ? DISCOVERY_CATEGORIES : cities).some((key) => key === activeKey) ? activeKey : (firstKey ?? null);

  // After a step change, put focus where the user expects it: the first city (or Back when there is none), or the category they came from.
  useEffect(() => {
    if (!open) return;
    if (step === "cities") (items()[0] ?? backRef.current)?.focus();
    else if (category) listRef.current?.querySelector<HTMLElement>(`[data-category="${category}"]`)?.focus();
    // Only a step change moves focus; picking a category sets `category` and `step` together.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setStep("categories");
      setCategory(null);
      setActiveKey(null);
    }
  }

  function choose(next: DiscoveryCategory) {
    setCategory(next);
    setStep("cities");
    setActiveKey(null);
  }

  function goBack() {
    // Back lands on the category the user came from, which is also its tab stop.
    setActiveKey(category);
    setStep("categories");
  }

  function handleListKeyDown(event: KeyboardEvent) {
    const all = items();
    if (all.length === 0) return;
    const current = all.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = Math.min(all.length - 1, current + 1);
    else if (event.key === "ArrowUp") next = Math.max(0, current - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = all.length - 1;
    if (next === null) return;
    event.preventDefault();
    all[next]?.focus();
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button ref={triggerRef} variant="outline" size="lg" className="group">
          {label}
          <ChevronDown className="transition-transform duration-200 group-data-[state=open]:rotate-180" aria-hidden="true" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        aria-labelledby={titleId}
        className="max-h-(--radix-popover-content-available-height) w-[min(26rem,calc(100vw-3rem))] overflow-y-auto p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          items()[0]?.focus();
        }}
        onCloseAutoFocus={(event) => {
          // Navigation hands focus to the destination heading. Every other close (Escape, close button,
          // outside click) returns it to the trigger; Radix skips that after an outside click, so do it here.
          event.preventDefault();
          if (navigating.current) navigating.current = false;
          else triggerRef.current?.focus();
        }}
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
          <div className="flex min-w-0 items-center gap-2">
            {step === "cities" && (
              <Button ref={backRef} variant="ghost" size="sm" aria-label={t.categories.back} onClick={goBack}>
                <ArrowLeft aria-hidden="true" />
                {t.categories.backShort}
              </Button>
            )}
            <h2 id={titleId} className="text-[1.375rem] leading-tight">
              {step === "categories" ? t.categories.chooseCategory : t.categories.chooseCity(categoryLabel)}
            </h2>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label={t.categories.close} onClick={() => handleOpenChange(false)}>
            <X aria-hidden="true" />
          </Button>
        </div>

        <p id={hintId} className="sr-only">
          {t.categories.keyboardHint}
        </p>

        <ul ref={listRef} aria-describedby={hintId} className="m-0 list-none px-3 pb-4" onKeyDown={handleListKeyDown}>
          {step === "categories" &&
            DISCOVERY_CATEGORIES.map((item) => (
              <li key={item}>
                <button
                  type="button"
                  data-roving
                  data-category={item}
                  tabIndex={item === tabStopKey ? 0 : -1}
                  onFocus={() => setActiveKey(item)}
                  className={itemStyles}
                  onClick={() => choose(item)}
                >
                  {t.categories.items[item]}
                  <ChevronRight className="size-5 text-primary" aria-hidden="true" />
                </button>
              </li>
            ))}

          {step === "cities" &&
            category &&
            cities.map((slug) => {
              const page = getCityPage(slug);
              if (!page) return null;
              return (
                <li key={slug}>
                  <Link
                    data-roving
                    tabIndex={slug === tabStopKey ? 0 : -1}
                    onFocus={() => setActiveKey(slug)}
                    to={{ pathname: `/${slug}`, hash: `#${DISCOVERY_ANCHORS[category]}` }}
                    className={itemStyles}
                    onClick={() => {
                      navigating.current = true;
                      handleOpenChange(false);
                    }}
                  >
                    <span>
                      {page.name}
                      <span className="block font-sans text-sm text-muted-foreground">{t.categories.cityHint(getDiscovery(slug, category, catalog).length)}</span>
                    </span>
                    <ArrowRight className="size-5 text-primary" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
        </ul>

        <div role="status" className={step === "cities" && cities.length === 0 ? "px-5 pb-5 text-muted-foreground" : "sr-only"}>
          {step === "cities" && cities.length === 0 ? t.categories.empty : ""}
        </div>
      </PopoverContent>
    </Popover>
  );
}
