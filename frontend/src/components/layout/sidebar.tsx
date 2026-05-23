"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Server,
  HardDrive,
  RotateCcw,
  Activity,
  Brain,
  ScrollText,
  Shield,
  Bell,
  Database,
  Building2,
  CreditCard,
  Settings,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { clearAuth } from "@/lib/api";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/infrastructure", label: "Infrastructure", icon: Server },
  { href: "/backups", label: "Backups", icon: HardDrive },
  { href: "/restore", label: "Restore Center", icon: RotateCcw },
  { href: "/monitoring", label: "Monitoring", icon: Activity },
  { href: "/ai", label: "AI Intelligence", icon: Brain },
  { href: "/logs", label: "Logs", icon: ScrollText },
  { href: "/policies", label: "Policies", icon: Shield },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/storage", label: "Storage", icon: Database },
  { href: "/organizations", label: "Organizations", icon: Building2 },
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-[var(--sidebar-width)] flex-col border-r border-emerald-100 bg-white dark:border-emerald-900 dark:bg-gray-900 sidebar-glow">
      <div className="flex h-16 items-center gap-3 border-b border-emerald-100 px-6 dark:border-emerald-900">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-primary">
          <HardDrive className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-sm font-bold gradient-text">Backup Intelligence</p>
          <p className="text-[10px] text-gray-500">AI Recovery Platform</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-4">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href}>
              <motion.div
                whileHover={{ x: 4 }}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                  active
                    ? "gradient-primary text-white shadow-md"
                    : "text-gray-600 hover:bg-[#D1FAE5] hover:text-[#047857] dark:text-gray-300 dark:hover:bg-emerald-950 dark:hover:text-emerald-400"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </motion.div>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-emerald-100 p-4 dark:border-emerald-900">
        <button
          onClick={() => { clearAuth(); window.location.href = "/login"; }}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-gray-600 hover:bg-red-50 hover:text-red-600 dark:text-gray-300"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
