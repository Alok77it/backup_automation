import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, id, ...props }, ref) => {
    const textarea = (
      <textarea
        id={id}
        className={cn(
          "flex min-h-[80px] w-full rounded-xl border border-emerald-200 bg-white px-4 py-2 text-sm text-foreground transition-colors",
          "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500",
          "resize-y disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
    if (!label) return textarea;
    return (
      <div className="space-y-1.5">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {textarea}
      </div>
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
