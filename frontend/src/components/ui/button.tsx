import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c2ef4e] focus-visible:ring-offset-2 focus-visible:ring-offset-[#150f23] disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default:     "rounded-[5px] bg-[#c2ef4e] text-[#150f23] hover:bg-[#d4f76a] shadow-sm",
        secondary:   "rounded-[5px] bg-[#2d2540] text-[#bdb8c0] hover:bg-[#3a3150] border border-[#362d59]",
        outline:     "rounded-[5px] border border-[#362d59] bg-transparent text-[#bdb8c0] hover:bg-[#2d2540] hover:text-white",
        ghost:       "rounded-[5px] bg-transparent text-[#bdb8c0] hover:bg-[#2d2540] hover:text-white",
        destructive: "rounded-[5px] bg-[#f04646] text-white hover:bg-[#d93a3a]",
        violet:      "rounded-[5px] bg-[#6a5fc1] text-white hover:bg-[#7b6fd4]",
        link:        "rounded-none underline-offset-4 hover:underline text-[#9dc1f5] bg-transparent",
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

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>,
  VariantProps<typeof buttonVariants> { asChild?: boolean; }

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";
export { Button, buttonVariants };
