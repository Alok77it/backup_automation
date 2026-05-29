"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, KeyRound, RefreshCw, Shield, ShieldAlert } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { PageHero } from "@/components/ui/page-hero";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";

interface SecurityFinding {
  id: string | null;
  finding_key: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  resource_type: string | null;
  recommendation: string | null;
}

interface SecurityPosture {
  score: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  open_findings: number;
  findings: SecurityFinding[];
}

function severityVariant(severity: string): "error" | "warning" | "info" {
  if (severity === "high") return "error";
  if (severity === "medium") return "warning";
  return "info";
}

export default function SecurityPage() {
  const [posture, setPosture] = useState<SecurityPosture | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      setPosture(await api<SecurityPosture>("/security/posture"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load security posture");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(load);
  }, []);

  async function dismiss(finding: SecurityFinding) {
    if (!finding.id) return;
    setBusy(finding.id);
    try {
      await api(`/security/findings/${finding.id}/dismiss`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to dismiss finding");
    } finally {
      setBusy("");
    }
  }

  return (
    <DashboardLayout title="Security">
      <PageHero
        icon={Shield}
        title="Security posture"
        description="Credentials, SSH access, encryption coverage, audit readiness and unresolved security risk"
        action={<Button variant="outline" onClick={load}><RefreshCw className="h-4 w-4" />Refresh</Button>}
      />
      <AlertBanner type="error" message={error} onClose={() => setError("")} />

      {loading || !posture ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard title="Posture Score" value={`${posture.score.toFixed(1)}%`} icon={Shield} subtitle={posture.score >= 85 ? "Strong" : "Needs hardening"} />
            <MetricCard title="Open Findings" value={posture.open_findings} icon={ShieldAlert} />
            <MetricCard title="High" value={posture.high_count} icon={AlertTriangle} />
            <MetricCard title="Medium" value={posture.medium_count} icon={KeyRound} />
            <MetricCard title="Low" value={posture.low_count} icon={CheckCircle2} />
          </div>

          <Card className="glass mt-6">
            <CardHeader><CardTitle>Findings</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {posture.findings.length === 0 && (
                <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center">
                  <CheckCircle2 className="h-12 w-12 text-[#4dc771]" />
                  <p className="font-medium text-white">No security findings</p>
                  <p className="text-sm text-muted-foreground">Current checks did not find weak SSH auth, disabled encryption, or unresolved critical alerts.</p>
                </div>
              )}
              {posture.findings.map((finding) => (
                <div key={finding.finding_key} className="rounded-[8px] border border-[#353535] bg-[#212121] p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-white">{finding.title}</p>
                        <Badge variant={severityVariant(finding.severity)}>{finding.severity}</Badge>
                        {finding.resource_type && <Badge variant="secondary">{finding.resource_type}</Badge>}
                        <Badge variant={finding.status === "dismissed" ? "success" : "outline"}>{finding.status}</Badge>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">{finding.description}</p>
                      {finding.recommendation && (
                        <p className="mt-3 rounded-[8px] border border-[#353535] p-3 text-sm text-[#e8e2ec]">{finding.recommendation}</p>
                      )}
                    </div>
                    <Button variant="outline" onClick={() => dismiss(finding)} disabled={!finding.id || finding.status === "dismissed" || busy === finding.id}>
                      Dismiss
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </DashboardLayout>
  );
}
