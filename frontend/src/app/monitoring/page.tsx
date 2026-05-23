"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Activity, Cpu, HardDrive, Network, RefreshCw } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { PageHero } from "@/components/ui/page-hero";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SelectField } from "@/components/ui/select-field";
import { Button } from "@/components/ui/button";
import { AlertBanner } from "@/components/ui/alert-banner";
import { api, ApiError, Server } from "@/lib/api";

export default function MonitoringPage() {
  const [aggregated, setAggregated] = useState<Record<string, number>>({});
  const [servers, setServers] = useState<Server[]>([]);
  const [serverId, setServerId] = useState("");
  const [metrics, setMetrics] = useState<{ time: string; cpu_percent: number; memory_percent: number; disk_percent: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [agg, srv] = await Promise.all([
        api<Record<string, number>>("/monitoring/aggregated"),
        api<Server[]>("/servers"),
      ]);
      setAggregated(agg);
      setServers(srv);
      const q = serverId ? `?hours=24&server_id=${serverId}` : "?hours=24";
      const data = await api<{ recorded_at: string; cpu_percent: number; memory_percent: number; disk_percent: number }[]>(
        `/monitoring/metrics${q}`
      );
      setMetrics(
        data.map((m) => ({
          ...m,
          time: new Date(m.recorded_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        }))
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load metrics");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [serverId]);

  return (
    <DashboardLayout title="Monitoring">
      <PageHero
        icon={Activity}
        title="Live infrastructure metrics"
        description="CPU, memory, disk, and network across your fleet"
        action={
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        }
      />

      <AlertBanner type="error" message={error} onClose={() => setError("")} />

      <div className="mb-6 max-w-xs">
        <SelectField label="Filter by server" value={serverId} onChange={(e) => setServerId(e.target.value)}>
          <option value="">All servers</option>
          {servers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Avg CPU" value={`${(aggregated.cpu || 0).toFixed(1)}%`} icon={Cpu} />
        <MetricCard title="Avg Memory" value={`${(aggregated.memory || 0).toFixed(1)}%`} icon={Activity} />
        <MetricCard title="Avg Disk" value={`${(aggregated.disk || 0).toFixed(1)}%`} icon={HardDrive} />
        <MetricCard title="Network In" value={`${(aggregated.network_in || 0).toFixed(2)} MB/s`} icon={Network} />
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-8">
        <Card className="glass">
          <CardHeader>
            <CardTitle>Infrastructure metrics (24h)</CardTitle>
          </CardHeader>
          <CardContent>
            {metrics.length === 0 ? (
              <p className="py-16 text-center text-muted-foreground">
                No metrics yet. Add servers and click &quot;Metrics&quot; on Infrastructure.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={metrics}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid var(--border)" }} />
                  <Legend />
                  <Line type="monotone" dataKey="cpu_percent" stroke="#10b981" name="CPU %" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="memory_percent" stroke="#059669" name="Memory %" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="disk_percent" stroke="#6ee7b7" name="Disk %" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </DashboardLayout>
  );
}
