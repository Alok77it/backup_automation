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
  delay?: number;
}

export function MetricCard({ title, value, subtitle, icon: Icon, trend, className, delay = 0 }: MetricCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
    >
      <Card className={cn("glass overflow-hidden border-emerald-100", className)}>
        <div className="h-0.5 w-full bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-600" />
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">{title}</p>
              <p className="mt-2 text-3xl font-bold text-foreground">{value}</p>
              {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
              {trend && (
                <p className={cn("mt-2 text-xs font-medium", trend.positive ? "text-emerald-600" : "text-red-500")}>
                  {trend.positive ? "+" : ""}
                  {trend.value}% from last week
                </p>
              )}
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50">
              <Icon className="h-6 w-6 text-emerald-600" />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
