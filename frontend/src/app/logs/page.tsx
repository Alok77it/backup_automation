"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Search, Sparkles, RefreshCw, ScrollText, ChevronDown, ChevronRight,
  CheckCircle, XCircle, Clock, Loader2, AlertCircle, Play, Terminal,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SelectField } from "@/components/ui/select-field";
import { api, ApiError } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LogEntry {
  id: string;
  source: string;
  level: string;
  message: string;
  created_at: string;
}

interface Job {
  id: string;
  server_id: string | null;
  job_type: string;
  status: string;
  risk_level: string;
  requires_approval: boolean;
  error_message: string | null;
  result: Record<string, unknown> | null;
  created_at: string;
  duration_ms: number | null;
  plugin_id: string | null;
}

interface JobLog {
  sequence: number;
  level: string;
  message: string;
  stream: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function levelColor(level: string): "destructive" | "warning" | "secondary" | "outline" {
  if (level === "error" || level === "critical") return "destructive";
  if (level === "warning" || level === "warn") return "warning";
  if (level === "info") return "secondary";
  return "outline";
}

function duration(ms: number | null): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  completed: <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />,
  failed:    <XCircle className="h-4 w-4 text-red-500 shrink-0" />,
  timeout:   <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />,
  executing: <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />,
  queued:    <Clock className="h-4 w-4 text-slate-400 shrink-0" />,
  pending:   <Clock className="h-4 w-4 text-slate-300 shrink-0" />,
  cancelled: <XCircle className="h-4 w-4 text-slate-400 shrink-0" />,
};

const STATUS_VARIANT: Record<string, "destructive" | "secondary" | "outline" | "warning"> = {
  completed: "secondary",
  failed:    "destructive",
  timeout:   "warning",
  executing: "secondary",
  queued:    "outline",
  pending:   "outline",
  cancelled: "outline",
};

const JOB_TYPE_LABEL: Record<string, string> = {
  plugin_install:    "Install Plugin",
  plugin_uninstall:  "Uninstall Plugin",
  agent_command:     "Script / Command",
  container_poll:    "Container Sync",
  ssl_issue:         "SSL Issue",
  ssl_renew:         "SSL Renew",
  health_check:      "Health Check",
};

// ── System log row (expandable) ───────────────────────────────────────────────

