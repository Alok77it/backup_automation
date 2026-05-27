import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/*
  Sanity design system badges
  default   → white pill (badge-neutral)
  filled    → black pill (badge-filled)
  secondary → graphite surface
  success   → success green, dark text
  warning   → amber
  error/destructive → brand-deep red
  info      → surface-blue-bg
  outline   → border only
*/

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors whitespace-nowrap",
  {
    variants: {
      variant: {
        default:     "bg-white text-[#0b0b0b]",
        filled:      "bg-[#0b0b0b] text-white border border-[#353535]",
        secondary:   "bg-[#353535] text-[#b9b9b9]",
        success:     "bg-[#37cd84]/15 text-[#37cd84]",
        warning:     "bg-amber-500/15 text-amber-300",
        error:       "bg-[#dd0000]/15 text-red-400",
        destructive: "bg-[#dd0000]/15 text-red-400",
        info:        "bg-[#afe3ff]/15 text-[#55beff]",
        outline:     "border border-[#353535] text-[#b9b9b9] bg-transparent",
        brand:       "bg-[#f36458]/15 text-[#f36458]",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
