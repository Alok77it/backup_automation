"use client";

import { useEffect, useState } from "react";
import { Server, HardDrive, AlertTriangle, Database, Shield, Activity, Brain } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api, DashboardStats } from "@/lib/api";
import { formatBytes, formatPercent } from "@/lib/utils";

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [trends, setTrends] = useState<{ date: string; success: number; failed: number }[]>([]);
  const [events, setEvents] = useState<{ id: string; source: string; level: string; message: string; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api<DashboardStats>("/dashboard/stats"),
      api<{ date: string; success: number; failed: number }[]>("/dashboard/backup-trends"),
      api<{ id: string; source: string; level: string; message: string; created_at: string }[]>("/dashboard/recent-events"),
    ])
      .then(([s, t, e]) => { setStats(s); setTrends(t); setEvents(e); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <DashboardLayout title="Dashboard">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      </DashboardLayout>
    );
  }

  const storagePct = stats ? (stats.storage_used_bytes / stats.storage_quota_bytes) * 100 : 0;
  const recentEvents = (
    <Card className="glass h-full">
      <CardHeader><CardTitle>Recent Events</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-3">
          {events.length === 0 && <p className="text-sm text-gray-500">No recent events</p>}
          {events.map((e) => (
            <div key={e.id} className="flex items-center gap-4 rounded-xl border border-[#353535] p-4 transition hover:bg-[#212121]">
              <Badge variant={e.level === "error" ? "error" : e.level === "warning" ? "warning" : "default"}>{e.level}</Badge>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{e.message}</p>
                <p className="text-xs text-gray-500">{e.source} - {new Date(e.created_at).toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <DashboardLayout title="Dashboard">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.75fr)]">
        <section>
          <div className="mb-4">
            <p className="eyebrow">Operations overview</p>
            <h2 className="mt-1 text-lg font-semibold text-white">Backup command center</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            <MetricCard title="Backup Health" value={formatPercent(stats?.backup_health_avg ?? 0)} icon={Activity} delay={0} />
            <MetricCard title="Failed Jobs (24h)" value={stats?.failed_jobs_24h ?? 0} icon={AlertTriangle} subtitle="Requires attention" delay={0.05} />
            <MetricCard title="Active Backups" value={stats?.active_backups ?? 0} icon={HardDrive} delay={0.1} />
            <MetricCard title="Storage Used" value={formatBytes(stats?.storage_used_bytes ?? 0)} icon={Database} subtitle={`${storagePct.toFixed(1)}% of quota`} delay={0.15} />
            <MetricCard title="Total Servers" value={stats?.total_servers ?? 0} icon={Server} delay={0.2} />
            <MetricCard title="AI Risk Alerts" value={stats?.ai_risk_alerts ?? 0} icon={Brain} delay={0.25} />
            <MetricCard title="Restore Readiness" value={formatPercent(stats?.restore_readiness_avg ?? 0)} icon={Shield} className="md:col-span-2 2xl:col-span-3" delay={0.3} />
          </div>
        </section>

        <aside className="xl:pt-[52px]">
          {recentEvents}
        </aside>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <Card className="glass">
          <CardHeader><CardTitle>Backup Trends</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={trends}>
                <defs>
                  <linearGradient id="greenGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f36458" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f36458" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #f36458" }} />
                <Area type="monotone" dataKey="success" stroke="#f36458" fill="url(#greenGrad)" name="Success" />
                <Area type="monotone" dataKey="failed" stroke="#ef4444" fill="none" name="Failed" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="glass">
          <CardHeader><CardTitle>Job Distribution</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={trends.slice(-7)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="success" fill="#f36458" radius={[6, 6, 0, 0]} />
                <Bar dataKey="failed" fill="#ef4444" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
