import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm transition-colors",
        "placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#10B981] focus:border-transparent",
        "dark:bg-gray-800 dark:border-gray-600 dark:text-white",
        className
      )}
      ref={ref}
      {...props}
    />
  )
);
Input.displayName = "Input";

export { Input };
