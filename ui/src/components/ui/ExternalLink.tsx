import type { ReactNode } from "react";
import { ExternalLink as ExternalLinkIcon } from "lucide-react";
import { useI18n } from "@/i18n/LanguageContext";
import { cn } from "@/lib/utils";

/** Consistent treatment for every link that leaves the application. */
export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const { t } = useI18n();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-1 font-medium text-primary underline decoration-primary/35 decoration-1 underline-offset-[3px] transition-colors hover:text-primary-hover hover:decoration-current",
        className,
      )}
    >
      <span>{children}</span>
      <ExternalLinkIcon className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
      <span className="sr-only"> {t.meta.opensInNewTab}</span>
    </a>
  );
}
