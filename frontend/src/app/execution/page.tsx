"use client";

import { useEffect, useState, useCallback } from "react";
import { Play, Square, RefreshCw, Clock, CheckCircle, XCircle, AlertCircle, Loader2, Wand2 } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, Server } from "@/lib/api";

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
  provider: "agent" | "docker" | "github";
  label: string;
  server_id: string | null;
  secret_preview: string | null;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending: <Clock className="h-4 w-4 text-yellow-500" />,
  queued: <Loader2 className="h-4 w-4 animate-spin text-blue-500" />,
  executing: <Loader2 className="h-4 w-4 animate-spin text-blue-500" />,
  completed: <CheckCircle className="h-4 w-4 text-green-500" />,
  failed: <XCircle className="h-4 w-4 text-red-500" />,
  cancelled: <Square className="h-4 w-4 text-gray-500" />,
  timeout: <AlertCircle className="h-4 w-4 text-orange-500" />,
};

export default function ExecutionPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [credentials, setCredentials] = useState<StoredCredential[]>([]);
  const [serverId, setServerId] = useState("");
  const [agentCredentialId, setAgentCredentialId] = useState("");
  const [agentToken, setAgentToken] = useState("");
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
    api<Job[]>(`/execution/jobs${qs}`).then(setJobs).finally(() => setLoading(false));
  }, [serverId]);

  useEffect(() => {
    Promise.all([api<Server[]>("/servers"), api<StoredCredential[]>("/devops-tools/credentials")])
      .then(([s, c]) => {
        setServers(s);
        setCredentials(c);
        if (s[0]) setServerId(s[0].id);
        setAgentCredentialId(c.find((cred) => cred.provider === "agent")?.id || "");
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
    } else {
      setScript(`#!/usr/bin/env bash\nset -euo pipefail\n\n# AI draft from prompt:\n# ${prompt || "Describe what you want this script to do"}\n\nhostname\nuptime\n`);
    }
  }

  async function submitScript(e: React.FormEvent) {
    e.preventDefault();
    if (!serverId || (!agentToken && !agentCredentialId) || !script.trim()) return;
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
            _agent_token_raw: agentCredentialId ? undefined : agentToken,
            agent_credential_id: agentCredentialId || undefined,
            args: { script_content: script },
          },
        }),
      });
      setSuccess("Automation script submitted. Approve high-risk execution in AI Intelligence chat if required.");
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

  const duration = (ms: number | null) => !ms ? "-" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

  return (
    <DashboardLayout title="Automation Script">
      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold">Automation Script</h1>
            <p className="mt-1 text-muted-foreground">Select a remote server, write or generate a script, then run it through the agent</p>
          </div>

          {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          {success && <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{success}</div>}

          <Card>
            <CardHeader><CardTitle>Run Script</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={submitScript} className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <SelectField label="Server" value={serverId} onChange={(e) => setServerId(e.target.value)}>
                    <option value="">Select server</option>
                    {servers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.hostname})</option>)}
                  </SelectField>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Agent token</label>
                    <Input type="password" value={agentToken} onChange={(e) => setAgentToken(e.target.value)} placeholder="Raw token for selected server" />
                  </div>
                  <SelectField label="Saved agent credential" value={agentCredentialId} onChange={(e) => setAgentCredentialId(e.target.value)}>
                    <option value="">Use raw token</option>
                    {credentials.filter((c) => c.provider === "agent" && (!c.server_id || c.server_id === serverId)).map((c) => <option key={c.id} value={c.id}>{c.label} {c.secret_preview}</option>)}
                  </SelectField>
                </div>
                <div className="flex gap-2">
                  <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Prompt for script draft, e.g. check Docker and disk usage" />
                  <Button type="button" variant="outline" onClick={generateScript}><Wand2 className="h-4 w-4" /> AI Draft</Button>
                </div>
                <Textarea className="min-h-80 font-mono text-xs" value={script} onChange={(e) => setScript(e.target.value)} />
                <Button disabled={!serverId || (!agentToken && !agentCredentialId) || submitting}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  Run on Server
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Automation Jobs</CardTitle>
              <Button variant="outline" size="sm" onClick={loadJobs}><RefreshCw className="h-4 w-4" /></Button>
            </CardHeader>
            <CardContent>
              {loading ? <div className="py-4 text-center text-sm text-muted-foreground">Loading...</div> : jobs.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">No jobs yet.</div>
              ) : (
                <div className="space-y-2">
                  {jobs.map((job) => (
                    <button key={job.id} className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition ${selectedJob?.id === job.id ? "border-primary bg-muted" : "hover:bg-muted/50"}`} onClick={() => { setSelectedJob(job); setLogs([]); loadLogs(job.id); }}>
                      {STATUS_ICONS[job.status] ?? <Clock className="h-4 w-4" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{job.job_type}</span>
                          <Badge variant={job.risk_level === "high" ? "destructive" : "secondary"}>{job.risk_level}</Badge>
                          {job.requires_approval && <Badge variant="secondary">approval</Badge>}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{new Date(job.created_at).toLocaleString()} - {duration(job.duration_ms)}</div>
                      </div>
                      <Badge variant={job.status === "completed" ? "outline" : job.status === "failed" ? "destructive" : "secondary"}>{job.status}</Badge>
                      {["pending", "queued", "executing"].includes(job.status) && <Button type="button" variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); cancelJob(job.id); }}><Square className="h-3 w-3" /></Button>}
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Job Detail</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {!selectedJob ? <div className="text-muted-foreground">Select a job to inspect output.</div> : (
                <>
                  <div><span className="text-muted-foreground">Type:</span> {selectedJob.job_type}</div>
                  <div><span className="text-muted-foreground">Status:</span> {selectedJob.status}</div>
                  <div><span className="text-muted-foreground">Duration:</span> {duration(selectedJob.duration_ms)}</div>
                  {selectedJob.error_message && <pre className="max-h-36 overflow-auto rounded bg-red-50 p-2 text-xs text-red-700">{selectedJob.error_message}</pre>}
                  {selectedJob.result && <pre className="max-h-52 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(selectedJob.result, null, 2)}</pre>}
                </>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Logs</CardTitle></CardHeader>
            <CardContent>
              {logs.length === 0 ? <div className="text-xs text-muted-foreground">No logs yet</div> : (
                <div className="max-h-[32rem] space-y-1 overflow-y-auto font-mono text-xs">
                  {logs.map((l) => <div key={l.sequence} className={l.level === "error" ? "text-red-600" : ""}><span className="mr-2 text-muted-foreground">#{l.sequence}</span>{l.message}</div>)}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
