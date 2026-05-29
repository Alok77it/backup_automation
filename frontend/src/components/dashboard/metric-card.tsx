"use client";
import { motion } from "framer-motion";
import { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  title: string; value: string | number; subtitle?: string;
  icon: LucideIcon; trend?: { value: number; positive: boolean };
  className?: string; delay?: number;
}

export function MetricCard({ title, value, subtitle, icon: Icon, trend, className, delay = 0 }: MetricCardProps) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }} whileHover={{ y: -1, transition: { duration: 0.15 } }}>
      <Card className={cn("overflow-hidden", className)}>
        <div className="h-[2px] w-full" style={{ background: "linear-gradient(90deg, transparent, #c2ef4e, transparent)" }} />
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-widest mb-2"
                style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#bdb8c0" }}>
                {title}
              </p>
              <p className="text-2xl font-semibold text-white tracking-tight">{value}</p>
              {subtitle && <p className="mt-1 text-xs" style={{ color: "#bdb8c0" }}>{subtitle}</p>}
              {trend && (
                <p className="mt-2 text-xs font-medium"
                  style={{ color: trend.positive ? "#4dc771" : "#f04646" }}>
                  {trend.positive ? "+" : ""}{trend.value}% this week
                </p>
              )}
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[5px]"
              style={{ background: "#2d2540" }}>
              <Icon className="h-5 w-5" style={{ color: "#c2ef4e" }} />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
