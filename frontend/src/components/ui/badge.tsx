import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap transition-colors",
  {
    variants: {
      variant: {
        default:     "bg-[#c2ef4e]/15 text-[#c2ef4e]",
        filled:      "bg-[#c2ef4e] text-[#150f23] font-semibold",
        secondary:   "bg-[#2d2540] text-[#bdb8c0] border border-[#362d59]",
        success:     "bg-[#4dc771]/15 text-[#4dc771]",
        warning:     "bg-amber-500/15 text-amber-300",
        error:       "bg-[#f04646]/15 text-red-400",
        destructive: "bg-[#f04646]/15 text-red-400",
        info:        "bg-[#9dc1f5]/15 text-[#9dc1f5]",
        outline:     "border border-[#362d59] text-[#bdb8c0] bg-transparent",
        violet:      "bg-[#6a5fc1]/20 text-[#9d95e0]",
        pink:        "bg-[#fa7faa]/15 text-[#fa7faa]",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
