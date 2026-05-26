"use client";

import { useEffect, useState, useCallback } from "react";
import { Container, RefreshCw, Play, Square, Trash2, Plus, FileCode2 } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, Server } from "@/lib/api";

interface ContainerSnapshot {
  id: string;
  server_id: string;
  container_id: string;
  name: string;
  image: string;
  image_tag: string | null;
  state: string;
  status: string | null;
  cpu_percent: number | null;
  memory_mb: number | null;
  memory_limit_mb: number | null;
  captured_at: string;
}

interface ContainerSummary {
  total: number;
  running: number;
  stopped: number;
  exited: number;
  dead: number;
  paused: number;
  restarting: number;
}

interface StoredCredential {
  id: string;
  provider: "agent" | "docker" | "github";
  label: string;
  server_id: string | null;
  username: string | null;
  secret_preview: string | null;
}

const STATE_COLOURS: Record<string, "outline" | "secondary" | "destructive"> = {
  running: "outline",
  stopped: "secondary",
  exited: "secondary",
  dead: "destructive",
  paused: "secondary",
  restarting: "secondary",
};

const defaultCompose = `services:
  app:
    image: nginx:latest
    container_name: web-demo
    ports:
      - "8080:80"
    restart: unless-stopped
`;

export default function ContainersPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [selectedServer, setSelectedServer] = useState("");
  const [credentials, setCredentials] = useState<StoredCredential[]>([]);
  const [agentCredentialId, setAgentCredentialId] = useState("");
  const [dockerCredentialId, setDockerCredentialId] = useState("");
  const [agentToken, setAgentToken] = useState("");
  const [containers, setContainers] = useState<ContainerSnapshot[]>([]);
  const [summary, setSummary] = useState<ContainerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<"image" | "compose">("image");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [imageForm, setImageForm] = useState({
    name: "",
    image: "",
    ports: "8080:80",
    env: "",
    volumes: "",
    docker_username: "",
    docker_token: "",
    docker_registry: "docker.io",
  });
  const [composeForm, setComposeForm] = useState({ project_name: "managed-app", compose_content: defaultCompose });

  const loadData = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams({ limit: "200" });
    if (stateFilter) qs.set("state", stateFilter);
    if (selectedServer) qs.set("server_id", selectedServer);
    Promise.all([
      api<ContainerSnapshot[]>(`/containers?${qs.toString()}`),
      api<ContainerSummary>(`/containers/summary${selectedServer ? `?server_id=${selectedServer}` : ""}`),
    ])
      .then(([c, s]) => { setContainers(c); setSummary(s); })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load containers"))
      .finally(() => setLoading(false));
  }, [stateFilter, selectedServer]);

  useEffect(() => {
    Promise.all([api<Server[]>("/servers"), api<StoredCredential[]>("/devops-tools/credentials")])
      .then(([s, c]) => {
        setServers(s);
        setCredentials(c);
        if (s[0]) setSelectedServer(s[0].id);
        setAgentCredentialId(c.find((cred) => cred.provider === "agent")?.id || "");
        setDockerCredentialId(c.find((cred) => cred.provider === "docker")?.id || "");
      }).catch(() => {});
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const splitLines = (value: string) => value.split(/\r?\n|,/).map((v) => v.trim()).filter(Boolean);

  async function submitImage(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setMessage("");
    try {
      await api("/containers/create", {
        method: "POST",
        body: JSON.stringify({
          server_id: selectedServer,
          agent_token_raw: agentCredentialId ? undefined : agentToken,
          agent_credential_id: agentCredentialId || undefined,
          docker_credential_id: dockerCredentialId || undefined,
          ...imageForm,
          ports: splitLines(imageForm.ports),
          env: splitLines(imageForm.env),
          volumes: splitLines(imageForm.volumes),
        }),
      });
      setMessage("Container create job submitted.");
      setTimeout(loadData, 2500);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Create failed");
    }
  }

  async function submitCompose(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setMessage("");
    try {
      await api("/containers/compose/up", {
        method: "POST",
        body: JSON.stringify({
          server_id: selectedServer,
          agent_token_raw: agentCredentialId ? undefined : agentToken,
          agent_credential_id: agentCredentialId || undefined,
          ...composeForm,
        }),
      });
      setMessage("Docker Compose deployment submitted. High-risk jobs may wait for approval in AI Intelligence.");
      setTimeout(loadData, 3000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Compose deploy failed");
    }
  }

  async function runAction(action: "start" | "stop" | "restart" | "delete", c: ContainerSnapshot) {
    if (!agentToken && !agentCredentialId) { setError("Agent credential is required for remote actions."); return; }
    if (!confirm(`${action} container "${c.name}"?`)) return;
    setError(""); setMessage("");
    try {
      await api(`/containers/action/${action}`, {
        method: "POST",
        body: JSON.stringify({
          server_id: c.server_id,
          container_name: c.name,
          agent_token_raw: agentCredentialId ? undefined : agentToken,
          agent_credential_id: agentCredentialId || undefined,
        }),
      });
      setMessage(`${action} job submitted.`);
      setTimeout(loadData, 2500);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Action failed");
    }
  }

  const filtered = containers.filter((c) => !search || `${c.name} ${c.image}`.toLowerCase().includes(search.toLowerCase()));
  const memPercent = (c: ContainerSnapshot) => c.memory_mb && c.memory_limit_mb ? Math.round((c.memory_mb / c.memory_limit_mb) * 100) : null;

  return (
    <DashboardLayout title="Container Management">
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-3xl font-bold">Container Management</h1>
          <p className="text-muted-foreground mt-1">Create, deploy, restart, stop and remove Docker containers on remote servers</p>
        </div>

        {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {message && <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div>}

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5" /> Deploy Container</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <SelectField label="Remote server" value={selectedServer} onChange={(e) => setSelectedServer(e.target.value)}>
                <option value="">Select server</option>
                {servers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.hostname})</option>)}
              </SelectField>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium">Agent token</label>
                <Input type="password" value={agentToken} onChange={(e) => setAgentToken(e.target.value)} placeholder="Raw token for the selected server agent" />
              </div>
              <SelectField label="Saved agent credential" value={agentCredentialId} onChange={(e) => setAgentCredentialId(e.target.value)}>
                <option value="">Use raw token</option>
                {credentials.filter((c) => c.provider === "agent" && (!c.server_id || c.server_id === selectedServer)).map((c) => <option key={c.id} value={c.id}>{c.label} {c.secret_preview}</option>)}
              </SelectField>
              <SelectField label="Saved Docker credential" value={dockerCredentialId} onChange={(e) => setDockerCredentialId(e.target.value)}>
                <option value="">None</option>
                {credentials.filter((c) => c.provider === "docker").map((c) => <option key={c.id} value={c.id}>{c.label} {c.username ? `(${c.username})` : ""}</option>)}
              </SelectField>
            </div>
            <div className="flex w-fit rounded-lg border bg-muted/40 p-1">
              <button className={`rounded-md px-3 py-1.5 text-sm ${mode === "image" ? "bg-white shadow" : "text-muted-foreground"}`} onClick={() => setMode("image")}>Image</button>
              <button className={`rounded-md px-3 py-1.5 text-sm ${mode === "compose" ? "bg-white shadow" : "text-muted-foreground"}`} onClick={() => setMode("compose")}>Compose</button>
            </div>
            {mode === "image" ? (
              <form onSubmit={submitImage} className="grid gap-3 md:grid-cols-2">
                <Input placeholder="Container name" value={imageForm.name} onChange={(e) => setImageForm({ ...imageForm, name: e.target.value })} required />
                <Input placeholder="Image, e.g. nginx:latest" value={imageForm.image} onChange={(e) => setImageForm({ ...imageForm, image: e.target.value })} required />
                <Input placeholder="Ports, e.g. 8080:80" value={imageForm.ports} onChange={(e) => setImageForm({ ...imageForm, ports: e.target.value })} />
                <Input placeholder="Volumes, e.g. /host:/container" value={imageForm.volumes} onChange={(e) => setImageForm({ ...imageForm, volumes: e.target.value })} />
                <Input placeholder="Env, e.g. KEY=value" value={imageForm.env} onChange={(e) => setImageForm({ ...imageForm, env: e.target.value })} />
                <Input placeholder="Docker registry" value={imageForm.docker_registry} onChange={(e) => setImageForm({ ...imageForm, docker_registry: e.target.value })} />
                <Input placeholder="Docker Hub username" value={imageForm.docker_username} onChange={(e) => setImageForm({ ...imageForm, docker_username: e.target.value })} />
                <Input type="password" placeholder="Docker Hub token/password" value={imageForm.docker_token} onChange={(e) => setImageForm({ ...imageForm, docker_token: e.target.value })} />
                <Button className="md:col-span-2" disabled={!selectedServer || (!agentToken && !agentCredentialId)}><Plus className="h-4 w-4" /> Create Container</Button>
              </form>
            ) : (
              <form onSubmit={submitCompose} className="space-y-3">
                <Input placeholder="Project name" value={composeForm.project_name} onChange={(e) => setComposeForm({ ...composeForm, project_name: e.target.value })} />
                <Textarea className="min-h-64 font-mono text-xs" value={composeForm.compose_content} onChange={(e) => setComposeForm({ ...composeForm, compose_content: e.target.value })} />
                <Button disabled={!selectedServer || (!agentToken && !agentCredentialId)}><FileCode2 className="h-4 w-4" /> Deploy Compose</Button>
              </form>
            )}
          </CardContent>
        </Card>

        {summary && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
            {Object.entries(summary).map(([label, value]) => (
              <button key={label} className="rounded-lg border bg-white p-3 text-left transition hover:border-primary" onClick={() => setStateFilter(label === "total" ? null : label)}>
                <div className="text-2xl font-bold">{value}</div>
                <div className="mt-0.5 text-xs capitalize text-muted-foreground">{label}</div>
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Input placeholder="Search by name or image..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
          {stateFilter && <Button variant="outline" size="sm" onClick={() => setStateFilter(null)}>Clear filter</Button>}
          <Button variant="outline" size="sm" onClick={loadData}><RefreshCw className="mr-2 h-4 w-4" /> Refresh</Button>
        </div>

        <Card>
          <CardHeader><CardTitle><Container className="mr-2 inline h-5 w-5" /> Containers <span className="ml-2 text-sm font-normal text-muted-foreground">({filtered.length})</span></CardTitle></CardHeader>
          <CardContent>
            {loading ? <div className="py-4 text-center text-sm text-muted-foreground">Loading...</div> : filtered.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No containers found. Select a server, ensure the agent is running, and refresh.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-left text-muted-foreground"><th className="pb-2 pr-4">Name</th><th className="pb-2 pr-4">Image</th><th className="pb-2 pr-4">State</th><th className="pb-2 pr-4">CPU</th><th className="pb-2 pr-4">Mem</th><th className="pb-2">Actions</th></tr></thead>
                  <tbody>
                    {filtered.map((c) => (
                      <tr key={c.id} className="border-b hover:bg-muted/30">
                        <td className="py-2 pr-4 font-medium">{c.name}</td>
                        <td className="max-w-56 truncate py-2 pr-4 font-mono text-xs text-muted-foreground">{c.image}{c.image_tag ? `:${c.image_tag}` : ""}</td>
                        <td className="py-2 pr-4"><Badge variant={STATE_COLOURS[c.state] ?? "outline"}>{c.state}</Badge></td>
                        <td className="py-2 pr-4 text-xs">{c.cpu_percent != null ? `${c.cpu_percent.toFixed(1)}%` : "-"}</td>
                        <td className="py-2 pr-4 text-xs">{memPercent(c) != null ? `${memPercent(c)}%` : "-"}</td>
                        <td className="py-2">
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" title="Start" onClick={() => runAction("start", c)}><Play className="h-3 w-3" /></Button>
                            <Button variant="ghost" size="icon" title="Stop" onClick={() => runAction("stop", c)}><Square className="h-3 w-3" /></Button>
                            <Button variant="ghost" size="icon" title="Restart" onClick={() => runAction("restart", c)}><RefreshCw className="h-3 w-3" /></Button>
                            <Button variant="ghost" size="icon" title="Delete" className="text-red-600" onClick={() => runAction("delete", c)}><Trash2 className="h-3 w-3" /></Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
