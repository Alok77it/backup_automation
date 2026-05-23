"use client";

import { X, AlertCircle, CheckCircle2 } from "lucide-react";

export function AlertBanner({
  type = "error",
  message,
  onClose,
}: {
  type?: "error" | "success" | "info";
  message: string;
  onClose?: () => void;
}) {
  if (!message) return null;
  const styles = {
    error: "bg-red-50 border-red-200 text-red-800",
    success: "bg-emerald-50 border-emerald-200 text-emerald-800",
    info: "bg-white border-emerald-200 text-emerald-900",
  };
  const Icon = type === "success" ? CheckCircle2 : AlertCircle;
  return (
    <div className={`mb-4 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${styles[type]}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="flex-1">{message}</p>
      {onClose && (
        <button type="button" onClick={onClose} className="opacity-70 hover:opacity-100">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
