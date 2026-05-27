import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> { label?: string; }

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, label, id, ...props }, ref) => {
  const ta = (
    <textarea id={id}
      className={cn(
        "flex min-h-[80px] w-full rounded-[4px] border bg-[#150f23] px-4 py-2.5 text-sm text-white transition-colors",
        "placeholder:text-[#3f3849]",
        "focus:outline-none focus:ring-1 focus:ring-[#c2ef4e] focus:border-[#c2ef4e]",
        "resize-y disabled:cursor-not-allowed disabled:opacity-40", className
      )}
      style={{ borderColor: "#362d59" }}
      ref={ref} {...props} />
  );
  if (!label) return ta;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[11px] font-medium uppercase tracking-wide"
        style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#bdb8c0" }}>
        {label}
      </label>
      {ta}
    </div>
  );
});
Textarea.displayName = "Textarea";
export { Textarea };
