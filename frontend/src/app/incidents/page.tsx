"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, RefreshCw, Siren, Wrench } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { PageHero } from "@/components/ui/page-hero";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";

interface IncidentRecommendation {
  id: string;
  title: string;
  description: string | null;
  action_type: string;
  risk_level: string;
  status: string;
  result_message: string | null;
}

interface IncidentEvent {
  id: string;
  title: string;
  message: string;
  event_type: string;
  created_at: string;
}

interface Incident {
  id: string;
  title: string;
  incident_type: string;
  severity: string;
  status: string;
  root_cause_summary: string | null;
  impact_summary: string | null;
  first_seen_at: string;
  last_seen_at: string;
  events: IncidentEvent[];
  recommendations: IncidentRecommendation[];
}

interface IncidentReport {
  id: string;
  summary: string;
  created_at: string;
}

function severityVariant(severity: string): "error" | "warning" | "info" {
  if (severity === "critical" || severity === "error") return "error";
  if (severity === "warning") return "warning";
  return "info";
}

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selected, setSelected] = useState<Incident | null>(null);
  const [report, setReport] = useState<IncidentReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const data = await api<Incident[]>("/incidents");
      setIncidents(data);
      setSelected((current) => data.find((item) => item.id === current?.id) || data[0] || null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load incidents");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(load);
  }, []);

  async function runRecommendation(incidentId: string, recommendationId: string) {
    setBusy(recommendationId);
    setError("");
    try {
      await api(`/incidents/${incidentId}/recommendations/${recommendationId}/execute`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to execute recommendation");
    } finally {
      setBusy("");
    }
  }

  async function resolveIncident(incidentId: string) {
    setBusy(incidentId);
    try {
      await api(`/incidents/${incidentId}/resolve`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to resolve incident");
    } finally {
      setBusy("");
    }
  }

  async function createReport(incidentId: string) {
    setBusy("report");
    try {
      const data = await api<IncidentReport>(`/incidents/${incidentId}/report`, { method: "POST" });
      setReport(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to generate report");
    } finally {
      setBusy("");
    }
  }

  return (
    <DashboardLayout title="Incidents">
      <PageHero
        icon={Siren}
        title="Incident command"
        description="Backup failures, server outages, disk pressure and repair recommendations in one queue"
        action={<Button variant="outline" onClick={load}><RefreshCw className="h-4 w-4" />Refresh</Button>}
      />
      <AlertBanner type="error" message={error} onClose={() => setError("")} />

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      ) : incidents.length === 0 ? (
        <Card className="glass">
          <CardContent className="flex min-h-72 flex-col items-center justify-center gap-3 text-center">
            <CheckCircle2 className="h-12 w-12 text-[#4dc771]" />
            <h2 className="text-lg font-semibold">No active incidents</h2>
            <p className="max-w-md text-sm text-muted-foreground">The system did not find recent failed backups, unavailable servers, or critical disk pressure.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-3">
            {incidents.map((incident) => (
              <button
                key={incident.id}
                type="button"
                onClick={() => { setSelected(incident); setReport(null); }}
                className={`w-full rounded-[8px] border p-4 text-left transition ${selected?.id === incident.id ? "border-[#c2ef4e] bg-[#2d2540]" : "border-[#353535] bg-[#212121] hover:border-[#625879]"}`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Badge variant={severityVariant(incident.severity)}>{incident.severity}</Badge>
                  <Badge variant={incident.status === "resolved" ? "success" : "secondary"}>{incident.status}</Badge>
                </div>
                <p className="font-semibold text-white">{incident.title}</p>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{incident.root_cause_summary}</p>
                <p className="mt-3 text-xs text-muted-foreground">Last seen {new Date(incident.last_seen_at).toLocaleString()}</p>
              </button>
            ))}
          </div>

          {selected && (
            <div className="space-y-6">
              <Card className="glass">
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle>{selected.title}</CardTitle>
                      <p className="mt-2 text-sm text-muted-foreground">{selected.impact_summary}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => createReport(selected.id)} disabled={busy === "report"}>
                        <FileText className="h-4 w-4" />Report
                      </Button>
                      <Button onClick={() => resolveIncident(selected.id)} disabled={busy === selected.id || selected.status === "resolved"}>
                        <CheckCircle2 className="h-4 w-4" />Resolve
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="rounded-[8px] border border-[#353535] bg-[#212121] p-4">
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                      <AlertTriangle className="h-4 w-4 text-amber-300" />Root cause
                    </div>
                    <p className="text-sm text-muted-foreground">{selected.root_cause_summary || "Root cause not available yet."}</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="glass">
                <CardHeader><CardTitle>Suggested fixes</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {selected.recommendations.map((rec) => (
                    <div key={rec.id} className="flex flex-col gap-3 rounded-[8px] border border-[#353535] bg-[#212121] p-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-white">{rec.title}</p>
                          <Badge variant={rec.risk_level === "medium" ? "warning" : "info"}>{rec.risk_level}</Badge>
                          <Badge variant={rec.status === "executed" ? "success" : "secondary"}>{rec.status}</Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{rec.result_message || rec.description}</p>
                      </div>
                      <Button variant="outline" onClick={() => runRecommendation(selected.id, rec.id)} disabled={busy === rec.id || rec.status === "executed"}>
                        <Wrench className="h-4 w-4" />Run
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="glass">
                <CardHeader><CardTitle>Timeline</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {selected.events.map((event) => (
                    <div key={event.id} className="rounded-[8px] border border-[#353535] p-4">
                      <p className="text-sm font-medium text-white">{event.title}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{event.message}</p>
                      <p className="mt-2 text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {report && (
                <Card className="glass">
                  <CardHeader><CardTitle>Post-incident report</CardTitle></CardHeader>
                  <CardContent>
                    <pre className="whitespace-pre-wrap rounded-[8px] bg-[#151515] p-4 text-sm text-[#e8e2ec]">{report.summary}</pre>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}
