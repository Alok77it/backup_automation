"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Play, Square, RefreshCw, Clock, CheckCircle, XCircle,
  AlertCircle, Loader2, Wand2, Server, KeyRound, Terminal,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, Server as ServerType } from "@/lib/api";

interface Job {
  id: string;
  server_id: string | null;
  job_type: string;
  risk_level: string;
  status: string;
  requires_approval: boolean;
  approval_id: string | null;
  result: Record<string, unknown> | null;
  error_message: string | null;
  duration_ms: number | null;
  created_at: string;
}

interface JobLog {
  sequence: number;
  level: string;
  message: string;
  stream: string;
  timestamp: string;
}

interface StoredCredential {
  id: string;
  provider: string;
  label: string;
  server_id: string | null;
  username: string | null;
  display_name: string | null;
  secret_preview: string | null;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending:   <Clock className="h-4 w-4 text-yellow-500" />,
  queued:    <Loader2 className="h-4 w-4 animate-spin text-blue-500" />,
  executing: <Loader2 className="h-4 w-4 animate-spin text-blue-500" />,
  completed: <CheckCircle className="h-4 w-4 text-green-500" />,
  failed:    <XCircle className="h-4 w-4 text-red-500" />,
  cancelled: <Square className="h-4 w-4 text-gray-500" />,
  timeout:   <AlertCircle className="h-4 w-4 text-orange-500" />,
};

const STATUS_VARIANT: Record<string, "outline" | "destructive" | "secondary"> = {
  completed: "outline",
  failed:    "destructive",
};

