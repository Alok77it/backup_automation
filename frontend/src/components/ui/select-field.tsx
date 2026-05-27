import { cn } from "@/lib/utils";

interface SelectFieldProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
}

export function SelectField({ label, hint, className, children, ...props }: SelectFieldProps) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label
          className="block text-[11px] font-medium uppercase tracking-wide text-[#797979]"
          style={{ fontFamily: "'IBM Plex Mono', monospace" }}
        >
          {label}
        </label>
      )}
      <select
        className={cn(
          "flex h-10 w-full rounded-[3px] border bg-[#0b0b0b] px-3 py-2 text-sm text-[#b9b9b9]",
          "focus:outline-none focus:ring-1 focus:ring-[#f36458] focus:border-[#f36458]",
          "disabled:cursor-not-allowed disabled:opacity-40",
          className
        )}
        style={{ borderColor: "#353535" }}
        {...props}
      >
        {children}
      </select>
      {hint && (
        <p className="text-[11px] text-[#797979]" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
          {hint}
        </p>
      )}
    </div>
  );
}