function SysLogRow({ log }: { log: LogEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-xl border bg-white transition hover:border-primary/40 cursor-pointer select-none"
      onClick={() => setOpen((v) => !v)}
    >
      <div className="flex items-start gap-3 p-3">
        {open
          ? <ChevronDown className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
          : <ChevronRight className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />}
        <Badge variant={levelColor(log.level)} className="text-[10px] shrink-0 capitalize">{log.level}</Badge>
        <Badge variant="outline" className="text-[10px] shrink-0 capitalize">{log.source}</Badge>
        <div className="flex-1 min-w-0">
          <p className={`text-sm text-foreground ${open ? "whitespace-pre-wrap break-words" : "truncate"}`}>{log.message}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{new Date(log.created_at).toLocaleString()}</p>
        </div>
      </div>
      {open && (
        <div className="border-t bg-muted/30 rounded-b-xl px-4 py-3 space-y-2">
          <div className="font-mono text-xs text-foreground whitespace-pre-wrap break-words bg-slate-900 text-emerald-300 rounded-lg p-3">
            {log.message}
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
            <div><span className="font-medium">Source:</span> {log.source}</div>
            <div><span className="font-medium">Level:</span> {log.level}</div>
            <div><span className="font-medium">Time:</span> {new Date(log.created_at).toLocaleString()}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Job row (expandable, fetches logs on open) ────────────────────────────────

function JobRow({ job }: { job: Job }) {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<JobLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState("");

  async function fetchLogs() {
    setLoadingLogs(true);
    setLogsError("");
    try {
      const data = await api<JobLog[]>(`/execution/jobs/${job.id}/logs`);
      setLogs(data);
    } catch (e) {
      setLogsError(e instanceof ApiError ? e.message : "Failed to load logs");
    } finally {
      setLoadingLogs(false);
    }
  }

  function toggle() {
    if (!open) fetchLogs();
    setOpen((v) => !v);
  }

  const typeLabel = JOB_TYPE_LABEL[job.job_type] || job.job_type;
  const isFailed = job.status === "failed" || job.status === "timeout";

  return (
    <div
      className={`rounded-xl border transition cursor-pointer ${
        isFailed ? "border-red-200 bg-red-50/40 hover:border-red-300" : "bg-white hover:border-primary/40"
      }`}
      onClick={toggle}
    >
      <div className="flex items-start gap-3 p-3">
        {open
          ? <ChevronDown className="h-3.5 w-3.5 mt-1 shrink-0 text-muted-foreground" />
          : <ChevronRight className="h-3.5 w-3.5 mt-1 shrink-0 text-muted-foreground" />}
        {STATUS_ICON[job.status] ?? <Clock className="h-4 w-4 shrink-0 text-slate-300" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{typeLabel}</span>
            {job.plugin_id && (
              <Badge variant="outline" className="text-[10px]">{job.plugin_id}</Badge>
            )}
            <Badge variant={STATUS_VARIANT[job.status] ?? "outline"} className="text-[10px] capitalize">
              {job.status}
            </Badge>
            <Badge
              variant={job.risk_level === "high" ? "destructive" : "outline"}
              className="text-[10px] capitalize"
            >
              {job.risk_level}
            </Badge>
          </div>
          <div className="flex gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
            <span>{new Date(job.created_at).toLocaleString()}</span>
            <span>⏱ {duration(job.duration_ms)}</span>
            {job.requires_approval && <span className="text-amber-600">⏳ approval required</span>}
          </div>
          {isFailed && job.error_message && (
            <p className="mt-1 text-xs text-red-600 truncate">❌ {job.error_message}</p>
          )}
        </div>
      </div>

      {open && (
        <div
          className="border-t bg-muted/20 rounded-b-xl p-4 space-y-4"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Meta grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <div className="text-muted-foreground font-medium mb-0.5">Job Type</div>
              <div>{typeLabel}</div>
            </div>
            <div>
              <div className="text-muted-foreground font-medium mb-0.5">Status</div>
              <div className="capitalize">{job.status}</div>
            </div>
            <div>
              <div className="text-muted-foreground font-medium mb-0.5">Risk Level</div>
              <div className="capitalize">{job.risk_level}</div>
            </div>
            <div>
              <div className="text-muted-foreground font-medium mb-0.5">Duration</div>
              <div>{duration(job.duration_ms)}</div>
            </div>
          </div>

          {/* Error message */}
          {job.error_message && (
            <div>
              <div className="text-xs font-semibold text-red-700 mb-1">❌ Error Details</div>
              <pre className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 whitespace-pre-wrap overflow-auto max-h-40">
                {job.error_message}
              </pre>
            </div>
          )}

          {/* Result payload */}
          {job.result && Object.keys(job.result).length > 0 && (
            <div>
              <div className="text-xs font-semibold mb-1">Result</div>
              <pre className="rounded-lg bg-muted border p-3 text-xs whitespace-pre-wrap overflow-auto max-h-32">
                {JSON.stringify(job.result, null, 2)}
              </pre>
            </div>
          )}

          {/* Output logs */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold">Output Logs</div>
              <button
                className="text-[10px] text-primary underline"
                onClick={fetchLogs}
              >
                ↺ Refresh
              </button>
            </div>
            {loadingLogs ? (
              <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading logs…
              </div>
            ) : logsError ? (
              <p className="text-xs text-red-600">{logsError}</p>
            ) : logs.length === 0 ? (
              <div className="rounded-lg bg-slate-900 p-4 text-xs text-slate-500 italic text-center">
                No log output recorded for this job.
                {job.status === "pending" || job.status === "queued"
                  ? " Job is waiting to start."
                  : job.status === "executing"
                  ? " Job is running — refresh to see output."
                  : " The agent may not have returned output."}
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto rounded-lg bg-slate-900 p-3 font-mono text-xs space-y-0.5">
                {logs.map((l) => (
                  <div
                    key={l.sequence}
                    className={
                      l.level === "error" || l.stream === "stderr"
                        ? "text-red-400"
                        : l.level === "warn"
                        ? "text-amber-400"
                        : "text-emerald-300"
                    }
                  >
                    <span className="mr-2 text-slate-600 select-none">#{l.sequence}</span>
                    {l.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = "jobs" | "system";

export default function LogsPage() {
  const [tab, setTab] = useState<Tab>("jobs");

  // System logs state
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [sysLoading, setSysLoading] = useState(false);
  const [sysError, setSysError] = useState("");
  const [summary, setSummary] = useState("");
  const [summarizing, setSummarizing] = useState(false);

  // Job logs state
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobFilter, setJobFilter] = useState("all");
  const [jobLoading, setJobLoading] = useState(false);
  const [jobError, setJobError] = useState("");

  const loadSysLogs = useCallback(async () => {
    setSysLoading(true);
    setSysError("");
    try {
      const params = new URLSearchParams();
      if (query) params.set("query", query);
      if (source) params.set("source", source);
      const data = await api<{ items: LogEntry[] }>(`/logs?${params}`);
      setLogs(data.items || []);
    } catch (err) {
      setSysError(err instanceof ApiError ? err.message : "Failed to load logs");
    } finally {
      setSysLoading(false);
    }
  }, [query, source]);

  const loadJobs = useCallback(async () => {
    setJobLoading(true);
    setJobError("");
    try {
      const data = await api<Job[]>("/execution/jobs");
      setJobs(data);
    } catch (err) {
      setJobError(err instanceof ApiError ? err.message : "Failed to load jobs");
    } finally {
      setJobLoading(false);
    }
  }, []);

  useEffect(() => { loadSysLogs(); }, []);
  useEffect(() => { loadJobs(); }, []);

  // Auto-refresh running jobs every 8s
  useEffect(() => {
    const hasRunning = jobs.some((j) => j.status === "executing" || j.status === "queued");
    if (!hasRunning) return;
    const t = setInterval(loadJobs, 8000);
    return () => clearInterval(t);
  }, [jobs, loadJobs]);

  async function summarize() {
    setSummarizing(true);
    setSysError("");
    try {
      const res = await api<{ summary: string }>("/logs/summarize", { method: "POST" });
      setSummary(res.summary);
    } catch (err) {
      setSysError(err instanceof ApiError ? err.message : "AI summary failed");
    } finally {
      setSummarizing(false);
    }
  }

  const filteredJobs = jobFilter === "all"
    ? jobs
    : jobs.filter((j) => j.status === jobFilter);

  const failedCount = jobs.filter((j) => j.status === "failed" || j.status === "timeout").length;
  const runningCount = jobs.filter((j) => j.status === "executing" || j.status === "queued").length;

  return (
    <DashboardLayout title="Logs">
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-3xl font-bold">Logs &amp; Activity</h1>
          <p className="mt-1 text-muted-foreground">
            Click any row to expand — see full output, error details, and terminal logs
          </p>
        </div>

        {/* Stats */}
        <div className="flex gap-3 flex-wrap">
          <div className="rounded-lg border bg-white px-4 py-2 text-sm flex items-center gap-2">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold">{jobs.length}</span> total jobs
          </div>
          {runningCount > 0 && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm flex items-center gap-2">
              <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
              <span className="font-semibold text-blue-700">{runningCount}</span>
              <span className="text-blue-600">running</span>
            </div>
          )}
          {failedCount > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500" />
              <span className="font-semibold text-red-700">{failedCount}</span>
              <span className="text-red-600">failed — click to see error &amp; logs</span>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-xl border bg-muted/40 p-1 w-fit">
          <button
            onClick={() => setTab("jobs")}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition ${
              tab === "jobs" ? "bg-white shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Play className="h-3.5 w-3.5" /> Job Logs
            {failedCount > 0 && (
              <span className="ml-1 rounded-full bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5">
                {failedCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("system")}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition ${
              tab === "system" ? "bg-white shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <ScrollText className="h-3.5 w-3.5" /> System Logs
          </button>
        </div>

        {/* ── Job Logs Tab ── */}
        {tab === "jobs" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <select
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
                value={jobFilter}
                onChange={(e) => setJobFilter(e.target.value)}
              >
                <option value="all">All jobs</option>
                <option value="failed">❌ Failed</option>
                <option value="timeout">⏱ Timeout</option>
                <option value="completed">✅ Completed</option>
                <option value="executing">⚡ Running</option>
                <option value="queued">🕐 Queued</option>
                <option value="pending">🔘 Pending</option>
                <option value="cancelled">⛔ Cancelled</option>
              </select>
              <Button variant="outline" size="sm" onClick={loadJobs} disabled={jobLoading} className="gap-1.5">
                <RefreshCw className={`h-3.5 w-3.5 ${jobLoading ? "animate-spin" : ""}`} /> Refresh
              </Button>
              <span className="text-xs text-muted-foreground">
                ↓ Click any row to see full terminal output &amp; error details
              </span>
            </div>

            {jobError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {jobError}
              </div>
            )}

            {jobLoading && jobs.length === 0 ? (
              <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /> Loading jobs…
              </div>
            ) : filteredJobs.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center gap-2 text-muted-foreground">
                <Terminal className="h-8 w-8 opacity-30" />
                <p className="text-sm">No jobs found.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredJobs.map((j) => <JobRow key={j.id} job={j} />)}
              </div>
            )}
          </div>
        )}

        {/* ── System Logs Tab ── */}
        {tab === "system" && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-10"
                  placeholder="Search logs…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && loadSysLogs()}
                />
              </div>
              <div className="w-44">
                <SelectField value={source} onChange={(e) => setSource(e.target.value)}>
                  <option value="">All sources</option>
                  {["backup", "restore", "infrastructure", "ai", "audit"].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </SelectField>
              </div>
              <Button variant="outline" onClick={loadSysLogs} disabled={sysLoading} className="gap-1.5">
                <RefreshCw className={`h-4 w-4 ${sysLoading ? "animate-spin" : ""}`} /> Search
              </Button>
              <Button onClick={summarize} disabled={summarizing} className="gap-1.5">
                <Sparkles className="h-4 w-4" />
                {summarizing ? "Analyzing…" : "AI Summary"}
              </Button>
            </div>

            {sysError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {sysError}
              </div>
            )}

            {summary && (
              <Card className="border-emerald-200">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Sparkles className="h-4 w-4 text-emerald-600" /> AI Log Summary
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-sm whitespace-pre-wrap leading-relaxed">{summary}</div>
                </CardContent>
              </Card>
            )}

            <p className="text-xs text-muted-foreground">↓ Click any row to expand full message</p>

            {sysLoading ? (
              <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /> Loading…
              </div>
            ) : logs.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center gap-2">
                <ScrollText className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No system log entries found.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {logs.map((l) => <SysLogRow key={l.id} log={l} />)}
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
