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
  Container,
  Wrench,
  Play,
  ClipboardCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { clearAuth } from "@/lib/api";

const navItems = [
  { href: "/dashboard",       label: "Dashboard",        icon: LayoutDashboard },
  { href: "/infrastructure",  label: "Infrastructure",   icon: Server },
  { href: "/containers",      label: "Containers",       icon: Container },
  { href: "/backups",         label: "Backups",          icon: HardDrive },
  { href: "/restore",         label: "Restore Center",   icon: RotateCcw },
  { href: "/monitoring",      label: "Monitoring",       icon: Activity },
  { href: "/ai",              label: "AI Intelligence",  icon: Brain },
  { href: "/ai#approvals",    label: "Approvals",        icon: ClipboardCheck },
  { href: "/devops-tools",    label: "DevOps Tools",     icon: Wrench },
  { href: "/execution",       label: "Automation Script",icon: Play },
  { href: "/logs",            label: "Logs",             icon: ScrollText },
  { href: "/policies",        label: "Policies",         icon: Shield },
  { href: "/storage",         label: "Storage",          icon: Database },
  { href: "/organizations",   label: "Organizations",    icon: Building2 },
  { href: "/database-backup", label: "DB Backup",        icon: Archive },
  { href: "/selfmonitor",     label: "System Monitor",   icon: Monitor },
  { href: "/settings",        label: "Settings",         icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="fixed left-0 top-0 z-40 flex h-screen w-[var(--sidebar-width)] flex-col sidebar-glow"
      style={{ background: "#0b0b0b", borderRight: "1px solid #353535" }}
    >
      {/* Logo / wordmark */}
      <div
        className="flex h-16 items-center gap-3 px-5"
        style={{ borderBottom: "1px solid #353535" }}
      >
        <span className="brand-dot" />
        <div>
          <p className="text-sm font-semibold tracking-tight text-white">
            Backup Intelligence
          </p>
          <p
            className="text-[10px] tracking-widest uppercase"
            style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#797979" }}
          >
            AI Recovery Platform
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {navItems.map((item, i) => {
          const active =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href.split("#")[0] + "/"));
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href}>
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.025 }}
                className={cn(
                  "relative flex items-center gap-3 rounded-[5px] px-3 py-2.5 text-sm font-medium transition-all duration-150",
                  active
                    ? "text-white"
                    : "text-[#797979] hover:text-[#b9b9b9] hover:bg-[#212121]"
                )}
                style={
                  active
                    ? { background: "#212121", color: "#ffffff" }
                    : {}
                }
              >
                {active && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r"
                    style={{ background: "#f36458" }}
                  />
                )}
                <Icon
                  className="relative h-4 w-4 shrink-0"
                  style={active ? { color: "#f36458" } : {}}
                />
                <span className="relative">{item.label}</span>
              </motion.div>
            </Link>
          );
        })}
      </nav>

      {/* Sign out */}
      <div className="p-3" style={{ borderTop: "1px solid #353535" }}>
        <button
          type="button"
          onClick={() => {
            clearAuth();
            window.location.href = "/login";
          }}
          className="flex w-full items-center gap-3 rounded-[5px] px-3 py-2.5 text-sm transition-colors duration-150"
          style={{ color: "#797979" }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "#1a0a0a";
            (e.currentTarget as HTMLButtonElement).style.color = "#f36458";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            (e.currentTarget as HTMLButtonElement).style.color = "#797979";
          }}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
