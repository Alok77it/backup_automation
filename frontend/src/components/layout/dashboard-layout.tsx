"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { isAuthenticated } from "@/lib/api";

export function DashboardLayout({ children, title }: { children: React.ReactNode; title: string }) {
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated()) router.push("/login");
  }, [router]);

  return (
    <div className="min-h-screen bg-[#F3F4F6] dark:bg-gray-950">
      <Sidebar />
      <div className="pl-[var(--sidebar-width)]">
        <Header title={title} />
        <main className="p-8">{children}</main>
      </div>
    </div>
  );
}
