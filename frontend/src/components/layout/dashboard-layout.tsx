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
      {/* Subtle grid texture */}
      <div className="pointer-events-none fixed inset-0 tech-grid opacity-100" />
      <Sidebar />
      <div className="relative pl-[var(--sidebar-width)]">
        <Header title={title} />
        <motion.main
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="p-6 md:p-8"
        >
          {children}
        </motion.main>
      </div>
    </div>
  );
}
