import { cn } from "@/lib/utils";

/** Oberfranken logo (traced from the supplied artwork) paired with the product name. */
export function Wordmark({ suffix, size = "md" }: { suffix?: string; size?: "md" | "sm" }) {
  return (
    <span className="inline-flex items-center gap-3">
      <img
        src="/logo.svg"
        alt=""
        width={size === "md" ? 64 : 52}
        height={size === "md" ? 51 : 41}
        className={cn("shrink-0", size === "md" ? "h-[51px] w-16" : "h-[41px] w-[52px]")}
      />
      <span className="flex flex-col leading-tight">
        <span className="font-serif text-[1.375rem] leading-none text-foreground">Mein Oberfranken</span>
        {suffix && <span className="mt-1 text-[0.8125rem] text-muted-foreground">{suffix}</span>}
      </span>
    </span>
  );
}
