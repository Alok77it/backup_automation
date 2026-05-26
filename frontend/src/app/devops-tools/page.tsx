"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle, Download, ExternalLink, Loader2, Package, Play, Wrench } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, Server } from "@/lib/api";

interface Plugin {
  id: string; name: string; description: string | null; icon_url: string | null; risk_level: string;
}
interface PluginInstallation {
  id: string; server_id: string; plugin_id: string; status: string; access_url: string | null;
  health_status: string | null; error_message: string | null;
}
interface StoredCredential {
  id: string; provider: "agent" | "docker" | "github"; label: string; server_id: string | null;
  username: string | null; registry_url: string | null; secret_preview: string | null;
}

const allowedPlugins = new Set(["docker", "github_runner", "n8n", "jenkins"]);

export default function DevOpsToolsPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [installations, setInstallations] = useState<PluginInstallation[]>([]);
  const [credentials, setCredentials] = useState<StoredCredential[]>([]);
  const [selectedServer, setSelectedServer] = useState("");
  const [agentCredentialId, setAgentCredentialId] = useState("");
  const [dockerCredentialId, setDockerCredentialId] = useState("");
  const [githubCredentialId, setGithubCredentialId] = useState("");
  const [publicIp, setPublicIp] = useState("");
  const [packages, setPackages] = useState("");
  const [installing, setInstalling] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [newCredential, setNewCredential] = useState({
    provider: "agent" as "agent" | "docker" | "github",
    label: "",
    username: "",
    secret: "",
    registry_url: "docker.io",
  });
  const [githubRun, setGithubRun] = useState({
    repo_url: "",
    run_script: "npm install\nnpm run build\nnpm run start",
    install_path: "",
  });
  const [configs, setConfigs] = useState<Record<string, string>>({
    docker: "{}",
    n8n: JSON.stringify({ n8n_host: "", n8n_port: 5678, n8n_basic_auth_active: true, n8n_basic_auth_user: "admin", n8n_basic_auth_password: "", n8n_encryption_key: "", ssl_enabled: false, install_path: "/opt/n8n" }, null, 2),
    jenkins: JSON.stringify({ public_ip: "", jenkins_port: 8080, jenkins_agent_port: 50000, jenkins_home: "/opt/jenkins/data" }, null, 2),
    github_runner: JSON.stringify({ github_owner: "", github_repo: "", runner_count: 1, install_path: "/opt/github-runner" }, null, 2),
  });

  const selectedServerRow = servers.find((s) => s.id === selectedServer);
  const agentCredentials = credentials.filter((c) => c.provider === "agent" && (!c.server_id || c.server_id === selectedServer));
  const dockerCredentials = credentials.filter((c) => c.provider === "docker");
  const githubCredentials = credentials.filter((c) => c.provider === "github");

  const loadData = () => {
    Promise.all([
      api<Server[]>("/servers"),
      api<Plugin[]>("/plugins/catalog"),
      api<PluginInstallation[]>("/plugins/installations"),
      api<StoredCredential[]>("/devops-tools/credentials"),
    ])
      .then(([s, p, i, c]) => {
        setServers(s);
        if (!selectedServer && s[0]) {
          setSelectedServer(s[0].id);
          setPublicIp(s[0].hostname);
        }
        setPlugins(p.filter((plugin) => allowedPlugins.has(plugin.id)));
        setInstallations(i);
        setCredentials(c);
        setAgentCredentialId((v) => v || c.find((cred) => cred.provider === "agent")?.id || "");
        setDockerCredentialId((v) => v || c.find((cred) => cred.provider === "docker")?.id || "");
        setGithubCredentialId((v) => v || c.find((cred) => cred.provider === "github")?.id || "");
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load tools"));
  };

  useEffect(() => { loadData(); }, []);
  useEffect(() => { if (selectedServerRow) setPublicIp(selectedServerRow.hostname); }, [selectedServer]);

  const visibleInstallations = useMemo(
    () => installations.filter((i) => !selectedServer || i.server_id === selectedServer),
    [installations, selectedServer]
  );

  function configFor(pluginId: string) {
    const parsed = JSON.parse(configs[pluginId] || "{}");
    if (pluginId === "n8n") {
      parsed.n8n_host ||= publicIp;
      parsed.public_ip ||= publicIp;
      parsed.ssl_enabled = false;
      parsed.n8n_protocol = "http";
      parsed.webhook_url ||= `http://${parsed.n8n_host}:${parsed.n8n_port || 5678}/`;
    }
    if (pluginId === "jenkins") parsed.public_ip ||= publicIp;
    return parsed;
  }

  async function saveCredential(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setSuccess("");
    try {
      const saved = await api<StoredCredential>("/devops-tools/credentials", {
        method: "POST",
        body: JSON.stringify({
          ...newCredential,
          server_id: newCredential.provider === "agent" ? selectedServer : null,
          username: newCredential.username || null,
          registry_url: newCredential.provider === "docker" ? newCredential.registry_url : null,
        }),
      });
      setCredentials((prev) => [...prev, saved]);
      if (saved.provider === "agent") setAgentCredentialId(saved.id);
      if (saved.provider === "docker") setDockerCredentialId(saved.id);
      if (saved.provider === "github") setGithubCredentialId(saved.id);
      setNewCredential({ provider: newCredential.provider, label: "", username: "", secret: "", registry_url: "docker.io" });
      setSuccess("Credential saved encrypted in database.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Credential save failed");
    }
  }

  async function installPlugin(pluginId: string) {
    if (!selectedServer || !agentCredentialId) { setError("Select a server and saved agent credential."); return; }
    setInstalling(pluginId); setError(""); setSuccess("");
    try {
      await api(`/plugins/${pluginId}/install`, {
        method: "POST",
        body: JSON.stringify({
          server_id: selectedServer,
          agent_credential_id: agentCredentialId,
          docker_credential_id: dockerCredentialId || null,
          github_credential_id: githubCredentialId || null,
          config: configFor(pluginId),
        }),
      });
      setSuccess(`${pluginId} install submitted. Approve high-risk installs in AI Intelligence.`);
      loadData();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Install failed");
    } finally {
      setInstalling(null);
    }
  }

  async function installPackages() {
    if (!selectedServer || !agentCredentialId || !packages.trim()) return;
    try {
      await api("/execution/jobs", {
        method: "POST",
        body: JSON.stringify({
          server_id: selectedServer,
          job_type: "agent_command",
          risk_level: "high",
          timeout_seconds: 900,
          payload: { command: "package_install", agent_credential_id: agentCredentialId, args: { packages: packages.split(/[\s,]+/).filter(Boolean) } },
        }),
      });
      setSuccess("Package install job submitted.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Package install failed");
    }
  }

  async function runGithubRepo() {
    if (!selectedServer || !agentCredentialId || !githubCredentialId || !githubRun.repo_url.trim()) return;
    try {
      await api("/devops-tools/github/run", {
        method: "POST",
        body: JSON.stringify({
          server_id: selectedServer,
          agent_credential_id: agentCredentialId,
          github_credential_id: githubCredentialId,
          repo_url: githubRun.repo_url,
          run_script: githubRun.run_script,
          install_path: githubRun.install_path || null,
        }),
      });
      setSuccess("GitHub repo run submitted. Errors will appear in Automation Script logs.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "GitHub repo run failed");
    }
  }

  const statusIcon = (status: string) => {
    if (status === "installed") return <CheckCircle className="h-4 w-4 text-green-500" />;
    if (status === "installing") return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
    if (status === "failed") return <AlertCircle className="h-4 w-4 text-red-500" />;
    return <Package className="h-4 w-4 text-muted-foreground" />;
  };

  return (
    <DashboardLayout title="DevOps Tools">
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-3xl font-bold">DevOps Tools</h1>
          <p className="mt-1 text-muted-foreground">Install Docker, GitHub runner, n8n, Jenkins and packages on remote servers</p>
        </div>
        {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {success && <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{success}</div>}

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Wrench className="h-5 w-5" /> Target Server</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <SelectField label="Server" value={selectedServer} onChange={(e) => setSelectedServer(e.target.value)}>
              <option value="">Select server</option>
              {servers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.hostname})</option>)}
            </SelectField>
            <Input value={publicIp} onChange={(e) => setPublicIp(e.target.value)} placeholder="Public IP / host" />
            <SelectField label="Agent credential" value={agentCredentialId} onChange={(e) => setAgentCredentialId(e.target.value)}>
              <option value="">Select saved agent token</option>
              {agentCredentials.map((c) => <option key={c.id} value={c.id}>{c.label} {c.secret_preview}</option>)}
            </SelectField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Encrypted Credentials</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={saveCredential} className="grid gap-3 md:grid-cols-5">
              <SelectField label="Type" value={newCredential.provider} onChange={(e) => setNewCredential({ ...newCredential, provider: e.target.value as "agent" | "docker" | "github" })}>
                <option value="agent">Agent token</option>
                <option value="docker">Docker Hub</option>
                <option value="github">GitHub</option>
              </SelectField>
              <Input placeholder="Label" value={newCredential.label} onChange={(e) => setNewCredential({ ...newCredential, label: e.target.value })} required />
              <Input placeholder="Username" value={newCredential.username} onChange={(e) => setNewCredential({ ...newCredential, username: e.target.value })} />
              <Input type="password" placeholder="Token / password" value={newCredential.secret} onChange={(e) => setNewCredential({ ...newCredential, secret: e.target.value })} required />
              <Button>Save encrypted</Button>
            </form>
            <div className="grid gap-3 md:grid-cols-2">
              <SelectField label="Docker credential" value={dockerCredentialId} onChange={(e) => setDockerCredentialId(e.target.value)}>
                <option value="">None</option>
                {dockerCredentials.map((c) => <option key={c.id} value={c.id}>{c.label} {c.username ? `(${c.username})` : ""}</option>)}
              </SelectField>
              <SelectField label="GitHub credential" value={githubCredentialId} onChange={(e) => setGithubCredentialId(e.target.value)}>
                <option value="">None</option>
                {githubCredentials.map((c) => <option key={c.id} value={c.id}>{c.label} {c.username ? `(${c.username})` : ""}</option>)}
              </SelectField>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          {plugins.map((plugin) => {
            const install = visibleInstallations.find((i) => i.plugin_id === plugin.id);
            return (
              <Card key={plugin.id}>
                <CardHeader><CardTitle className="text-base">{plugin.name}</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <Textarea className="min-h-36 font-mono text-xs" value={configs[plugin.id] || "{}"} onChange={(e) => setConfigs({ ...configs, [plugin.id]: e.target.value })} />
                  {install ? (
                    <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
                      {statusIcon(install.status)}
                      <span className="font-medium capitalize">{install.status}</span>
                      {install.health_status && <Badge variant="outline">{install.health_status}</Badge>}
                      {install.access_url && <a className="ml-auto inline-flex items-center gap-1 text-primary" href={install.access_url} target="_blank" rel="noreferrer">Open <ExternalLink className="h-3 w-3" /></a>}
                    </div>
                  ) : (
                    <Button className="w-full" disabled={!selectedServer || !agentCredentialId || installing === plugin.id} onClick={() => installPlugin(plugin.id)}>
                      {installing === plugin.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      Install on selected server
                    </Button>
                  )}
                  {install?.error_message && <pre className="max-h-24 overflow-auto rounded bg-red-50 p-2 text-xs text-red-700">{install.error_message}</pre>}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardHeader><CardTitle>Install Packages</CardTitle></CardHeader>
          <CardContent className="flex gap-3">
            <Input value={packages} onChange={(e) => setPackages(e.target.value)} placeholder="nginx git curl htop" />
            <Button onClick={installPackages} disabled={!selectedServer || !agentCredentialId || !packages.trim()}>Install</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Run GitHub Repo</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <Input className="md:col-span-2" placeholder="https://github.com/owner/repo.git" value={githubRun.repo_url} onChange={(e) => setGithubRun({ ...githubRun, repo_url: e.target.value })} />
            <Input className="md:col-span-2" placeholder="/opt/apps/my-repo (optional)" value={githubRun.install_path} onChange={(e) => setGithubRun({ ...githubRun, install_path: e.target.value })} />
            <Textarea className="md:col-span-2 min-h-36 font-mono text-xs" value={githubRun.run_script} onChange={(e) => setGithubRun({ ...githubRun, run_script: e.target.value })} />
            <Button className="md:col-span-2" onClick={runGithubRepo} disabled={!selectedServer || !agentCredentialId || !githubCredentialId || !githubRun.repo_url.trim()}>
              <Play className="h-4 w-4" />
              Clone / Pull and Run
            </Button>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
