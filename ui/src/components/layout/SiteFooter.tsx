import { Link } from "react-router";
import { PHOTOS } from "@/data/photos";
import { usePrivacy } from "@/features/privacy/PrivacyContext";
import { useI18n } from "@/i18n/LanguageContext";
import { Wordmark } from "./Wordmark";

export function SiteFooter() {
  const { t } = useI18n();
  const { openSettings } = usePrivacy();
  return (
    <footer className="border-t border-border bg-background">
      <div className="container-page grid grid-cols-[auto_1fr] items-start gap-16 py-12">
        <Wordmark size="sm" suffix={t.meta.productSuffix} />
        <div className="grid max-w-3xl gap-4 text-sm text-muted-foreground">
          <p>
            {t.footer.note} {t.footer.future}
          </p>
          <nav aria-label={t.footer.legalNav}>
            <ul className="flex flex-wrap gap-x-6 gap-y-1">
              <li>
                <Link to="/impressum" className="underline decoration-1 underline-offset-2 hover:text-foreground">
                  Impressum
                </Link>
              </li>
              <li>
                <Link to="/datenschutz" className="underline decoration-1 underline-offset-2 hover:text-foreground">
                  {t.footer.privacyLink}
                </Link>
              </li>
              <li>
                <button type="button" data-privacy-footer-trigger onClick={(event) => openSettings(event.currentTarget)} className="underline decoration-1 underline-offset-2 hover:text-foreground">
                  {t.privacy.footerSettings}
                </button>
              </li>
            </ul>
          </nav>
          <p>
            <span className="font-semibold text-foreground-soft">{t.footer.photos}:</span>{" "}
            {Object.values(PHOTOS).map((photo, index) => (
              <span key={photo.src}>
                {index > 0 && "; "}
                <a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-1 underline-offset-2 hover:text-foreground">
                  {photo.author}
                  <span className="sr-only"> {t.meta.opensInNewTab}</span>
                </a>{" "}
                ({photo.license})
              </span>
            ))}
            , Wikimedia Commons.
          </p>
        </div>
      </div>
    </footer>
  );
}
