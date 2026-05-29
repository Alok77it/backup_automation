"use client";

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, Clock, HardDrive, RefreshCw, Server, ShieldCheck, TrendingUp } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { PageHero } from "@/components/ui/page-hero";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";

interface ReliabilitySummary {
  slo_score: number;
  backup_success_rate_24h: number;
  backup_success_rate_7d: number;
  backup_success_rate_30d: number;
  failed_jobs_24h: number;
  active_incidents: number;
  critical_incidents: number;
  last_successful_backup_at: string | null;
  last_successful_backup_age_hours: number | null;
  rpo_status: string;
  rto_status: string;
  storage_used_gb: number;
  storage_quota_gb: number;
  storage_forecast_days: number | null;
  risky_servers: { id: string; name: string; hostname: string; status: string; reasons: string[] }[];
  risky_backups: { id: string; name: string; health_score: number; risk_level: string }[];
}

function statusVariant(status: string): "success" | "warning" | "error" {
  if (status === "healthy") return "success";
  if (status === "at_risk") return "warning";
  return "error";
}

export default function ReliabilityPage() {
  const [summary, setSummary] = useState<ReliabilitySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      setSummary(await api<ReliabilitySummary>("/reliability/summary"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load reliability");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(load);
  }, []);

  const storagePercent = summary && summary.storage_quota_gb > 0 ? (summary.storage_used_gb / summary.storage_quota_gb) * 100 : 0;

  return (
    <DashboardLayout title="Reliability">
      <PageHero
        icon={ShieldCheck}
        title="Reliability center"
        description="SLO score, backup freshness, RPO/RTO risk and storage runway"
        action={<Button variant="outline" onClick={load}><RefreshCw className="h-4 w-4" />Refresh</Button>}
      />
      <AlertBanner type="error" message={error} onClose={() => setError("")} />

      {loading || !summary ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard title="SLO Score" value={`${summary.slo_score.toFixed(1)}%`} icon={ShieldCheck} subtitle={summary.slo_score >= 90 ? "Healthy" : "Needs attention"} />
            <MetricCard title="Success 24h" value={`${summary.backup_success_rate_24h.toFixed(1)}%`} icon={TrendingUp} />
            <MetricCard title="Failed Jobs" value={summary.failed_jobs_24h} icon={AlertTriangle} subtitle="Last 24 hours" />
            <MetricCard title="Active Incidents" value={summary.active_incidents} icon={Activity} subtitle={`${summary.critical_incidents} critical`} />
            <MetricCard title="Success 7d" value={`${summary.backup_success_rate_7d.toFixed(1)}%`} icon={TrendingUp} />
            <MetricCard title="Success 30d" value={`${summary.backup_success_rate_30d.toFixed(1)}%`} icon={TrendingUp} />
            <MetricCard title="Last Backup Age" value={summary.last_successful_backup_age_hours === null ? "None" : `${summary.last_successful_backup_age_hours}h`} icon={Clock} />
            <MetricCard title="Storage Used" value={`${storagePercent.toFixed(1)}%`} icon={HardDrive} subtitle={`${summary.storage_used_gb.toFixed(1)} / ${summary.storage_quota_gb.toFixed(1)} GB`} />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <Card className="glass">
              <CardHeader><CardTitle>RPO/RTO status</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between rounded-[8px] border border-[#353535] p-4">
                  <span className="text-sm font-medium">RPO</span>
                  <Badge variant={statusVariant(summary.rpo_status)}>{summary.rpo_status}</Badge>
                </div>
                <div className="flex items-center justify-between rounded-[8px] border border-[#353535] p-4">
                  <span className="text-sm font-medium">RTO</span>
                  <Badge variant={statusVariant(summary.rto_status)}>{summary.rto_status}</Badge>
                </div>
                <div className="rounded-[8px] border border-[#353535] p-4">
                  <p className="text-sm font-medium">Storage runway</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {summary.storage_forecast_days === null ? "Not enough storage trend data yet." : `${summary.storage_forecast_days} days at current growth.`}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="glass">
              <CardHeader><CardTitle>Risky servers</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {summary.risky_servers.length === 0 && <p className="text-sm text-muted-foreground">No risky servers detected.</p>}
                {summary.risky_servers.map((server) => (
                  <div key={server.id} className="rounded-[8px] border border-[#353535] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <Server className="h-4 w-4 text-[#c2ef4e]" />
                        <p className="truncate font-medium text-white">{server.name}</p>
                      </div>
                      <Badge variant={server.status === "online" ? "success" : "error"}>{server.status}</Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{server.hostname}</p>
                    <p className="mt-2 text-sm text-muted-foreground">{server.reasons.join(", ")}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="glass">
              <CardHeader><CardTitle>Risky backups</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {summary.risky_backups.length === 0 && <p className="text-sm text-muted-foreground">No risky backups detected.</p>}
                {summary.risky_backups.map((backup) => (
                  <div key={backup.id} className="rounded-[8px] border border-[#353535] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-white">{backup.name}</p>
                      <Badge variant={backup.risk_level === "critical" || backup.risk_level === "high" ? "error" : "warning"}>{backup.risk_level}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">Health score {backup.health_score.toFixed(1)}%</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
