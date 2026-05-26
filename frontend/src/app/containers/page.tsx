"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Container,
  RefreshCw,
  Play,
  Square,
  Trash2,
  Plus,
  FileCode2,
  ChevronDown,
  ChevronRight,
  Clock,
  Cpu,
  Server,
  Terminal,
  ScrollText,
  Pencil,
  ExternalLink,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, Server as ServerType } from "@/lib/api";

interface ContainerSnapshot {
  id: string;
  server_id: string;
  container_id: string;
  name: string;
  image: string;
  image_tag: string | null;
  state: string;
  status: string | null;
  exit_code: number | null;
  ports: Record<string, unknown> | string | unknown[] | null;
  cpu_percent: number | null;
  memory_mb: number | null;
  memory_limit_mb: number | null;
  started_at: string | null;
  finished_at: string | null;
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

interface CommandResult {
  success: boolean;
  exit_code: number;
  output: unknown;
  duration_ms: number;
}

interface DockerStatus {
  docker_installed: boolean;
  compose_available: boolean;
  output: string | null;
}

interface StoredCredential {
  id: string;
  provider: string;
  label: string;
  server_id: string | null;
  username: string | null;
  metadata_json: Record<string, unknown> | null;
  display_name: string | null;
  secret_preview: string | null;
}

// ── State styling ────────────────────────────────────────────────────────────

const STATE_CONFIG: Record<string, { variant: "outline" | "secondary" | "destructive"; dot: string }> = {
  running:    { variant: "outline",     dot: "bg-emerald-500" },
  stopped:    { variant: "secondary",   dot: "bg-slate-400" },
  exited:     { variant: "secondary",   dot: "bg-amber-400" },
  dead:       { variant: "destructive", dot: "bg-red-500" },
  paused:     { variant: "secondary",   dot: "bg-blue-400" },
  restarting: { variant: "secondary",   dot: "bg-purple-400" },
};

const defaultCompose = `services:
  app:
    image: nginx:latest
    container_name: web-demo
    ports:
      - "8080:80"
    restart: unless-stopped
`;

function fmtMem(mb: number | null) {
  if (mb == null) return "—";
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}
function fmtCpu(pct: number | null) {
  return pct != null ? `${pct.toFixed(1)}%` : "—";
}
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}
function uptime(startedAt: string | null) {
  if (!startedAt) return null;
  const ms = Date.now() - new Date(startedAt).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Container row with expandable details ─────────────────────────────────────

function ContainerRow({
  c,
  onAction,
  onRead,
  onEdit,
}: {
  c: ContainerSnapshot;
  onAction: (action: "start" | "stop" | "restart" | "delete") => void;
  onRead: (action: "logs" | "inspect" | "shell", c: ContainerSnapshot) => void;
  onEdit: (c: ContainerSnapshot) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATE_CONFIG[c.state] ?? { variant: "outline" as const, dot: "bg-slate-400" };
  const memPct =
    c.memory_mb && c.memory_limit_mb
      ? Math.round((c.memory_mb / c.memory_limit_mb) * 100)
      : null;
  const ut = c.state === "running" ? uptime(c.started_at) : null;

  return (
    <>
      <tr
        className="border-b hover:bg-muted/30 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* expand */}
        <td className="py-2 pl-3 pr-1 text-muted-foreground w-6">
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </td>

        {/* name + short id */}
        <td className="py-2 pr-4 font-medium text-sm">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full shrink-0 ${cfg.dot}`} />
            {c.name}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground mt-0.5 pl-4">
            {c.container_id.slice(0, 12)}
          </div>
        </td>

        {/* image */}
        <td className="max-w-52 truncate py-2 pr-4 font-mono text-xs text-muted-foreground">
          {c.image}{c.image_tag ? `:${c.image_tag}` : ""}
        </td>

        {/* state + uptime */}
        <td className="py-2 pr-4">
          <div className="flex items-center gap-2">
            <Badge variant={cfg.variant} className="capitalize text-xs">{c.state}</Badge>
            {ut && <span className="text-[10px] text-muted-foreground">{ut}</span>}
          </div>
        </td>

        {/* cpu */}
        <td className="py-2 pr-4 text-xs">
          {c.state === "running" ? (
            <span className="flex items-center gap-1">
              <Cpu className="h-3 w-3 text-muted-foreground" />{fmtCpu(c.cpu_percent)}
            </span>
          ) : "—"}
        </td>

        {/* memory */}
        <td className="py-2 pr-4 text-xs">
          {c.state === "running" ? (
            <span>
              {fmtMem(c.memory_mb)}
              {memPct != null && (
                <span className="ml-1 text-muted-foreground">({memPct}%)</span>
              )}
            </span>
          ) : "—"}
        </td>

        {/* last seen */}
        <td className="py-2 pr-4 text-xs text-muted-foreground">{fmtDate(c.captured_at)}</td>

        {/* actions */}
        <td className="py-2 pr-2" onClick={(e) => e.stopPropagation()}>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" title="Start" onClick={() => onAction("start")}>
              <Play className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" title="Stop" onClick={() => onAction("stop")}>
              <Square className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" title="Restart" onClick={() => onAction("restart")}>
              <RefreshCw className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" title="Logs" onClick={() => onRead("logs", c)}>
              <ScrollText className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" title="Shell" onClick={() => onRead("shell", c)}>
              <Terminal className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" title="Edit" onClick={() => onEdit(c)}>
              <Pencil className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Delete"
              className="text-red-500 hover:text-red-700"
              onClick={() => onAction("delete")}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </td>
      </tr>

      {/* expanded detail */}
      {expanded && (
        <tr className="border-b bg-muted/10">
          <td colSpan={8} className="px-6 py-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-2 text-xs">
              <div>
                <div className="text-muted-foreground font-medium mb-0.5">Full Container ID</div>
                <div className="font-mono break-all">{c.container_id}</div>
              </div>
              <div>
                <div className="text-muted-foreground font-medium mb-0.5">Started At</div>
                <div>{fmtDate(c.started_at)}</div>
              </div>
              <div>
                <div className="text-muted-foreground font-medium mb-0.5">
                  {c.state !== "running" ? "Finished At" : "Status"}
                </div>
                <div>{c.state !== "running" ? fmtDate(c.finished_at) : c.status || "Running"}</div>
              </div>
              <div>
                <div className="text-muted-foreground font-medium mb-0.5">Exit Code</div>
                <div>
                  {c.exit_code != null ? (
                    <span className={c.exit_code === 0 ? "text-emerald-600 font-medium" : "text-red-600 font-medium"}>
                      {c.exit_code}
                    </span>
                  ) : "—"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground font-medium mb-0.5">Memory Limit</div>
                <div>{fmtMem(c.memory_limit_mb)}</div>
              </div>
              <div>
                <div className="text-muted-foreground font-medium mb-0.5">Last Snapshot</div>
                <div>{fmtDate(c.captured_at)}</div>
              </div>
              {c.ports && Object.keys(c.ports).length > 0 && (
                <div className="col-span-2">
                  <div className="text-muted-foreground font-medium mb-0.5">Port Mappings</div>
                  <div className="font-mono">{JSON.stringify(c.ports)}</div>
                </div>
              )}
              <div className="col-span-2">
                <button className="text-primary hover:underline" onClick={() => onRead("inspect", c)}>
                  Inspect full runtime config
                </button>
              </div>
              {c.status && (
                <div className="col-span-2">
                  <div className="text-muted-foreground font-medium mb-0.5">Docker Status String</div>
                  <div className="text-muted-foreground">{c.status}</div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ContainersPage() {
  const [servers, setServers] = useState<ServerType[]>([]);
  const [selectedServer, setSelectedServer] = useState("");
  const [credentials, setCredentials] = useState<StoredCredential[]>([]);
  const [agentCredentialId, setAgentCredentialId] = useState("");
  const [dockerCredentialId, setDockerCredentialId] = useState("");

  const [containers, setContainers] = useState<ContainerSnapshot[]>([]);
  const [summary, setSummary] = useState<ContainerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [showDeploy, setShowDeploy] = useState(false);
  const [mode, setMode] = useState<"image" | "compose">("image");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [consoleTitle, setConsoleTitle] = useState("");
  const [consoleOutput, setConsoleOutput] = useState("");
  const [shellCommand, setShellCommand] = useState("whoami && pwd");
  const [activeContainer, setActiveContainer] = useState<ContainerSnapshot | null>(null);
  const [consoleLoading, setConsoleLoading] = useState(false);

  // Docker detection
  const [dockerMissing, setDockerMissing] = useState(false);
  const [installingDocker, setInstallingDocker] = useState(false);

  // DB credential for env var injection
  const [dbCredentialId, setDbCredentialId] = useState("");

  const [imageForm, setImageForm] = useState({
    name: "",
    image: "",
    ports: "8080:80",
    env: "",
    volumes: "",
    docker_registry: "docker.io",
  });
  const [composeForm, setComposeForm] = useState({
    project_name: "managed-app",
    compose_content: defaultCompose,
  });

  const loadData = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams({ limit: "500" });
    if (stateFilter) qs.set("state", stateFilter);
    if (selectedServer) qs.set("server_id", selectedServer);
    Promise.all([
      api<ContainerSnapshot[]>(`/containers?${qs.toString()}`),
      api<ContainerSummary>(
        `/containers/summary${selectedServer ? `?server_id=${selectedServer}` : ""}`
      ),
      selectedServer
        ? api<DockerStatus>(`/containers/docker-status/${selectedServer}`)
        : Promise.resolve<DockerStatus>({ docker_installed: true, compose_available: true, output: null }),
    ])
      .then(([c, s, dockerStatus]) => {
        setContainers(c);
        setSummary(s);
        setDockerMissing(selectedServer !== "" && !dockerStatus.docker_installed);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load containers"))
      .finally(() => setLoading(false));
  }, [stateFilter, selectedServer]);

  useEffect(() => {
    Promise.all([
      api<ServerType[]>("/servers"),
      api<StoredCredential[]>("/devops-tools/credentials"),
    ]).then(([s, c]) => {
      setServers(s);
      setCredentials(c);
      if (s[0]) setSelectedServer(s[0].id);
      setAgentCredentialId(c.find((cr) => cr.provider === "agent")?.id || "");
      setDockerCredentialId(c.find((cr) => cr.provider === "docker")?.id || "");
    }).catch(() => {});
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const splitLines = (v: string) =>
    v.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean);

  async function submitImage(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setMessage("");
    try {
      await api("/containers/create", {
        method: "POST",
        body: JSON.stringify({
          server_id: selectedServer,
          agent_credential_id: agentCredentialId || undefined,
          docker_credential_id: dockerCredentialId || undefined,
          ...imageForm,
          ports: splitLines(imageForm.ports),
          env: splitLines(imageForm.env),
          volumes: splitLines(imageForm.volumes),
        }),
      });
      setMessage("Container create job submitted.");
      setShowDeploy(false);
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
          agent_credential_id: agentCredentialId || undefined,
          ...composeForm,
        }),
      });
      setMessage("Docker Compose deployment submitted.");
      setShowDeploy(false);
      setTimeout(loadData, 3000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Compose deploy failed");
    }
  }

  async function runAction(
    action: "start" | "stop" | "restart" | "delete",
    c: ContainerSnapshot
  ) {
    if (!agentCredentialId) {
      setError("Select an agent credential above before performing container actions.");
      return;
    }
    if (!confirm(`${action} container "${c.name}"?`)) return;
    setError(""); setMessage("");
    try {
      await api(`/containers/action/${action}`, {
        method: "POST",
        body: JSON.stringify({
          server_id: c.server_id,
          container_name: c.name,
          agent_credential_id: agentCredentialId,
        }),
      });
      setMessage(`${action} job submitted.`);
      setTimeout(loadData, 2500);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Action failed");
    }
  }

  async function installDocker() {
    if (!agentCredentialId) {
      setError("Select an agent credential before installing Docker.");
      return;
    }
    setInstallingDocker(true);
    setError(""); setMessage("");
    try {
      await api("/plugins/docker/install", {
        method: "POST",
        body: JSON.stringify({
          server_id: selectedServer,
          agent_credential_id: agentCredentialId,
          config: {},
        }),
      });
      setMessage("Docker install job submitted. It will run directly; no approval step is required.");
      setDockerMissing(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Docker install failed");
    } finally {
      setInstallingDocker(false);
    }
  }

  async function runReadAction(action: "logs" | "inspect" | "shell", c: ContainerSnapshot) {
    if (!agentCredentialId) {
      setError("Select an agent credential above before opening container access.");
      return;
    }
    setError("");
    setConsoleLoading(true);
    setActiveContainer(c);
    setConsoleTitle(`${action.toUpperCase()} · ${c.name}`);
    try {
      const endpoint = action === "shell" ? "/containers/exec" : `/containers/${action}`;
      const result = await api<CommandResult>(endpoint, {
        method: "POST",
        body: JSON.stringify({
          server_id: c.server_id,
          container_name: c.name,
          agent_credential_id: agentCredentialId,
          ...(action === "shell" ? { command: shellCommand, timeout_seconds: 60 } : {}),
        }),
      });
      const output = typeof result.output === "string" ? result.output : JSON.stringify(result.output, null, 2);
      setConsoleOutput(output || "(no output)");
    } catch (e) {
      setConsoleOutput("");
      setError(e instanceof ApiError ? e.message : "Container access failed");
    } finally {
      setConsoleLoading(false);
    }
  }

  function editContainer(c: ContainerSnapshot) {
    setImageForm({
      name: c.name,
      image: c.image_tag ? `${c.image}:${c.image_tag}` : c.image,
      ports: "",
      env: "",
      volumes: "",
      docker_registry: "docker.io",
    });
    setMode("image");
    setShowDeploy(true);
    setMessage(`Editing "${c.name}". Docker cannot change ports/env in place, so saving creates a replacement job with the same name.`);
  }

  function accessUrls(c: ContainerSnapshot) {
    const server = servers.find((s) => s.id === c.server_id);
    const host = server?.hostname;
    if (!host || !c.ports) return [];
    const text = typeof c.ports === "string" ? c.ports : JSON.stringify(c.ports);
    const ports = Array.from(text.matchAll(/0\.0\.0\.0:(\d+)|:::(\d+)|:(\d+)->/g))
      .map((m) => m[1] || m[2] || m[3])
      .filter(Boolean);
    return Array.from(new Set(ports)).map((p) => `http://${host}:${p}`);
  }

  // Inject DB credential values into container env vars
  function injectDbEnv() {
    const cred = credentials.find((c) => c.id === dbCredentialId);
    if (!cred) return;
    const lines: string[] = [];
    if (cred.username) lines.push(`DB_USER=${cred.username}`);
    lines.push(`DB_PASSWORD=<from credential "${cred.label}">`);
    if (cred.metadata_json) {
      const m = cred.metadata_json as Record<string, unknown>;
      if (m.host) lines.push(`DB_HOST=${m.host}`);
      if (m.port) lines.push(`DB_PORT=${m.port}`);
      if (m.dbname) lines.push(`DB_NAME=${m.dbname}`);
    }
    const existing = imageForm.env.trim();
    setImageForm({ ...imageForm, env: existing ? `${existing}\n${lines.join("\n")}` : lines.join("\n") });
  }

  const filtered = containers.filter(
    (c) =>
      !search ||
      `${c.name} ${c.image} ${c.container_id}`.toLowerCase().includes(search.toLowerCase())
  );

  const agentCreds = credentials.filter(
    (c) => c.provider === "agent" && (!c.server_id || c.server_id === selectedServer)
  );
  const dockerCreds = credentials.filter((c) => c.provider === "docker");
  const dbCreds = credentials.filter((c) => c.provider === "database");
  const summaryEntries = summary ? (Object.entries(summary) as [string, number][]) : [];

  return (
    <DashboardLayout title="Container Management">
      <div className="space-y-6 p-6">

        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold">Container Management</h1>
            <p className="text-muted-foreground mt-1">
              Deploy, manage and monitor Docker containers across remote servers
            </p>
          </div>
          <Button onClick={() => setShowDeploy((v) => !v)} className="gap-2">
            <Plus className="h-4 w-4" />
            {showDeploy ? "Cancel Deploy" : "Deploy Container"}
          </Button>
        </div>

        {/* Alerts */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {message && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            {message}
          </div>
        )}

        {/* Docker missing banner */}
        {dockerMissing && !loading && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-start gap-2 flex-1">
              <span className="text-2xl shrink-0">🐳</span>
              <div>
                <div className="font-semibold text-amber-800 text-sm">Docker is not available on this server</div>
                <p className="text-xs text-amber-700 mt-0.5">
                  Docker could not be detected over SSH. If Docker is not installed, container actions will fail.
                  Install Docker Engine first — it will be deployed automatically via the agent.
                </p>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                size="sm"
                disabled={installingDocker || !agentCredentialId}
                onClick={installDocker}
                className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
              >
                {installingDocker ? (
                  <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Installing…</>
                ) : (
                  <><Plus className="h-3.5 w-3.5" /> Install Docker</>
                )}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDockerMissing(false)}>
                Dismiss
              </Button>
            </div>
            {!agentCredentialId && (
              <p className="text-xs text-amber-600 w-full">
                ⚠ Select an agent credential above first.
              </p>
            )}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="h-4 w-4" /> Server &amp; Credentials
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-3">
              <SelectField
                label="Server"
                value={selectedServer}
                onChange={(e) => setSelectedServer(e.target.value)}
              >
                <option value="">Select server…</option>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.hostname})
                  </option>
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
                    {c.display_name || c.label} {c.secret_preview}
                  </option>
                ))}
              </SelectField>

              <SelectField
                label="Docker registry credential (optional)"
                value={dockerCredentialId}
                onChange={(e) => setDockerCredentialId(e.target.value)}
              >
                <option value="">— None —</option>
                {dockerCreds.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.display_name || c.label}
                  </option>
                ))}
              </SelectField>
            </div>
            {!agentCredentialId && (
              <p className="mt-2 text-xs text-amber-600">
                ⚠ No agent credential selected — container actions are disabled.{" "}
                Add credentials in <strong>DevOps Tools → Credentials</strong>.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Deploy panel */}
        {showDeploy && (
          <Card className="border-primary/40">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Plus className="h-5 w-5" /> Deploy Container
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex w-fit rounded-lg border bg-muted/40 p-1">
                {(["image", "compose"] as const).map((m) => (
                  <button
                    key={m}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize ${
                      mode === m ? "bg-white shadow" : "text-muted-foreground"
                    }`}
                    onClick={() => setMode(m)}
                  >
                    {m === "compose" ? "Docker Compose" : "Image"}
                  </button>
                ))}
              </div>

              {mode === "image" ? (
                <form onSubmit={submitImage} className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input placeholder="Container name *" value={imageForm.name} onChange={(e) => setImageForm({ ...imageForm, name: e.target.value })} required />
                    <Input placeholder="Image (e.g. nginx:latest) *" value={imageForm.image} onChange={(e) => setImageForm({ ...imageForm, image: e.target.value })} required />
                    <Input placeholder="Ports  e.g. 8080:80, 443:443" value={imageForm.ports} onChange={(e) => setImageForm({ ...imageForm, ports: e.target.value })} />
                    <Input placeholder="Volumes  e.g. /data:/app/data" value={imageForm.volumes} onChange={(e) => setImageForm({ ...imageForm, volumes: e.target.value })} />
                    <Input placeholder="Registry (default: docker.io)" value={imageForm.docker_registry} onChange={(e) => setImageForm({ ...imageForm, docker_registry: e.target.value })} />
                  </div>

                  {/* Env vars with DB credential injection */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">Environment Variables</label>
                      {dbCreds.length > 0 && (
                        <div className="flex items-center gap-2">
                          <select
                            className="rounded border border-input bg-background px-2 py-1 text-xs"
                            value={dbCredentialId}
                            onChange={(e) => setDbCredentialId(e.target.value)}
                          >
                            <option value="">🗄 Inject DB credential…</option>
                            {dbCreds.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.display_name || c.label}
                              </option>
                            ))}
                          </select>
                          {dbCredentialId && (
                            <Button type="button" size="sm" variant="outline" className="text-xs h-7 px-2" onClick={injectDbEnv}>
                              + Inject
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                    <Textarea
                      className="font-mono text-xs min-h-20"
                      placeholder={"KEY=value\nANOTHER_KEY=value"}
                      value={imageForm.env}
                      onChange={(e) => setImageForm({ ...imageForm, env: e.target.value })}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      One per line or comma-separated.
                      {dbCreds.length > 0 && " Use the dropdown above to auto-fill database credentials."}
                    </p>
                  </div>

                  <Button className="w-full" disabled={!selectedServer || !agentCredentialId}>
                    <Plus className="h-4 w-4 mr-2" /> Create Container
                  </Button>
                </form>
              ) : (
                <form onSubmit={submitCompose} className="space-y-3">
                  <Input placeholder="Project name" value={composeForm.project_name} onChange={(e) => setComposeForm({ ...composeForm, project_name: e.target.value })} />
                  <Textarea className="min-h-64 font-mono text-xs" value={composeForm.compose_content} onChange={(e) => setComposeForm({ ...composeForm, compose_content: e.target.value })} />
                  <Button disabled={!selectedServer || !agentCredentialId}>
                    <FileCode2 className="h-4 w-4 mr-2" /> Deploy Compose
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        )}

        {activeContainer && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Terminal className="h-4 w-4" /> {consoleTitle || activeContainer.name}
                </CardTitle>
                <Button size="sm" variant="outline" onClick={() => setActiveContainer(null)}>Close</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={shellCommand}
                  onChange={(e) => setShellCommand(e.target.value)}
                  placeholder="sh command inside container"
                  className="font-mono text-xs"
                />
                <Button
                  onClick={() => runReadAction("shell", activeContainer)}
                  disabled={consoleLoading || activeContainer.state !== "running"}
                  className="gap-2 shrink-0"
                >
                  {consoleLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Terminal className="h-4 w-4" />}
                  Run
                </Button>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="outline" onClick={() => runReadAction("logs", activeContainer)}>
                  <ScrollText className="h-3.5 w-3.5 mr-1.5" /> Logs
                </Button>
                <Button size="sm" variant="outline" onClick={() => runReadAction("inspect", activeContainer)}>
                  Inspect
                </Button>
                {accessUrls(activeContainer).map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs text-primary hover:bg-muted">
                    Open {new URL(url).port} <ExternalLink className="h-3 w-3" />
                  </a>
                ))}
              </div>
              <pre className="max-h-96 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
                {consoleLoading ? "Running..." : consoleOutput || "Choose Logs, Inspect, or run a shell command."}
              </pre>
            </CardContent>
          </Card>
        )}

        {/* Summary tiles */}
        {summary && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {summaryEntries.map(([label, value]) => {
              const cfg = STATE_CONFIG[label];
              const active = stateFilter === label || (label === "total" && !stateFilter);
              return (
                <button
                  key={label}
                  onClick={() => setStateFilter(label === "total" ? null : label)}
                  className={`rounded-xl border bg-white p-3 text-left transition hover:border-primary hover:shadow-sm ${
                    active ? "border-primary ring-1 ring-primary/20 bg-primary/5" : ""
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    {cfg && <span className={`h-2 w-2 rounded-full shrink-0 ${cfg.dot}`} />}
                    <span className="text-xs capitalize text-muted-foreground">{label}</span>
                  </div>
                  <div className="text-2xl font-bold">{value}</div>
                </button>
              );
            })}
          </div>
        )}

        {/* Container history table */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Container className="h-5 w-5" />
                Container History
                <span className="font-normal text-sm text-muted-foreground">
                  ({filtered.length}{stateFilter ? ` ${stateFilter}` : ""})
                  {selectedServer && servers.find((s) => s.id === selectedServer) && (
                    <span className="ml-1 text-xs">· {servers.find((s) => s.id === selectedServer)!.name}</span>
                  )}
                </span>
              </CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <Input placeholder="Search name, image, container ID…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs h-8 text-sm" />
                {stateFilter && <Button variant="outline" size="sm" onClick={() => setStateFilter(null)}>Clear filter</Button>}
                <Button variant="outline" size="sm" onClick={loadData}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-16 gap-3 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" /> Loading containers…
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-14 text-center space-y-2">
                <Container className="h-9 w-9 mx-auto text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No containers found{stateFilter ? ` with state "${stateFilter}"` : ""}.</p>
                <p className="text-xs text-muted-foreground">Select a server and ensure the agent is running, then refresh.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/20 text-left text-xs text-muted-foreground">
                      <th className="pb-2 pt-3 pl-3 pr-1 w-6" />
                      <th className="pb-2 pt-3 pr-4">Name / Short ID</th>
                      <th className="pb-2 pt-3 pr-4">Image</th>
                      <th className="pb-2 pt-3 pr-4">State</th>
                      <th className="pb-2 pt-3 pr-4"><div className="flex items-center gap-1"><Cpu className="h-3 w-3" /> CPU</div></th>
                      <th className="pb-2 pt-3 pr-4">Memory</th>
                      <th className="pb-2 pt-3 pr-4"><div className="flex items-center gap-1"><Clock className="h-3 w-3" /> Last Seen</div></th>
                      <th className="pb-2 pt-3 pr-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((c) => (
                      <ContainerRow
                        key={c.id}
                        c={c}
                        onAction={(action) => runAction(action, c)}
                        onRead={runReadAction}
                        onEdit={editContainer}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-center text-muted-foreground">
          Click any row to expand full details — container ID, port mappings, exit code, and timestamps.
          All states (running, stopped, exited, dead) are shown. Data refreshes with each agent snapshot cycle.
        </p>
      </div>
    </DashboardLayout>
  );
}
