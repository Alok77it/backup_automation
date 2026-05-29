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
    <div className="relative min-h-screen overflow-x-hidden bg-background">
      <CsrfSync />
      <div className="pointer-events-none fixed inset-0 tech-grid opacity-100" />
      <div className="ops-shell">
        <Sidebar />
        <div className="ops-content">
        <Header title={title} />
        <motion.main
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="ops-main"
        >
          {children}
        </motion.main>
        </div>
      </div>
    </div>
  );
}
