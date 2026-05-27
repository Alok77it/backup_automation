import * as React from "react";
import { cn } from "@/lib/utils";

/*
  Sanity design system — textarea (dark variant)
  background: #0b0b0b (canvas)
  text:       #b9b9b9 (ash)
  border:     1px solid #353535
  radius:     3px (app-xs)
*/

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, id, ...props }, ref) => {
    const textarea = (
      <textarea
        id={id}
        className={cn(
          "flex min-h-[80px] w-full rounded-[3px] border bg-[#0b0b0b] px-4 py-2.5 text-sm text-[#b9b9b9] transition-colors",
          "placeholder:text-[#797979]",
          "focus:outline-none focus:ring-1 focus:ring-[#f36458] focus:border-[#f36458]",
          "resize-y disabled:cursor-not-allowed disabled:opacity-40",
          className
        )}
        style={{ borderColor: "#353535" }}
        ref={ref}
        {...props}
      />
    );
    if (!label) return textarea;
    return (
      <div className="space-y-1.5">
        <label
          htmlFor={id}
          className="block text-[11px] font-medium uppercase tracking-wide text-[#797979]"
          style={{ fontFamily: "'IBM Plex Mono', monospace" }}
        >
          {label}
        </label>
        {textarea}
      </div>
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
