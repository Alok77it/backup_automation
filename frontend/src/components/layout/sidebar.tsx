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
  Database,
  Building2,
  Settings,
  Monitor,
  Archive,
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
  { href: "/storage", label: "Storage", icon: Database },
  { href: "/organizations", label: "Organizations", icon: Building2 },
  { href: "/database-backup", label: "DB Backup", icon: Archive },
  { href: "/selfmonitor", label: "System Monitor", icon: Monitor },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-[var(--sidebar-width)] flex-col border-r border-emerald-200/80 bg-white/95 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-3 border-b border-emerald-100 px-5">
        <motion.div
          animate={{ boxShadow: ["0 0 0px rgba(16,185,129,0)", "0 0 20px rgba(16,185,129,0.4)", "0 0 0px rgba(16,185,129,0)"] }}
          transition={{ duration: 2.5, repeat: Infinity }}
          className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary"
        >
          <HardDrive className="h-5 w-5 text-white" />
        </motion.div>
        <div>
          <p className="text-sm font-bold gradient-text">Backup Intelligence</p>
          <p className="text-[10px] text-muted-foreground">AI Recovery Platform</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {navItems.map((item, i) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href}>
              <motion.div
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
                whileHover={{ x: 4 }}
                className={cn(
                  "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                  active
                    ? "gradient-primary text-white shadow-lg shadow-emerald-500/25"
                    : "text-muted-foreground hover:bg-emerald-50 hover:text-emerald-800"
                )}
              >
                {active && (
                  <motion.span
                    layoutId="nav-glow"
                    className="absolute inset-0 rounded-xl ring-1 ring-emerald-400/30"
                  />
                )}
                <Icon className="relative h-4 w-4" />
                <span className="relative">{item.label}</span>
              </motion.div>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-emerald-100 p-3">
        <button
          type="button"
          onClick={() => {
            clearAuth();
            window.location.href = "/login";
          }}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition hover:bg-red-50 hover:text-red-600"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