export default function ExecutionPage() {
  const [servers, setServers] = useState<ServerType[]>([]);
  const [credentials, setCredentials] = useState<StoredCredential[]>([]);
  const [serverId, setServerId] = useState("");
  const [agentCredentialId, setAgentCredentialId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [script, setScript] = useState("#!/usr/bin/env bash\nset -euo pipefail\n\ndocker ps\n");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [logs, setLogs] = useState<JobLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadJobs = useCallback(() => {
    const qs = serverId ? `?server_id=${serverId}&limit=50` : "?limit=50";
    api<Job[]>(`/execution/jobs${qs}`)
      .then(setJobs)
      .finally(() => setLoading(false));
  }, [serverId]);

  useEffect(() => {
    Promise.all([
      api<ServerType[]>("/servers"),
      api<StoredCredential[]>("/devops-tools/credentials"),
    ]).then(([s, c]) => {
      setServers(s);
      setCredentials(c);
      if (s[0]) setServerId(s[0].id);
      setAgentCredentialId(c.find((cr) => cr.provider === "agent")?.id || "");
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadJobs();
    const interval = setInterval(loadJobs, 10000);
    return () => clearInterval(interval);
  }, [loadJobs]);

  async function loadLogs(jobId: string) {
    const l = await api<JobLog[]>(`/execution/jobs/${jobId}/logs`);
    setLogs(l);
  }

  function generateScript() {
    const p = prompt.toLowerCase();
    if (p.includes("docker") || p.includes("container")) {
      setScript("#!/usr/bin/env bash\nset -euo pipefail\n\ndocker ps -a\ndocker compose ls || true\n");
    } else if (p.includes("disk") || p.includes("space")) {
      setScript("#!/usr/bin/env bash\nset -euo pipefail\n\ndf -h\ndu -xh /var /opt 2>/dev/null | sort -h | tail -40\n");
    } else if (p.includes("nginx")) {
      setScript("#!/usr/bin/env bash\nset -euo pipefail\n\nsystemctl status nginx --no-pager || true\nnginx -t\n");
    } else if (p.includes("memory") || p.includes("mem") || p.includes("ram")) {
      setScript("#!/usr/bin/env bash\nset -euo pipefail\n\nfree -h\nps aux --sort=-%mem | head -20\n");
    } else if (p.includes("cpu") || p.includes("load")) {
      setScript("#!/usr/bin/env bash\nset -euo pipefail\n\nuptime\ntop -bn1 | head -20\n");
    } else if (p.includes("service") || p.includes("systemd")) {
      setScript("#!/usr/bin/env bash\nset -euo pipefail\n\nsystemctl list-units --state=failed\n");
    } else {
      setScript(`#!/usr/bin/env bash\nset -euo pipefail\n\n# Prompt: ${prompt}\nhostname\nuptime\nuname -a\n`);
    }
  }

  async function submitScript(e: React.FormEvent) {
    e.preventDefault();
    if (!serverId || !agentCredentialId || !script.trim()) return;
    setSubmitting(true); setError(""); setSuccess("");
    try {
      await api("/execution/jobs", {
        method: "POST",
        body: JSON.stringify({
          server_id: serverId,
          job_type: "agent_command",
          risk_level: "high",
          timeout_seconds: 1800,
          payload: {
            command: "script_run_approved",
            agent_credential_id: agentCredentialId,
            args: { script_content: script },
          },
        }),
      });
      setSuccess("Script submitted. High-risk jobs need approval in AI Intelligence if required.");
      loadJobs();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Script submit failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelJob(id: string) {
    if (!confirm("Cancel this job?")) return;
    await api(`/execution/jobs/${id}/cancel`, { method: "POST" });
    loadJobs();
  }

  const duration = (ms: number | null) =>
    !ms ? "—" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

  // Agent credentials filtered to selected server
  const agentCreds = credentials.filter(
    (c) => c.provider === "agent" && (!c.server_id || c.server_id === serverId)
  );

  return (
    <DashboardLayout title="Automation Script">
      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_380px]">

        {/* Left column */}
        <div className="space-y-5">
          <div>
            <h1 className="text-3xl font-bold">Automation Script</h1>
            <p className="mt-1 text-muted-foreground">
              Write or generate a bash script and run it on a remote server via the agent
            </p>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}
          {success && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{success}</div>
          )}

          {/* Server + credential selector */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Server className="h-4 w-4" /> Target Server &amp; Credential
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-2">
                <SelectField
                  label="Server"
                  value={serverId}
                  onChange={(e) => {
                    setServerId(e.target.value);
                    setAgentCredentialId("");
                  }}
                >
                  <option value="">Select server…</option>
                  {servers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.hostname})</option>
                  ))}
                </SelectField>

                <SelectField
                  label="Agent credential (username + token)"
                  value={agentCredentialId}
                  onChange={(e) => setAgentCredentialId(e.target.value)}
                >
                  <option value="">— Select agent credential —</option>
                  {agentCreds.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.display_name || c.label}
                      {c.secret_preview ? ` ${c.secret_preview}` : ""}
                    </option>
                  ))}
                </SelectField>
              </div>

              {agentCreds.length === 0 && serverId && (
                <p className="mt-2 text-xs text-amber-600">
                  ⚠ No agent credentials found for this server.
                  Go to <strong>DevOps Tools → Credentials</strong> to add one (type: Agent Token).
                </p>
              )}
              {!agentCredentialId && agentCreds.length > 0 && (
                <p className="mt-2 text-xs text-amber-600">
                  ⚠ Select an agent credential to enable script execution.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Script editor */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Terminal className="h-4 w-4" /> Script Editor
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={submitScript} className="space-y-3">
                {/* AI draft prompt */}
                <div className="flex gap-2">
                  <Input
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Describe what the script should do (e.g. check Docker and disk usage)"
                  />
                  <Button type="button" variant="outline" onClick={generateScript} className="shrink-0 gap-1.5">
                    <Wand2 className="h-4 w-4" /> Draft
                  </Button>
                </div>

                <Textarea
                  className="min-h-72 font-mono text-xs"
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  placeholder="#!/usr/bin/env bash"
                />

                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    High-risk scripts require approval in AI Intelligence before execution.
                  </p>
                  <Button
                    disabled={!serverId || !agentCredentialId || submitting || !script.trim()}
                    className="gap-2"
                  >
                    {submitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    Run on Server
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Jobs list */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Automation Jobs</CardTitle>
                <Button variant="outline" size="sm" onClick={loadJobs}>
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8 gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : jobs.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No jobs yet. Run a script above.
                </div>
              ) : (
                <div className="space-y-2">
                  {jobs.map((job) => (
                    <button
                      key={job.id}
                      className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition ${
                        selectedJob?.id === job.id
                          ? "border-primary bg-muted"
                          : "hover:bg-muted/50"
                      }`}
                      onClick={() => { setSelectedJob(job); setLogs([]); loadLogs(job.id); }}
                    >
                      {STATUS_ICONS[job.status] ?? <Clock className="h-4 w-4" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="truncate text-sm font-medium">{job.job_type}</span>
                          <Badge variant={job.risk_level === "high" ? "destructive" : "secondary"} className="text-[10px]">
                            {job.risk_level}
                          </Badge>
                          {job.requires_approval && (
                            <Badge variant="secondary" className="text-[10px]">approval</Badge>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {new Date(job.created_at).toLocaleString()} · {duration(job.duration_ms)}
                        </div>
                      </div>
                      <Badge
                        variant={STATUS_VARIANT[job.status] ?? "secondary"}
                        className="shrink-0 capitalize text-xs"
                      >
                        {job.status}
                      </Badge>
                      {["pending", "queued", "executing"].includes(job.status) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={(e) => { e.stopPropagation(); cancelJob(job.id); }}
                        >
                          <Square className="h-3 w-3" />
                        </Button>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column — job detail + logs */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Job Detail</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {!selectedJob ? (
                <div className="py-4 text-center text-muted-foreground text-xs">
                  Select a job from the list to inspect its output.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="text-muted-foreground font-medium">Type</div>
                      <div>{selectedJob.job_type}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground font-medium">Status</div>
                      <div className="capitalize">{selectedJob.status}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground font-medium">Risk</div>
                      <div className="capitalize">{selectedJob.risk_level}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground font-medium">Duration</div>
                      <div>{duration(selectedJob.duration_ms)}</div>
                    </div>
                  </div>
                  {selectedJob.error_message && (
                    <pre className="max-h-36 overflow-auto rounded-lg bg-red-50 p-2 text-xs text-red-700 whitespace-pre-wrap">
                      {selectedJob.error_message}
                    </pre>
                  )}
                  {selectedJob.result && (
                    <pre className="max-h-52 overflow-auto rounded-lg bg-muted p-2 text-xs whitespace-pre-wrap">
                      {JSON.stringify(selectedJob.result, null, 2)}
                    </pre>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Output Logs</CardTitle>
                {selectedJob && (
                  <Button variant="ghost" size="sm" onClick={() => loadLogs(selectedJob.id)}>
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {logs.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-4">
                  {selectedJob ? "No logs yet — refresh if job is running." : "Select a job first."}
                </div>
              ) : (
                <div className="max-h-[36rem] space-y-0.5 overflow-y-auto font-mono text-xs bg-slate-900 rounded-lg p-3">
                  {logs.map((l) => (
                    <div
                      key={l.sequence}
                      className={l.level === "error" || l.stream === "stderr" ? "text-red-400" : "text-emerald-300"}
                    >
                      <span className="mr-2 text-slate-500 select-none">#{l.sequence}</span>
                      {l.message}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick credential hint */}
          <Card className="border-dashed">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <KeyRound className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" />
                <p>
                  Need to add agent credentials?{" "}
                  <a href="/devops-tools" className="text-primary underline underline-offset-2">
                    DevOps Tools → Credentials tab
                  </a>
                  {" "}— add an <strong>Agent Token</strong> with your server username + token.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
