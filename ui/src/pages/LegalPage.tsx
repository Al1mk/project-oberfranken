import { useEffect } from "react";
import { LEGAL_CONFIG, type LegalField } from "@/data/legalConfig";
import { useI18n } from "@/i18n/LanguageContext";

type LegalKind = "impressum" | "datenschutz";

/** Real contacts remain separate from presentation-only examples. */
const FIELD_VALUES = {
  operatorName: LEGAL_CONFIG.operator.name,
  operatorAddress: LEGAL_CONFIG.operator.address,
  operatorEmail: LEGAL_CONFIG.operator.email,
  operatorPhone: LEGAL_CONFIG.operator.phone,
  privacyContact: LEGAL_CONFIG.privacyContact.email ?? LEGAL_CONFIG.privacyContact.name,
  hostingProvider: LEGAL_CONFIG.hosting.provider,
  hostingCountry: LEGAL_CONFIG.hosting.country,
  accessLogRetention: LEGAL_CONFIG.hosting.accessLogRetention,
} satisfies Record<LegalField, string | null>;

/** Internal draft pages for the presentation demo. They describe only verified behaviour and never invent facts. */
export function LegalPage({ kind }: { kind: LegalKind }) {
  const { t, language } = useI18n();
  const page = t.legal[kind];

  useEffect(() => {
    document.title = `${page.title} · ${t.meta.productName}`;
  }, [page.title, t.meta.productName, language]);

  return (
    <article className="container-page max-w-4xl py-16">
      <h1 className="text-headline">{page.title}</h1>
      <p role="note" className="mt-6 border-l-4 border-primary bg-primary-wash px-5 py-4 text-lg font-semibold text-foreground">
        {t.legal.draftBanner}
      </p>
      <p className="mt-6 max-w-3xl text-lg text-foreground-soft">{page.intro}</p>
      <div className="mt-6 max-w-3xl">
        <p className="font-semibold">{t.legal.projectTitle}</p>
        <p className="mt-2 text-foreground-soft">{t.legal.projectOnly}</p>
      </div>

      {page.sections.map((section, index) => (
        <section key={section.heading} aria-labelledby={`legal-${kind}-${index}`} className="mt-12">
          <h2 id={`legal-${kind}-${index}`} className="text-[1.625rem] leading-snug">
            {section.heading}
          </h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph} className="mt-3 max-w-3xl text-foreground-soft">
              {paragraph}
            </p>
          ))}
          {section.fields && (
            <dl className="mt-4 grid max-w-3xl grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[14rem_minmax(0,1fr)]">
              {section.fields.map((field) => (
                <div key={field} className="contents">
                  <dt className="text-sm font-semibold text-muted-foreground">{t.legal.fieldLabels[field]}</dt>
                  <dd className="m-0 min-w-0 break-words text-foreground-soft">
                    {FIELD_VALUES[field] ?? (field === "operatorName" ? t.legal.operatorPending : t.legal.unset)}
                    {FIELD_VALUES[field] === null && (field === "operatorEmail" || field === "privacyContact") && (
                      <p className="mt-2 text-sm">
                        <span className="block font-semibold">{t.legal.demoEmailLabel}</span>
                        <span className="block">{LEGAL_CONFIG.demo.sampleEmail}</span>
                        <span className="block">{t.legal.demoEmailWarning}</span>
                      </p>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      ))}
    </article>
  );
}
