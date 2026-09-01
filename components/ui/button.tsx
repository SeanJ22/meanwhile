import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // The one loud control on the screen: submit the zip.
        signal:
          // ITEM J (2026-09-01): the hover was a literal #ffc23c — AMBER, left
          // behind by the palette pass that made --signal cyan ("the brown dies",
          // 2026-08-16). The one loud control on the screen changed hue on hover.
          // It is now a lighter mix of the SAME token, so it cannot drift again.
          "bg-signal text-ink hover:bg-[color-mix(in_srgb,var(--action)_82%,white)] font-display font-semibold tracking-tight",
        outline:
          "border border-rule bg-transparent text-paper-dim hover:border-signal-dim hover:text-paper",
        ghost: "text-paper-dim hover:bg-ink-raised hover:text-paper",
      },
      size: {
        default: "h-11 px-5 text-sm",
        sm: "h-8 px-3 text-xs",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "signal",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return (
    <button
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
