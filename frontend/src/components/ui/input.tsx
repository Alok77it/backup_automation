import * as React from "react";
import { cn } from "@/lib/utils";

/*
  Sanity design system — text-input-dark
  background: #0b0b0b (canvas)
  text:       #b9b9b9 (ash)
  border:     1px solid #353535
  radius:     3px (app-xs)
  height:     40px
*/

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, label, id, ...props }, ref) => {
    const input = (
      <input
        type={type}
        id={id}
        className={cn(
          "flex h-10 w-full rounded-[3px] border bg-[#0b0b0b] px-4 py-2 text-sm text-[#b9b9b9] transition-colors",
          "placeholder:text-[#797979]",
          "focus:outline-none focus:ring-1 focus:ring-[#f36458] focus:border-[#f36458]",
          "disabled:cursor-not-allowed disabled:opacity-40",
          className
        )}
        style={{ borderColor: "#353535" }}
        ref={ref}
        {...props}
      />
    );
    if (!label) return input;
    return (
      <div className="space-y-1.5">
        <label
          htmlFor={id}
          className="text-xs font-medium text-[#b9b9b9] uppercase tracking-wide"
          style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "11px" }}
        >
          {label}
        </label>
        {input}
      </div>
    );
  }
);
Input.displayName = "Input";

export { Input };
