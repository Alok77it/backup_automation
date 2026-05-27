"use client";

import { X, AlertCircle, CheckCircle2, Info } from "lucide-react";

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
    error:   { bg: "rgba(221,0,0,0.08)",   border: "#dd0000",  text: "#f87171", icon: AlertCircle },
    success: { bg: "rgba(55,205,132,0.08)", border: "#37cd84",  text: "#37cd84", icon: CheckCircle2 },
    info:    { bg: "rgba(175,227,255,0.1)", border: "#55beff",  text: "#55beff", icon: Info },
  };

  const s = styles[type];
  const Icon = s.icon;

  return (
    <div
      className="mb-4 flex items-start gap-3 rounded-[5px] border px-4 py-3 text-sm"
      style={{ background: s.bg, borderColor: s.border, color: s.text }}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="flex-1">{message}</p>
      {onClose && (
        <button type="button" onClick={onClose} className="opacity-60 hover:opacity-100 transition-opacity">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
