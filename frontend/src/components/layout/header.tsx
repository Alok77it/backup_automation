"use client";

import { Bell } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export function Header({ title }: { title: string }) {
  const [alertCount, setAlertCount] = useState(0);
  const [user, setUser] = useState<{ full_name: string; email: string } | null>(null);

  useEffect(() => {
    const u = localStorage.getItem("user");
    if (u) setUser(JSON.parse(u));
    api<unknown[]>("/alerts?unresolved_only=true")
      .then((data) => setAlertCount(Array.isArray(data) ? data.length : 0))
      .catch(() => {});
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-emerald-100/80 bg-white/80 px-6 backdrop-blur-xl md:px-8">
      <motion.h1
        key={title}
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        className="text-xl font-bold text-foreground"
      >
        {title}
      </motion.h1>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="relative" onClick={() => (window.location.href = "/alerts")}>
          <Bell className="h-5 w-5" />
          {alertCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] text-white">
              {alertCount}
            </span>
          )}
        </Button>
        <div className="ml-1 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-1.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-primary text-sm font-bold text-white">
            {user?.full_name?.[0] || "U"}
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-medium text-emerald-800">{user?.full_name}</p>
            <p className="text-xs text-muted-foreground">{user?.email}</p>
          </div>
        </div>
      </div>
    </header>
  );
}
