import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/*
  Sanity design system buttons
  ─────────────────────────────────────────────────────────────────────────────
  default   → button-primary-on-light: #0b0b0b bg, white text, pill (full)
  brand     → button-brand:            #f36458 bg, #0b0b0b text, pill
  secondary → button-secondary-dark:   #212121 bg, ash text, 5px radius
  outline   → border #353535, ash text, 5px radius
  ghost     → transparent, ash text, no border
  destructive → #dd0000 bg
*/

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f36458] focus-visible:ring-offset-1 focus-visible:ring-offset-[#0b0b0b] disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default:
          "rounded-full bg-white text-[#0b0b0b] hover:bg-[#ededed] border border-[#353535] shadow-sm",
        brand:
          "rounded-full bg-[#f36458] text-[#0b0b0b] hover:bg-[#e05448] shadow-sm",
        secondary:
          "rounded-[5px] bg-[#212121] text-[#b9b9b9] hover:bg-[#2a2a2a] border border-[#353535]",
        outline:
          "rounded-[5px] border border-[#353535] bg-transparent text-[#b9b9b9] hover:bg-[#212121] hover:text-white",
        ghost:
          "rounded-[5px] bg-transparent text-[#797979] hover:bg-[#212121] hover:text-[#b9b9b9]",
        destructive:
          "rounded-[5px] bg-[#dd0000] text-white hover:bg-[#c20000]",
        link:
          "rounded-none underline-offset-4 hover:underline text-[#55beff] bg-transparent",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm:      "h-8 px-3 text-xs",
        lg:      "h-11 px-8 text-base",
        icon:    "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
