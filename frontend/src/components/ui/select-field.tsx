import { cn } from "@/lib/utils";

interface SelectFieldProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string; hint?: string;
}

export function SelectField({ label, hint, className, children, ...props }: SelectFieldProps) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-[11px] font-medium uppercase tracking-wide"
          style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#bdb8c0" }}>
          {label}
        </label>
      )}
      <select
        className={cn(
          "flex h-10 w-full rounded-[4px] border bg-[#150f23] px-3 py-2 text-sm text-white",
          "focus:outline-none focus:ring-1 focus:ring-[#c2ef4e] focus:border-[#c2ef4e]",
          "disabled:cursor-not-allowed disabled:opacity-40", className
        )}
        style={{ borderColor: "#362d59" }}
        {...props}>{children}
      </select>
      {hint && <p className="text-[11px]" style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#bdb8c0" }}>{hint}</p>}
    </div>
  );
}
