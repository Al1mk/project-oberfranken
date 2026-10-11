import * as React from "react";
import { cn } from "@/lib/utils";

/** shadcn/ui Input, restyled: taller, quiet border, crimson border on focus. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-[0.9375rem] transition-colors outline-none",
        "placeholder:text-muted-foreground hover:border-muted-foreground focus-visible:border-primary focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
