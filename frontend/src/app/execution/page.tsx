"use client";

import { useEffect, useState, useCallback } from "react";
import { Play, Square, RefreshCw, Clock, CheckCircle, XCircle, AlertCircle, Loader2 } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

interface Job {
  id: string;
  server_id: string | null;
  job_type: string;
  risk_level: string;
  status: string;
  requires_approval: boolean;
  approval_id: string | null;
  celery_task_id: string | null;
  result: Record<string, unknown> | null;
  error_message: string | null;
  duration_ms: number | null;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface JobLog {
  sequence: number;
  level: string;
  message: string;
  stream: string;
  timestamp: string;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending:   <Clock className="h-4 w-4 text-yellow-500" />,
  queued:    <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />,
  executing: <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />,
  completed: <CheckCircle className="h-4 w-4 text-green-500" />,
  failed:    <XCircle className="h-4 w-4 text-red-500" />,
  cancelled: <Square className="h-4 w-4 text-gray-500" />,
  timeout:   <AlertCircle className="h-4 w-4 text-orange-500" />,
};

const RISK_COLOURS: Record<string, "outline" | "secondary" | "destructive"> = {
  low:    "outline",
  medium: "secondary",
  high:   "destructive",
};

export default function ExecutionPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [logs, setLogs] = useState<JobLog[]>([]);
  const [loading, setLoading] = useState(true);

  const loadJobs = useCallback(() => {
    api<Job[]>("/execution/jobs?limit=50")
      .then(setJobs)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadJobs();
    const interval = setInterval(loadJobs, 10000);
    return () => clearInterval(interval);
  }, [loadJobs]);

  const loadLogs = async (jobId: string) => {
    const l = await api<JobLog[]>(`/execution/jobs/${jobId}/logs`);
    setLogs(l);
  };

  const selectJob = (job: Job) => {
    setSelectedJob(job);
    setLogs([]);
    loadLogs(job.id);
  };

  const cancelJob = async (id: string) => {
    if (!confirm("Cancel this job?")) return;
    await api(`/execution/jobs/${id}/cancel`, { method: "POST" });
    loadJobs();
  };

  const duration = (ms: number | null) => {
    if (!ms) return "—";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <DashboardLayout title="Execution Engine">
      <div className="flex h-full gap-4 p-6">
        {/* Job List */}
        <div className="flex-1 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Execution Engine</h1>
              <p className="text-muted-foreground mt-1">All DevOps jobs — real-time queue view</p>
            </div>
            <Button variant="outline" size="sm" onClick={loadJobs}>
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Job Queue</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-muted-foreground text-sm py-4 text-center">Loading…</div>
              ) : jobs.length === 0 ? (
                <div className="text-muted-foreground text-sm py-8 text-center">
                  No jobs yet. Jobs are created when you install plugins, deploy tools, or trigger actions.
                </div>
              ) : (
                <div className="space-y-2">
                  {jobs.map((job) => (
                    <div
                      key={job.id}
                      className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors
                        ${selectedJob?.id === job.id ? "bg-muted border-primary" : "hover:bg-muted/50"}`}
                      onClick={() => selectJob(job)}
                    >
                      <div className="shrink-0">{STATUS_ICONS[job.status] ?? <Clock className="h-4 w-4" />}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{job.job_type}</span>
                          <Badge variant={RISK_COLOURS[job.risk_level] ?? "outline"} className="text-xs">
                            {job.risk_level}
                          </Badge>
                          {job.requires_approval && (
                            <Badge variant="secondary" className="text-xs">needs approval</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {new Date(job.created_at).toLocaleString()} · {duration(job.duration_ms)}
                        </div>
                      </div>
                      <div className="shrink-0">
                        <Badge variant={job.status === "completed" ? "outline" : job.status === "failed" ? "destructive" : "secondary"}>
                          {job.status}
                        </Badge>
                      </div>
                      {["pending", "queued", "executing"].includes(job.status) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="shrink-0"
                          onClick={(e) => { e.stopPropagation(); cancelJob(job.id); }}
                        >
                          <Square className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Job Detail Panel */}
        {selectedJob && (
          <div className="w-96 shrink-0 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Job Detail</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div><span className="text-muted-foreground">Type:</span> {selectedJob.job_type}</div>
                <div><span className="text-muted-foreground">Status:</span> {selectedJob.status}</div>
                <div><span className="text-muted-foreground">Risk:</span> {selectedJob.risk_level}</div>
                <div><span className="text-muted-foreground">Duration:</span> {duration(selectedJob.duration_ms)}</div>
                {selectedJob.approval_id && (
                  <div><span className="text-muted-foreground">Approval:</span> <span className="font-mono text-xs">{selectedJob.approval_id.slice(0, 8)}…</span></div>
                )}
                {selectedJob.error_message && (
                  <div className="mt-2 rounded bg-destructive/10 p-2 text-destructive text-xs font-mono">
                    {selectedJob.error_message}
                  </div>
                )}
                {selectedJob.result && (
                  <pre className="mt-2 rounded bg-muted p-2 text-xs overflow-auto max-h-32">
                    {JSON.stringify(selectedJob.result, null, 2)}
                  </pre>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Logs</CardTitle>
              </CardHeader>
              <CardContent>
                {logs.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No logs yet</div>
                ) : (
                  <div className="font-mono text-xs space-y-1 max-h-96 overflow-y-auto">
                    {logs.map((l) => (
                      <div key={l.sequence} className={`${l.level === "error" ? "text-red-500" : "text-foreground"}`}>
                        <span className="text-muted-foreground mr-2">#{l.sequence}</span>
                        {l.message}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
