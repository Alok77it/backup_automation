import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> { label?: string; }

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, label, id, ...props }, ref) => {
  const input = (
    <input type={type} id={id}
      className={cn(
        "flex h-10 w-full rounded-[4px] border bg-[#150f23] px-4 py-2 text-sm text-white transition-colors",
        "placeholder:text-[#3f3849]",
        "focus:outline-none focus:ring-1 focus:ring-[#c2ef4e] focus:border-[#c2ef4e]",
        "disabled:cursor-not-allowed disabled:opacity-40", className
      )}
      style={{ borderColor: "#362d59" }}
      ref={ref} {...props} />
  );
  if (!label) return input;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[11px] font-medium uppercase tracking-wide"
        style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#bdb8c0" }}>
        {label}
      </label>
      {input}
    </div>
  );
});
Input.displayName = "Input";
export { Input };
