"use client";
import { Bell, Radio } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export function Header({ title }: { title: string }) {
  const [alertCount, setAlertCount] = useState(0);
  const [user, setUser] = useState<{ full_name: string; email: string } | null>(null);

  useEffect(() => {
    void Promise.resolve().then(() => {
      const u = localStorage.getItem("user");
      if (u) setUser(JSON.parse(u));
      api<unknown[]>("/alerts?unresolved_only=true")
        .then((data) => setAlertCount(Array.isArray(data) ? data.length : 0))
        .catch(() => {});
    });
  }, []);

  return (
    <header className="ops-topbar">
      <div>
        <p className="eyebrow">Live operations workspace</p>
        <motion.h1 key={title} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
          className="ops-screen-title">
          {title}
        </motion.h1>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="ops-pill ops-pill-good"><Radio className="h-3.5 w-3.5" />Live telemetry</span>
        <span className="ops-pill">Org: Client Cloud</span>
        <Button variant="ghost" size="icon" className="relative"
          onClick={() => (window.location.href = "/alerts")}>
          <Bell className="h-4 w-4" style={{ color: "#bdb8c0" }} />
          {alertCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold"
              style={{ background: "#c2ef4e", color: "#150f23" }}>
              {alertCount}
            </span>
          )}
        </Button>
        <div className="ml-1 flex items-center gap-2.5 rounded-[5px] px-3 py-1.5"
          style={{ background: "#2d2540", border: "1px solid #362d59" }}>
          <div className="flex h-7 w-7 items-center justify-center rounded-[4px] text-sm font-bold"
            style={{ background: "#c2ef4e", color: "#150f23" }}>
            {user?.full_name?.[0]?.toUpperCase() || "U"}
          </div>
          <div className="hidden sm:block">
            <p className="text-xs font-medium text-white leading-none mb-0.5">{user?.full_name || "User"}</p>
            <p className="text-[10px] leading-none" style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#bdb8c0" }}>
              {user?.email || ""}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
