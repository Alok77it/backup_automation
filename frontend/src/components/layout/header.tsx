"use client";

import { useTheme } from "next-themes";
import { Moon, Sun, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export function Header({ title }: { title: string }) {
  const { theme, setTheme } = useTheme();
  const [alertCount, setAlertCount] = useState(0);
  const [user, setUser] = useState<{ full_name: string; email: string } | null>(null);

  useEffect(() => {
    const u = localStorage.getItem("user");
    if (u) setUser(JSON.parse(u));
    api<{ length?: number } | unknown[]>("/alerts?unresolved_only=true")
      .then((data) => setAlertCount(Array.isArray(data) ? data.length : 0))
      .catch(() => {});
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-gray-100 bg-white/80 px-8 backdrop-blur-md dark:border-gray-700 dark:bg-gray-900/80">
      <h1 className="text-xl font-bold text-gray-900 dark:text-white">{title}</h1>
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="relative" onClick={() => window.location.href = "/alerts"}>
          <Bell className="h-5 w-5" />
          {alertCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">
              {alertCount}
            </span>
          )}
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>
        <div className="ml-2 flex items-center gap-3 rounded-xl bg-[#D1FAE5] px-4 py-2 dark:bg-emerald-950">
          <div className="h-8 w-8 rounded-full gradient-primary flex items-center justify-center text-white text-sm font-bold">
            {user?.full_name?.[0] || "U"}
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-medium text-[#047857] dark:text-emerald-400">{user?.full_name}</p>
            <p className="text-xs text-gray-500">{user?.email}</p>
          </div>
        </div>
      </div>
    </header>
  );
}
