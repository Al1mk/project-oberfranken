import { Link, NavLink } from "react-router";
import { TownIndex } from "@/features/explorer/TownIndex";
import { useI18n } from "@/i18n/LanguageContext";
import { cn } from "@/lib/utils";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { Wordmark } from "./Wordmark";

const navLink =
  "inline-flex h-11 items-center rounded-md px-3 text-[0.9375rem] font-medium text-foreground-soft transition-colors hover:text-foreground";

export function SiteHeader() {
  const { t } = useI18n();
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="container-page grid h-(--header-height) grid-cols-[1fr_auto_1fr] items-center">
        <Link to="/" aria-label={t.nav.homeLinkLabel} className="justify-self-start rounded-md">
          <Wordmark suffix={t.meta.productSuffix} />
        </Link>

        <nav aria-label={t.nav.label}>
          <ul className="flex items-center gap-1">
            <li>
              <NavLink
                to="/"
                end
                className={({ isActive }) => cn(navLink, isActive && "text-foreground underline decoration-primary decoration-2 underline-offset-[10px]")}
              >
                {t.nav.home}
              </NavLink>
            </li>
            <li>
              <TownIndex variant="nav" label={t.nav.explore} align="center" />
            </li>
            <li>
              <Link to="/#about" className={navLink}>
                {t.nav.about}
              </Link>
            </li>
          </ul>
        </nav>

        <div className="justify-self-end">
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}
