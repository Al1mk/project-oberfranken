import type { Photo } from "@/data/photos";
import { useI18n } from "@/i18n/LanguageContext";
import { cn } from "@/lib/utils";

type PhotoFigureProps = {
  photo: Photo;
  className?: string;
  imgClassName?: string;
  priority?: boolean;
  /** Where the credit line sits. */
  creditAlign?: "left" | "right";
  captionClassName?: string;
};

/** Author, licence and source link of a photo (required for CC BY-SA). */
export function PhotoCredit({ photo }: { photo: Photo }) {
  const { t } = useI18n();
  return (
    <>
      {t.photo.credit(photo.author, photo.license)},{" "}
      <a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-1 underline-offset-2 hover:text-foreground">
        {t.photo.viaCommons}
        <span className="sr-only"> {t.meta.opensInNewTab}</span>
      </a>
    </>
  );
}

/** Photo with its required author / licence credit. */
export function PhotoFigure({ photo, className, imgClassName, priority = false, creditAlign = "right", captionClassName }: PhotoFigureProps) {
  const { localize } = useI18n();
  return (
    <figure className={cn("m-0", className)}>
      <img
        src={photo.src}
        width={photo.width}
        height={photo.height}
        alt={localize(photo.alt)}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={priority ? "high" : "auto"}
        className={cn("block h-full w-full bg-surface-cool object-cover", imgClassName)}
      />
      <figcaption className={cn("mt-2 text-xs text-muted-foreground", creditAlign === "right" && "text-right", captionClassName)}>
        <PhotoCredit photo={photo} />
      </figcaption>
    </figure>
  );
}
