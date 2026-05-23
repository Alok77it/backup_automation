import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, label, id, ...props }, ref) => {
  const input = (
    <input
      type={type}
      id={id}
      className={cn(
        "flex h-10 w-full rounded-xl border border-emerald-200 bg-white px-4 py-2 text-sm text-foreground transition-colors",
        "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500",
        className
      )}
      ref={ref}
      {...props}
    />
  );
  if (!label) return input;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {input}
    </div>
  );
});
Input.displayName = "Input";

export { Input };
