"use client";

import { useEffect, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Database, Archive, Copy } from "lucide-react";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/utils";

interface StorageAnalytics {
  total_bytes: number; used_bytes: number; quota_bytes: number;
  compression_ratio: number; redundant_bytes: number; backup_count: number;
  growth_trend: { date: string; used_bytes: number }[];
}

export default function StoragePage() {
  const [data, setData] = useState<StorageAnalytics | null>(null);
  useEffect(() => { api<StorageAnalytics>("/storage/analytics").then(setData); }, []);

  const usagePct = data ? (data.used_bytes / data.quota_bytes) * 100 : 0;

  return (
    <DashboardLayout title="Storage">
      <div className="grid gap-6 md:grid-cols-3">
        <MetricCard title="Used Storage" value={formatBytes(data?.used_bytes ?? 0)} icon={Database} subtitle={`${usagePct.toFixed(1)}% of quota`} />
        <MetricCard title="Compression Ratio" value={`${(data?.compression_ratio ?? 1).toFixed(2)}x`} icon={Archive} />
        <MetricCard title="Redundant Data" value={formatBytes(data?.redundant_bytes ?? 0)} icon={Copy} subtitle={`${data?.backup_count ?? 0} backups`} />
      </div>
      <Card className="mt-8 glass">
        <CardHeader><CardTitle>Storage Growth (30 days)</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={data?.growth_trend?.map((t) => ({ ...t, used_gb: t.used_bytes / 1024 ** 3 })) ?? []}>
              <defs>
                <linearGradient id="storageGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f36458" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f36458" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v) => [`${Number(v).toFixed(2)} GB`, "Used"]} />
              <Area type="monotone" dataKey="used_gb" stroke="#f36458" fill="url(#storageGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
