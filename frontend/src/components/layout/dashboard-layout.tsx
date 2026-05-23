"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { CsrfSync } from "@/components/providers/csrf-sync";
import { isAuthenticated } from "@/lib/api";

export function DashboardLayout({ children, title }: { children: React.ReactNode; title: string }) {
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated()) router.push("/login");
  }, [router]);

  return (
    <div className="relative min-h-screen bg-background">
      <CsrfSync />
      <div className="pointer-events-none fixed inset-0 tech-grid opacity-40" />
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-emerald-50/80 via-transparent to-white dark:from-emerald-950/30 dark:via-transparent dark:to-[#0a1612]" />
      <Sidebar />
      <div className="relative pl-[var(--sidebar-width)]">
        <Header title={title} />
        <motion.main
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="p-6 md:p-8"
        >
          {children}
        </motion.main>
      </div>
    </div>
  );
}
