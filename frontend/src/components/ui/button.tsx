import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#10B981] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "gradient-primary text-white shadow-md hover:shadow-lg hover:shadow-emerald-500/25",
        secondary: "bg-[#F3F4F6] text-[#1F2937] hover:bg-gray-200 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600",
        outline: "border border-[#10B981] text-[#047857] hover:bg-[#D1FAE5] dark:text-emerald-400 dark:hover:bg-emerald-950",
        ghost: "hover:bg-[#D1FAE5] text-[#047857] dark:hover:bg-emerald-950 dark:text-emerald-400",
        destructive: "bg-red-500 text-white hover:bg-red-600",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-12 rounded-2xl px-8 text-base",
        icon: "h-10 w-10",
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
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
