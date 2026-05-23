"use client";

import { motion } from "framer-motion";
import { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: { value: number; positive: boolean };
  className?: string;
}

export function MetricCard({ title, value, subtitle, icon: Icon, trend, className }: MetricCardProps) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <Card className={cn("glass overflow-hidden", className)}>
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</p>
              <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">{value}</p>
              {subtitle && <p className="mt-1 text-xs text-gray-500">{subtitle}</p>}
              {trend && (
                <p className={cn("mt-2 text-xs font-medium", trend.positive ? "text-emerald-600" : "text-red-500")}>
                  {trend.positive ? "+" : ""}{trend.value}% from last week
                </p>
              )}
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#D1FAE5] dark:bg-emerald-950">
              <Icon className="h-6 w-6 text-[#10B981]" />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
