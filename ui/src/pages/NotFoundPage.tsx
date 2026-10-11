import { Link } from "react-router";
import { useI18n } from "@/i18n/LanguageContext";

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <section className="container-page grid justify-items-start gap-4 py-24" aria-labelledby="not-found-title">
      <h1 id="not-found-title" className="text-headline">
        {t.notFound.title}
      </h1>
      <p className="text-muted-foreground">{t.notFound.text}</p>
      <Link to="/" className="font-semibold text-primary underline underline-offset-4">
        {t.notFound.back}
      </Link>
    </section>
  );
}
