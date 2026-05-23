"use client";

import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Activity, Cpu, HardDrive, Network } from "lucide-react";
import { api } from "@/lib/api";

export default function MonitoringPage() {
  const [aggregated, setAggregated] = useState<Record<string, number>>({});
  const [metrics, setMetrics] = useState<{ recorded_at: string; cpu_percent: number; memory_percent: number; disk_percent: number }[]>([]);

  useEffect(() => {
    api<Record<string, number>>("/monitoring/aggregated").then(setAggregated);
    api<{ recorded_at: string; cpu_percent: number; memory_percent: number; disk_percent: number }[]>("/monitoring/metrics?hours=24")
      .then((data) => setMetrics(data.map((m) => ({
        ...m,
        time: new Date(m.recorded_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }))));
  }, []);

  return (
    <DashboardLayout title="Monitoring">
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Avg CPU" value={`${(aggregated.cpu || 0).toFixed(1)}%`} icon={Cpu} />
        <MetricCard title="Avg Memory" value={`${(aggregated.memory || 0).toFixed(1)}%`} icon={Activity} />
        <MetricCard title="Avg Disk" value={`${(aggregated.disk || 0).toFixed(1)}%`} icon={HardDrive} />
        <MetricCard title="Network In" value={`${(aggregated.network_in || 0).toFixed(2)} MB/s`} icon={Network} />
      </div>

      <Card className="mt-8 glass">
        <CardHeader><CardTitle>Live Infrastructure Metrics (24h)</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={metrics}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="cpu_percent" stroke="#10B981" name="CPU %" dot={false} />
              <Line type="monotone" dataKey="memory_percent" stroke="#047857" name="Memory %" dot={false} />
              <Line type="monotone" dataKey="disk_percent" stroke="#6ee7b7" name="Disk %" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
