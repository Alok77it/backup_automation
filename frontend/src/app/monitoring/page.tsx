"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Activity,
  Cpu,
  HardDrive,
  Network,
  RefreshCw,
  ArrowDownToLine,
  ArrowUpFromLine,
  Disc,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { PageHero } from "@/components/ui/page-hero";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SelectField } from "@/components/ui/select-field";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertBanner } from "@/components/ui/alert-banner";
import { api, ApiError, Server } from "@/lib/api";

interface MetricPoint {
  time: string;
  cpu_percent: number;
  memory_percent: number;
  disk_percent: number;
}

interface Aggregated {
  cpu: number;
  memory: number;
  disk: number;
  network_in: number;
  network_out: number;
  io_read: number;
  io_write: number;
  backup_throughput: number;
  restore_throughput: number;
}

const REFRESH_INTERVAL = 30_000;

export default function MonitoringPage() {
  const [aggregated, setAggregated] = useState<Aggregated>({
    cpu: 0, memory: 0, disk: 0, network_in: 0, network_out: 0,
    io_read: 0, io_write: 0, backup_throughput: 0, restore_throughput: 0,
  });
  const [servers, setServers] = useState<Server[]>([]);
  const [serverId, setServerId] = useState("");
  const [metrics, setMetrics] = useState<MetricPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(30);
  const [error, setError] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load(isManual = false) {
    if (isManual) setRefreshing(true);
    else if (!lastUpdated) setLoading(true);
    setError("");
    try {
      const [agg, srv] = await Promise.all([
        api<Aggregated>("/monitoring/aggregated"),
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
      setLastUpdated(new Date());
      setCountdown(30);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load metrics");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
    intervalRef.current = setInterval(() => load(), REFRESH_INTERVAL);
    countdownRef.current = setInterval(() => setCountdown((c) => (c <= 1 ? 30 : c - 1)), 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  function statusColor(value: number): "success" | "warning" | "error" {
    if (value >= 90) return "error";
    if (value >= 75) return "warning";
    return "success";
  }

  return (
    <DashboardLayout title="Monitoring">
      <PageHero
        icon={Activity}
        title="Live infrastructure metrics"
        description="CPU, memory, disk and network across your fleet — auto-refreshes every 30s"
        action={
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-sm text-muted-foreground">
                Updated {lastUpdated.toLocaleTimeString()} · refresh in {countdown}s
              </span>
            )}
            <Button variant="outline" onClick={() => load(true)} disabled={loading || refreshing}>
              <RefreshCw className={`h-4 w-4 ${loading || refreshing ? "animate-spin" : ""}`} />
              Refresh now
            </Button>
          </div>
        }
      />

      <AlertBanner type="error" message={error} onClose={() => setError("")} />

      <div className="mb-6 max-w-xs">
        <SelectField label="Filter by server" value={serverId} onChange={(e) => setServerId(e.target.value)}>
          <option value="">All servers</option>
          {servers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </SelectField>
      </div>

      {/* Server status dots */}
      {servers.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {servers.map((s) => (
            <div key={s.id} className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-white px-3 py-1.5 text-sm">
              <span className={`h-2 w-2 rounded-full ${s.status === "online" ? "bg-emerald-500" : s.status === "error" ? "bg-red-500" : "bg-amber-400"}`} />
              <span className="font-medium">{s.name}</span>
              <Badge variant={s.status === "online" ? "success" : s.status === "error" ? "error" : "warning"}>{s.status}</Badge>
            </div>
          ))}
        </div>
      )}

      {/* Primary metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-4">
        <MetricCard title="Avg CPU" value={`${aggregated.cpu.toFixed(1)}%`} icon={Cpu}
          subtitle={aggregated.cpu >= 90 ? "⚠ Critical" : aggregated.cpu >= 75 ? "⚠ High" : "Healthy"} delay={0} />
        <MetricCard title="Avg Memory" value={`${aggregated.memory.toFixed(1)}%`} icon={Activity}
          subtitle={aggregated.memory >= 90 ? "⚠ Critical" : aggregated.memory >= 75 ? "⚠ High" : "Healthy"} delay={0.05} />
        <MetricCard title="Avg Disk" value={`${aggregated.disk.toFixed(1)}%`} icon={HardDrive}
          subtitle={aggregated.disk >= 90 ? "⚠ Critical" : aggregated.disk >= 75 ? "⚠ High" : "Healthy"} delay={0.1} />
        <MetricCard title="Network In" value={`${aggregated.network_in.toFixed(2)} MB/s`} icon={Network}
          subtitle={`Out: ${aggregated.network_out.toFixed(2)} MB/s`} delay={0.15} />
      </div>

      {/* Secondary metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
        <MetricCard title="Disk Read" value={`${aggregated.io_read.toFixed(2)} MB/s`} icon={ArrowDownToLine} delay={0.2} />
        <MetricCard title="Disk Write" value={`${aggregated.io_write.toFixed(2)} MB/s`} icon={ArrowUpFromLine} delay={0.25} />
        <MetricCard title="Backup Throughput" value={`${aggregated.backup_throughput.toFixed(2)} MB/s`} icon={Disc} delay={0.3} />
        <MetricCard title="Restore Throughput" value={`${aggregated.restore_throughput.toFixed(2)} MB/s`} icon={RefreshCw} delay={0.35} />
      </div>

      {/* Progress bars */}
      {(aggregated.cpu > 0 || aggregated.memory > 0 || aggregated.disk > 0) && (
        <div className="mb-6 grid gap-4 md:grid-cols-3">
          {([["CPU Usage", aggregated.cpu], ["Memory Usage", aggregated.memory], ["Disk Usage", aggregated.disk]] as [string, number][]).map(([label, value]) => (
            <div key={label} className="glass rounded-2xl p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">{label}</span>
                <Badge variant={statusColor(value)}>{value.toFixed(1)}%</Badge>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-emerald-100">
                <div
                  className={`h-3 rounded-full transition-all duration-500 ${value >= 90 ? "bg-red-500" : value >= 75 ? "bg-amber-400" : "bg-emerald-500"}`}
                  style={{ width: `${Math.min(value, 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Chart */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="glass">
          <CardHeader>
            <CardTitle>Infrastructure metrics — last 24 hours</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-64 items-center justify-center">
                <RefreshCw className="h-8 w-8 animate-spin text-emerald-400" />
              </div>
            ) : metrics.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
                <Activity className="h-12 w-12 text-emerald-200" />
                <p className="text-muted-foreground">No metrics collected yet.</p>
                <p className="text-sm text-muted-foreground">
                  Go to <strong>Infrastructure</strong>, select a server, and click <strong>Metrics</strong> to collect data.
                </p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={metrics}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", background: "#fff" }}
                    formatter={(v: number) => [`${v.toFixed(1)}%`]}
                  />
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
