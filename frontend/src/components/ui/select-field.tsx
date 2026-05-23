import { cn } from "@/lib/utils";

interface SelectFieldProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
}

export function SelectField({ label, hint, className, children, ...props }: SelectFieldProps) {
  return (
    <div className="space-y-1.5">
      {label && <label className="text-sm font-medium text-foreground">{label}</label>}
      <select
        className={cn(
          "flex h-10 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm text-foreground",
          "focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500",
          "dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-50",
          className
        )}
        {...props}
      >
        {children}
      </select>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
