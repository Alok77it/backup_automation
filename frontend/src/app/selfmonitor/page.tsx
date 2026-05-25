"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Server, Cpu, HardDrive, Activity, RefreshCw, Database, AlertCircle, CheckCircle2, ArrowDownToLine } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { PageHero } from "@/components/ui/page-hero";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertBanner } from "@/components/ui/alert-banner";
import { api, ApiError } from "@/lib/api";

interface SystemInfo {
  cpu_percent: number; cpu_count: number;
  memory_total_gb: number; memory_used_gb: number; memory_percent: number;
  swap_total_gb: number; swap_used_gb: number;
  disk_total_gb: number; disk_used_gb: number; disk_free_gb: number; disk_percent: number;
  uptime_seconds: number; network_in_mb: number; network_out_mb: number; process_count: number;
}
interface StoragePath {
  path: string; total_gb: number; used_gb: number; free_gb: number; percent: number;
  top_level_entries: number; total_backup_files: number; backup_data_gb: number; note?: string;
}
interface DockerContainer {
  id: string; name: string; status: string; image: string;
  ports: string; cpu?: string; mem_usage?: string; mem_percent?: string;
}

function formatUptime(s: number) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function GaugeBar({ value, label }: { value: number; label: string }) {
  const bar = value >= 90 ? "bg-red-500" : value >= 75 ? "bg-amber-400" : "bg-emerald-500";
  const text = value >= 90 ? "text-red-600" : value >= 75 ? "text-amber-600" : "text-emerald-700";
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-600 font-medium truncate mr-2">{label}</span>
        <span className={`font-bold shrink-0 ${text}`}>{value.toFixed(1)}%</span>
      </div>
      <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
        <motion.div className={`h-3 rounded-full ${bar}`} initial={{ width: 0 }} animate={{ width: `${Math.min(value,100)}%` }} transition={{ duration: 0.6 }} />
      </div>
    </div>
  );
}

export default function SelfMonitorPage() {
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [paths, setPaths] = useState<StoragePath[]>([]);
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(15);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cdRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function loadAll(manual = false) {
    if (manual) setRefreshing(true);
    else if (!lastUpdated) setLoading(true);
    setError("");
    try {
      const [sys, st, ct] = await Promise.all([
        api<SystemInfo>("/selfmonitor/system"),
        api<{ paths: StoragePath[] }>("/selfmonitor/storage-paths"),
        api<{ containers: DockerContainer[] }>("/selfmonitor/containers"),
      ]);
      setSystem(sys); setPaths(st.paths || []); setContainers(ct.containers || []);
      setLastUpdated(new Date()); setCountdown(15);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load system info");
    } finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => {
    loadAll();
    intervalRef.current = setInterval(() => loadAll(), 15000);
    cdRef.current = setInterval(() => setCountdown((c) => c <= 1 ? 15 : c - 1), 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); if (cdRef.current) clearInterval(cdRef.current); };
  }, []);

  return (
    <DashboardLayout title="System Monitor">
      <PageHero icon={Server} title="Dashboard Server Monitor"
        description="Live metrics for the server hosting this dashboard and backup storage"
        action={
          <div className="flex items-center gap-3">
            {lastUpdated && <span className="text-sm text-muted-foreground">Updated {lastUpdated.toLocaleTimeString()} · {countdown}s</span>}
            <Button variant="outline" onClick={() => loadAll(true)} disabled={loading || refreshing}>
              <RefreshCw className={`h-4 w-4 ${refreshing || loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        }
      />
      <AlertBanner type="error" message={error} onClose={() => setError("")} />

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(8)].map((_, i) => <div key={i} className="h-28 rounded-2xl bg-emerald-50 animate-pulse" />)}
        </div>
      ) : system ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
            <MetricCard title="CPU Usage" value={`${system.cpu_percent.toFixed(1)}%`} icon={Cpu} subtitle={`${system.cpu_count} cores`} delay={0} />
            <MetricCard title="Memory" value={`${system.memory_percent.toFixed(1)}%`} icon={Activity} subtitle={`${system.memory_used_gb.toFixed(1)} / ${system.memory_total_gb.toFixed(1)} GB`} delay={0.05} />
            <MetricCard title="Disk (root)" value={`${system.disk_percent.toFixed(1)}%`} icon={HardDrive} subtitle={`${system.disk_free_gb.toFixed(1)} GB free`} delay={0.1} />
            <MetricCard title="Uptime" value={formatUptime(system.uptime_seconds)} icon={Server} subtitle={`${system.process_count} processes`} delay={0.15} />
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
            <MetricCard title="Network In" value={`${system.network_in_mb.toFixed(0)} MB`} icon={ArrowDownToLine} subtitle={`Out: ${system.network_out_mb.toFixed(0)} MB`} delay={0.2} />
            <MetricCard title="Swap" value={`${system.swap_used_gb.toFixed(2)} GB`} icon={Database} subtitle={`of ${system.swap_total_gb.toFixed(1)} GB`} delay={0.25} />
          </div>

          <div className="grid gap-6 md:grid-cols-2 mb-8">
            <Card className="glass">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Resource Usage</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <GaugeBar value={system.cpu_percent} label="CPU" />
                <GaugeBar value={system.memory_percent} label="Memory" />
                <GaugeBar value={system.disk_percent} label="Disk (root)" />
              </CardContent>
            </Card>
            {paths.map((p, i) => (
              <Card key={i} className="glass">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2"><Database className="h-4 w-4 text-emerald-600" /> Backup Storage</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <GaugeBar value={p.percent} label={p.path} />
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {[["Used", `${p.used_gb.toFixed(2)} GB`], ["Free", `${p.free_gb.toFixed(2)} GB`],
                      ["Files", `${p.total_backup_files}`], ["Data", `${p.backup_data_gb.toFixed(3)} GB`]].map(([k, v]) => (
                      <div key={k} className="rounded-lg bg-gray-50 p-2">
                        <p className="font-bold text-sm">{v}</p><p className="text-gray-400">{k}</p>
                      </div>
                    ))}
                  </div>
                  {p.note && <p className="text-xs text-amber-600 italic">{p.note}</p>}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Docker Containers <Badge variant="default">{containers.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {containers.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-500">
                  <AlertCircle className="mx-auto h-8 w-8 text-gray-200 mb-2" />
                  Docker not accessible or no containers running.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100">
                      {["Container","Image","Status","CPU","Memory","Ports"].map(h => (
                        <th key={h} className="py-2 px-3 text-left text-xs font-semibold text-gray-500">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {containers.map((c) => {
                        const isUp = c.status?.toLowerCase().includes("up");
                        return (
                          <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="py-2.5 px-3 font-medium">{c.name}</td>
                            <td className="py-2.5 px-3 text-xs text-gray-500 font-mono">{c.image}</td>
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-1.5">
                                {isUp ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <AlertCircle className="h-3.5 w-3.5 text-red-400" />}
                                <span className={`text-xs ${isUp ? "text-emerald-700" : "text-red-600"}`}>{c.status}</span>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-xs">{c.cpu || "—"}</td>
                            <td className="py-2.5 px-3 text-xs">{c.mem_usage || "—"}</td>
                            <td className="py-2.5 px-3 text-xs font-mono">{c.ports || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <div className="py-20 text-center">
          <Server className="mx-auto h-12 w-12 text-gray-200 mb-4" />
          <p className="text-gray-500">Could not load system metrics.</p>
        </div>
      )}
    </DashboardLayout>
  );
}
