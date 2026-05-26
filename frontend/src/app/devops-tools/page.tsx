"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  ChevronRight,
  Download,
  ExternalLink,
  KeyRound,
  Loader2,
  Package,
  Play,
  Plus,
  Server,
  Settings2,
  Trash2,
  Wrench,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, Server as ServerType } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Plugin {
  id: string;
  name: string;
  description: string | null;
  icon_url: string | null;
  risk_level: string;
}

interface PluginInstallation {
  id: string;
  server_id: string;
  plugin_id: string;
  status: string;
  access_url: string | null;
  health_status: string | null;
  error_message: string | null;
}

interface StoredCredential {
  id: string;
  provider: string;
  label: string;
  server_id: string | null;
  username: string | null;
  registry_url: string | null;
  metadata_json: Record<string, unknown> | null;
  display_name: string | null;
  secret_preview: string | null;
}

// ── Credential type config ────────────────────────────────────────────────────

type CredProvider = "agent" | "docker" | "github" | "jenkins" | "database";

interface CredTypeConfig {
  label: string;
  usernamePlaceholder: string;
  secretLabel: string;
  secretPlaceholder: string;
  usernameRequired: boolean;
  showRegistry: boolean;
  hint: string;
}

const CRED_TYPES: Record<CredProvider, CredTypeConfig> = {
  agent: {
    label: "Agent Token",
    usernamePlaceholder: "Server username (e.g. root, ubuntu) — optional",
    secretLabel: "Agent Token",
    secretPlaceholder: "Agent authentication token *",
    usernameRequired: false,
    showRegistry: false,
    hint: "Used to authenticate remote actions on the server agent daemon.",
  },
  docker: {
    label: "Docker Registry",
    usernamePlaceholder: "Docker Hub / registry username *",
    secretLabel: "Access Token / Password",
    secretPlaceholder: "Docker access token or password *",
    usernameRequired: true,
    showRegistry: true,
    hint: "For pulling private images from Docker Hub or a custom registry. Username + token required.",
  },
  github: {
    label: "GitHub",
    usernamePlaceholder: "GitHub username *",
    secretLabel: "Personal Access Token (PAT)",
    secretPlaceholder: "GitHub PAT with repo/read permissions *",
    usernameRequired: true,
    showRegistry: false,
    hint: "For cloning private repos and setting up GitHub Actions self-hosted runners.",
  },
  jenkins: {
    label: "Jenkins",
    usernamePlaceholder: "Jenkins admin username *",
    secretLabel: "API Token / Password",
    secretPlaceholder: "Jenkins API token or admin password *",
    usernameRequired: true,
    showRegistry: false,
    hint: "Username + API token to authenticate Jenkins API calls and trigger pipelines.",
  },
  database: {
    label: "Database",
    usernamePlaceholder: "Database username *",
    secretLabel: "Password",
    secretPlaceholder: "Database password *",
    usernameRequired: true,
    showRegistry: false,
    hint: "For containers that deploy databases (PostgreSQL, MySQL, MongoDB). Stored encrypted.",
  },
};

const PROVIDER_ICON: Record<string, string> = {
  agent: "🔑",
  docker: "🐳",
  github: "🐙",
  jenkins: "🔧",
  database: "🗄️",
};

// ── Tool definitions ──────────────────────────────────────────────────────────

interface ToolDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  requiredCredTypes: CredProvider[];
  configFields: Array<{ key: string; label: string; placeholder: string; type?: string }>;
  defaultConfig: Record<string, string | number | boolean>;
}

const TOOLS: ToolDef[] = [
  {
    id: "docker",
    name: "Docker",
    icon: "🐳",
    description: "Install Docker Engine on a remote server",
    requiredCredTypes: ["agent", "docker"],
    configFields: [],
    defaultConfig: {},
  },
  {
    id: "jenkins",
    name: "Jenkins",
    icon: "🔧",
    description: "Deploy Jenkins CI/CD server",
    requiredCredTypes: ["agent", "jenkins"],
    configFields: [
      { key: "jenkins_port", label: "Jenkins Port", placeholder: "8080" },
      { key: "jenkins_agent_port", label: "Agent Port", placeholder: "50000" },
      { key: "jenkins_home", label: "Data Directory", placeholder: "/opt/jenkins/data" },
    ],
    defaultConfig: { jenkins_port: 8080, jenkins_agent_port: 50000, jenkins_home: "/opt/jenkins/data" },
  },
  {
    id: "n8n",
    name: "n8n Automation",
    icon: "⚡",
    description: "Deploy n8n workflow automation server",
    requiredCredTypes: ["agent"],
    configFields: [
      { key: "n8n_port", label: "Port", placeholder: "5678" },
      { key: "n8n_basic_auth_user", label: "Admin Username", placeholder: "admin" },
      { key: "n8n_basic_auth_password", label: "Admin Password", placeholder: "••••••", type: "password" },
      { key: "install_path", label: "Install Path", placeholder: "/opt/n8n" },
    ],
    defaultConfig: {
      n8n_port: 5678,
      n8n_basic_auth_user: "admin",
      n8n_basic_auth_password: "",
      install_path: "/opt/n8n",
    },
  },
  {
    id: "github_runner",
    name: "GitHub Runner",
    icon: "🐙",
    description: "Install self-hosted GitHub Actions runner",
    requiredCredTypes: ["agent", "github"],
    configFields: [
      { key: "github_owner", label: "GitHub Owner (user or org)", placeholder: "my-org" },
      { key: "github_repo", label: "Repository (leave blank for org-level)", placeholder: "my-repo" },
      { key: "runner_count", label: "Runner Count", placeholder: "1" },
      { key: "install_path", label: "Install Path", placeholder: "/opt/github-runner" },
    ],
    defaultConfig: { github_owner: "", github_repo: "", runner_count: 1, install_path: "/opt/github-runner" },
  },
];

const allowedPluginIds = new Set(TOOLS.map((t) => t.id));

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="flex items-center gap-0 mb-5 flex-wrap">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center">
          <div
            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold border-2 ${
              i < current
                ? "border-primary bg-primary text-white"
                : i === current
                ? "border-primary text-primary bg-white"
                : "border-muted text-muted-foreground bg-white"
            }`}
          >
            {i < current ? "✓" : i + 1}
          </div>
          <span
            className={`mx-2 text-xs font-medium hidden sm:inline ${
              i === current ? "text-primary" : "text-muted-foreground"
            }`}
          >
            {s}
          </span>
          {i < steps.length - 1 && (
            <ChevronRight className="h-3 w-3 text-muted-foreground mr-1" />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Credential Manager ────────────────────────────────────────────────────────

function CredentialManager({
  credentials,
  servers,
  onSaved,
  onDeleted,
}: {
  credentials: StoredCredential[];
  servers: ServerType[];
  onSaved: (cred: StoredCredential) => void;
  onDeleted: (id: string) => void;
}) {
  const [provider, setProvider] = useState<CredProvider>("agent");
  const [label, setLabel] = useState("");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [registryUrl, setRegistryUrl] = useState("docker.io");
  const [serverId, setServerId] = useState("");
  const [metaJson, setMetaJson] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");
  const [filterType, setFilterType] = useState("all");

  const cfg = CRED_TYPES[provider];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setFormError(""); setFormSuccess("");
    if (cfg.usernameRequired && !username.trim()) {
      setFormError(`Username is required for ${cfg.label} credentials.`);
      return;
    }
    setSaving(true);
    try {
      let meta: Record<string, unknown> | null = null;
      if (metaJson.trim()) {
        try { meta = JSON.parse(metaJson); } catch {
          setFormError("Extra fields must be valid JSON."); setSaving(false); return;
        }
      }
      const saved = await api<StoredCredential>("/devops-tools/credentials", {
        method: "POST",
        body: JSON.stringify({
          provider,
          label: label.trim(),
          username: username.trim() || null,
          secret,
          server_id: serverId || null,
          registry_url: provider === "docker" ? registryUrl : null,
          metadata_json: meta,
        }),
      });
      onSaved(saved);
      setFormSuccess(`"${saved.label}" saved successfully.`);
      setLabel(""); setUsername(""); setSecret(""); setMetaJson(""); setServerId("");
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deleteCred(id: string, lbl: string) {
    if (!confirm(`Delete credential "${lbl}"?`)) return;
    try {
      await api(`/devops-tools/credentials/${id}`, { method: "DELETE" });
      onDeleted(id);
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Delete failed");
    }
  }

  const filtered = filterType === "all" ? credentials : credentials.filter((c) => c.provider === filterType);

  return (
    <div className="space-y-5">
      {/* Add form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4" /> Add Credential
          </CardTitle>
        </CardHeader>
        <CardContent>
          {formError && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
              {formError}
            </div>
          )}
          {formSuccess && (
            <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-700">
              {formSuccess}
            </div>
          )}

          <form onSubmit={save} className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <SelectField
                label="Credential Type"
                value={provider}
                onChange={(e) => { setProvider(e.target.value as CredProvider); setUsername(""); setSecret(""); }}
              >
                {(Object.entries(CRED_TYPES) as [CredProvider, CredTypeConfig][]).map(([key, c]) => (
                  <option key={key} value={key}>{PROVIDER_ICON[key]} {c.label}</option>
                ))}
              </SelectField>
              <div>
                <label className="mb-1 block text-sm font-medium">Label / Name *</label>
                <Input
                  placeholder="e.g. prod-agent, dockerhub-main, jenkins-admin"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  required
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground rounded bg-muted/50 px-3 py-2">
              {cfg.hint}
            </p>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Username {cfg.usernameRequired ? "*" : "(optional)"}
                </label>
                <Input
                  placeholder={cfg.usernamePlaceholder}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required={cfg.usernameRequired}
                  autoComplete="username"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{cfg.secretLabel} *</label>
                <Input
                  type="password"
                  placeholder={cfg.secretPlaceholder}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>
            </div>

            {cfg.showRegistry && (
              <div>
                <label className="mb-1 block text-sm font-medium">Registry URL</label>
                <Input
                  placeholder="docker.io"
                  value={registryUrl}
                  onChange={(e) => setRegistryUrl(e.target.value)}
                />
              </div>
            )}

            {provider === "database" && (
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Extra Info (JSON — optional)
                </label>
                <Textarea
                  className="font-mono text-xs min-h-20"
                  placeholder='{"host": "localhost", "port": 5432, "dbname": "myapp"}'
                  value={metaJson}
                  onChange={(e) => setMetaJson(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Optionally store host, port, and database name for reference.
                </p>
              </div>
            )}

            <SelectField
              label="Link to server (optional — agent tokens are usually server-specific)"
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
            >
              <option value="">— Global (not server-specific) —</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.hostname})</option>
              ))}
            </SelectField>

            <Button type="submit" disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              Save Encrypted
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Credentials list */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4" />
              Stored Credentials ({credentials.length})
            </CardTitle>
            <select
              className="rounded border border-input bg-background px-2 py-1 text-xs"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
            >
              <option value="all">All types</option>              {(Object.entries(CRED_TYPES) as [CredProvider, CredTypeConfig][]).map(([k, c]) => (
                <option key={k} value={k}>{PROVIDER_ICON[k]} {c.label}</option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No credentials yet. Use the form above to add one.
            </p>
          ) : (
            <div className="divide-y">
              {filtered.map((c) => (
                <div key={c.id} className="flex items-center justify-between py-3 gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-lg shrink-0">{PROVIDER_ICON[c.provider] || "🔑"}</span>
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{c.label}</div>
                      <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-2 mt-0.5">
                        <Badge variant="secondary" className="text-[10px] capitalize">{c.provider}</Badge>
                        {c.username && <span>👤 {c.username}</span>}
                        {c.secret_preview && <span className="font-mono">{c.secret_preview}</span>}
                        {c.registry_url && <span>🌐 {c.registry_url}</span>}
                        {c.server_id && (
                          <span>🖥 {servers.find((s) => s.id === c.server_id)?.name || c.server_id.slice(0, 8)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-700 shrink-0" onClick={() => deleteCred(c.id, c.label)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Install Wizard ────────────────────────────────────────────────────────────

type WizardStep = "tool" | "server" | "config" | "confirm";

function InstallWizard({
  servers,
  installations,
  credentials,
  onDone,
  onCredentialSaved,
}: {
  servers: ServerType[];
  installations: PluginInstallation[];
  credentials: StoredCredential[];
  onDone: () => void;
  onCredentialSaved: (cred: StoredCredential) => void;
}) {
  const [step, setStep] = useState<WizardStep>("tool");
  const [selectedTool, setSelectedTool] = useState<ToolDef | null>(null);
  const [selectedServer, setSelectedServer] = useState("");
  const [publicIp, setPublicIp] = useState("");
  const [config, setConfig] = useState<Record<string, string | number | boolean>>({});
  const [credMap, setCredMap] = useState<Record<string, string>>({});
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Inline credential creation state
  const [inlineOpen, setInlineOpen] = useState<Partial<Record<CredProvider, boolean>>>({});
  const [inlineForms, setInlineForms] = useState<Partial<Record<CredProvider, { label: string; username: string; secret: string; registry: string }>>>({});
  const [inlineSaving, setInlineSaving] = useState<CredProvider | null>(null);
  const [inlineErrors, setInlineErrors] = useState<Partial<Record<CredProvider, string>>>({});

  function getInlineForm(type: CredProvider) {
    return inlineForms[type] ?? { label: "", username: "", secret: "", registry: "docker.io" };
  }

  function setInlineField(type: CredProvider, field: string, value: string) {
    setInlineForms((prev) => ({
      ...prev,
      [type]: { ...getInlineForm(type), [field]: value },
    }));
  }

  async function saveInlineCred(type: CredProvider) {
    const form = getInlineForm(type);
    const cfg = CRED_TYPES[type];
    if (cfg.usernameRequired && !form.username.trim()) {
      setInlineErrors((prev) => ({ ...prev, [type]: `Username is required for ${cfg.label}.` }));
      return;
    }
    if (!form.secret.trim()) {
      setInlineErrors((prev) => ({ ...prev, [type]: `${cfg.secretLabel} is required.` }));
      return;
    }
    setInlineSaving(type);
    setInlineErrors((prev) => ({ ...prev, [type]: "" }));
    try {
      const saved = await api<StoredCredential>("/devops-tools/credentials", {
        method: "POST",
        body: JSON.stringify({
          provider: type,
          label: form.label.trim() || `${type}-credential`,
          username: form.username.trim() || null,
          secret: form.secret,
          server_id: selectedServer || null,
          registry_url: type === "docker" ? form.registry : null,
        }),
      });
      onCredentialSaved(saved);
      setCredMap((prev) => ({ ...prev, [type]: saved.id }));
      setInlineOpen((prev) => ({ ...prev, [type]: false }));
      setInlineForms((prev) => ({ ...prev, [type]: { label: "", username: "", secret: "", registry: "docker.io" } }));
    } catch (e) {
      setInlineErrors((prev) => ({ ...prev, [type]: e instanceof ApiError ? e.message : "Save failed." }));
    } finally {
      setInlineSaving(null);
    }
  }

  const WIZARD_STEPS = ["Select Tool", "Select Server", "Configure", "Install"];
  const stepIndex = { tool: 0, server: 1, config: 2, confirm: 3 }[step];

  function pickTool(t: ToolDef) {
    setSelectedTool(t); setConfig({ ...t.defaultConfig }); setCredMap({}); setError(""); setStep("server");
  }

  function pickServer(id: string) {
    setSelectedServer(id);
    const s = servers.find((s) => s.id === id);
    if (s) setPublicIp(s.hostname);
    setStep("config");
  }

  function getCredsForType(type: CredProvider) {
    return credentials.filter((c) => c.provider === type && (!c.server_id || c.server_id === selectedServer));
  }

  async function install() {
    setError(""); setSuccess(""); setInstalling(true);
    if (!credMap["agent"]) { setError("Agent credential is required."); setInstalling(false); return; }
    try {
      const finalConfig: Record<string, unknown> = { ...config, public_ip: publicIp };
      if (selectedTool?.id === "n8n") {
        finalConfig.n8n_host = publicIp;
        finalConfig.ssl_enabled = false;
        finalConfig.n8n_protocol = "http";
        finalConfig.webhook_url = `http://${publicIp}:${config.n8n_port || 5678}/`;
      }
      await api(`/plugins/${selectedTool!.id}/install`, {
        method: "POST",
        body: JSON.stringify({
          server_id: selectedServer,
          agent_credential_id: credMap["agent"],
          docker_credential_id: credMap["docker"] || null,
          github_credential_id: credMap["github"] || null,
          config: finalConfig,
        }),
      });
      setSuccess(`${selectedTool!.name} install submitted. Approve high-risk installs in AI Intelligence.`);
      setTimeout(() => { onDone(); setStep("tool"); setSelectedTool(null); }, 1500);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Install failed");
    } finally {
      setInstalling(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="h-4 w-4" /> Install Tool
        </CardTitle>
      </CardHeader>
      <CardContent>
        <StepIndicator steps={WIZARD_STEPS} current={stepIndex} />

        {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {success && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{success}</div>}

        {/* Step 1 — Select Tool */}
        {step === "tool" && (
          <div>
            <p className="text-sm text-muted-foreground mb-4">Choose the tool you want to install on a remote server.</p>
            <div className="grid gap-3 md:grid-cols-2">
              {TOOLS.map((t) => {
                const existing = installations.filter((i) => i.plugin_id === t.id);
                return (
                  <button key={t.id} onClick={() => pickTool(t)} className="flex items-start gap-3 rounded-xl border bg-white p-4 text-left hover:border-primary hover:shadow-sm transition">
                    <span className="text-2xl mt-0.5">{t.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm">{t.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>
                      {existing.length > 0 && (
                        <div className="mt-2 flex gap-1 flex-wrap">
                          {existing.slice(0, 3).map((i) => (
                            <Badge key={i.id} variant={i.status === "installed" ? "outline" : "secondary"} className="text-[10px] capitalize">
                              {i.status === "installed" ? "✓ " : ""}
                              {servers.find((s) => s.id === i.server_id)?.name || "server"}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 2 — Select Server */}
        {step === "server" && selectedTool && (
          <div>
            <p className="text-sm text-muted-foreground mb-4">
              Select the server to install <strong>{selectedTool.name}</strong> on.
            </p>
            <div className="space-y-2">
              {servers.map((s) => {
                const existing = installations.find((i) => i.server_id === s.id && i.plugin_id === selectedTool.id);
                return (
                  <button key={s.id} onClick={() => pickServer(s.id)} className="flex w-full items-center justify-between rounded-xl border bg-white p-3.5 text-left hover:border-primary hover:shadow-sm transition">
                    <div className="flex items-center gap-3">
                      <Server className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div className="font-medium text-sm">{s.name}</div>
                        <div className="text-xs text-muted-foreground">{s.hostname}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {existing && <Badge variant="secondary" className="text-[10px] capitalize">{existing.status}</Badge>}
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </button>
                );
              })}
            </div>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => setStep("tool")}>← Back</Button>
          </div>
        )}

        {/* Step 3 — Configure */}
        {step === "config" && selectedTool && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Configure <strong>{selectedTool.name}</strong> for{" "}
              <strong>{servers.find((s) => s.id === selectedServer)?.name}</strong>.
            </p>

            <div>
              <label className="mb-1 block text-sm font-medium">Server Public IP / Hostname</label>
              <Input value={publicIp} onChange={(e) => setPublicIp(e.target.value)} placeholder="IP or hostname" />
            </div>

            {selectedTool.configFields.length > 0 && (
              <div className="grid gap-3 md:grid-cols-2">
                {selectedTool.configFields.map((f) => (
                  <div key={f.key}>
                    <label className="mb-1 block text-sm font-medium">{f.label}</label>
                    <Input type={f.type || "text"} placeholder={f.placeholder} value={String(config[f.key] ?? "")} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })} />
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Credentials</h3>
              {selectedTool.requiredCredTypes.map((type) => {
                const typeCreds = getCredsForType(type);
                const typeCfg = CRED_TYPES[type];
                const isOptional = type === "docker" || type === "github";
                return (
                  <div key={type} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <span>{PROVIDER_ICON[type]}</span>
                      <span className="font-medium">{typeCfg.label}</span>
                      <Badge variant={isOptional ? "secondary" : "outline"} className="text-[10px]">
                        {isOptional ? "optional" : "required"}
                      </Badge>
                    </div>
                    {typeCreds.length === 0 ? (
                      <div className="space-y-2">
                        <p className="text-xs text-amber-600">
                          No {typeCfg.label} credentials found.{" "}
                          {!inlineOpen[type] && (
                            <button
                              className="underline text-primary font-medium"
                              onClick={() => setInlineOpen((prev) => ({ ...prev, [type]: true }))}
                            >
                              Add one now
                            </button>
                          )}
                        </p>
                        {inlineOpen[type] && (
                          <div className="rounded-lg border bg-white p-3 space-y-2">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-semibold text-foreground">
                                {PROVIDER_ICON[type]} Add {typeCfg.label} Credential
                              </span>
                              <button
                                className="text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => setInlineOpen((prev) => ({ ...prev, [type]: false }))}
                              >✕ Cancel</button>
                            </div>
                            {inlineErrors[type] && (
                              <p className="text-xs text-red-600">{inlineErrors[type]}</p>
                            )}
                            <Input
                              placeholder={`Label (e.g. prod-${type})`}
                              value={getInlineForm(type).label}
                              onChange={(e) => setInlineField(type, "label", e.target.value)}
                            />
                            <div className="grid gap-2 grid-cols-2">
                              <Input
                                placeholder={typeCfg.usernamePlaceholder}
                                value={getInlineForm(type).username}
                                onChange={(e) => setInlineField(type, "username", e.target.value)}
                                required={typeCfg.usernameRequired}
                              />
                              <Input
                                type="password"
                                placeholder={typeCfg.secretPlaceholder}
                                value={getInlineForm(type).secret}
                                onChange={(e) => setInlineField(type, "secret", e.target.value)}
                                autoComplete="new-password"
                              />
                            </div>
                            {typeCfg.showRegistry && (
                              <Input
                                placeholder="Registry URL (docker.io)"
                                value={getInlineForm(type).registry}
                                onChange={(e) => setInlineField(type, "registry", e.target.value)}
                              />
                            )}
                            <p className="text-[11px] text-muted-foreground">{typeCfg.hint}</p>
                            <Button
                              size="sm"
                              disabled={inlineSaving === type}
                              className="gap-1.5"
                              onClick={() => saveInlineCred(type)}
                            >
                              {inlineSaving === type ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
                              Save &amp; Use
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <SelectField label="" value={credMap[type] || ""} onChange={(e) => setCredMap({ ...credMap, [type]: e.target.value })}>
                          <option value="">{isOptional ? "— None (optional) —" : `— Select ${typeCfg.label} —`}</option>
                          {typeCreds.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.display_name || c.label}{c.username ? ` · ${c.username}` : ""}{c.secret_preview ? ` ${c.secret_preview}` : ""}
                            </option>
                          ))}
                        </SelectField>
                        {!inlineOpen[type] ? (
                          <button
                            className="text-[11px] text-primary underline"
                            onClick={() => setInlineOpen((prev) => ({ ...prev, [type]: true }))}
                          >
                            + Add another {typeCfg.label} credential
                          </button>
                        ) : (
                          <div className="rounded-lg border bg-white p-3 space-y-2 mt-2">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-semibold">
                                {PROVIDER_ICON[type]} New {typeCfg.label} Credential
                              </span>
                              <button
                                className="text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => setInlineOpen((prev) => ({ ...prev, [type]: false }))}
                              >✕ Cancel</button>
                            </div>
                            {inlineErrors[type] && (
                              <p className="text-xs text-red-600">{inlineErrors[type]}</p>
                            )}
                            <Input
                              placeholder={`Label (e.g. prod-${type})`}
                              value={getInlineForm(type).label}
                              onChange={(e) => setInlineField(type, "label", e.target.value)}
                            />
                            <div className="grid gap-2 grid-cols-2">
                              <Input
                                placeholder={typeCfg.usernamePlaceholder}
                                value={getInlineForm(type).username}
                                onChange={(e) => setInlineField(type, "username", e.target.value)}
                              />
                              <Input
                                type="password"
                                placeholder={typeCfg.secretPlaceholder}
                                value={getInlineForm(type).secret}
                                onChange={(e) => setInlineField(type, "secret", e.target.value)}
                                autoComplete="new-password"
                              />
                            </div>
                            {typeCfg.showRegistry && (
                              <Input
                                placeholder="Registry URL (docker.io)"
                                value={getInlineForm(type).registry}
                                onChange={(e) => setInlineField(type, "registry", e.target.value)}
                              />
                            )}
                            <Button
                              size="sm"
                              disabled={inlineSaving === type}
                              className="gap-1.5"
                              onClick={() => saveInlineCred(type)}
                            >
                              {inlineSaving === type ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
                              Save &amp; Use
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("server")}>← Back</Button>
              <Button onClick={() => setStep("confirm")}>Review &amp; Install →</Button>
            </div>
          </div>
        )}

        {/* Step 4 — Confirm */}
        {step === "confirm" && selectedTool && (
          <div className="space-y-4">
            <div className="rounded-xl border bg-muted/30 p-4 space-y-2 text-sm">
              <div className="font-semibold text-base flex items-center gap-2">
                <span>{selectedTool.icon}</span> {selectedTool.name}
              </div>
              <div className="text-muted-foreground">
                Server: <strong>{servers.find((s) => s.id === selectedServer)?.name}</strong> ({publicIp})
              </div>
              {selectedTool.configFields.map((f) => (
                <div key={f.key} className="text-muted-foreground">
                  {f.label}: <strong>{String(config[f.key] ?? "")}</strong>
                </div>
              ))}
              <div className="pt-2 border-t space-y-1">
                {selectedTool.requiredCredTypes.map((type) => {
                  const cred = credentials.find((c) => c.id === credMap[type]);
                  return (
                    <div key={type} className="text-muted-foreground">
                      {PROVIDER_ICON[type]} {CRED_TYPES[type].label}: <strong>{cred ? cred.display_name || cred.label : "—"}</strong>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("config")}>← Back</Button>
              <Button onClick={install} disabled={installing || !credMap["agent"]} className="gap-2">
                {installing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Install {selectedTool.name}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Installations status ──────────────────────────────────────────────────────

function InstallationsPanel({ installations, servers, filterServerId }: { installations: PluginInstallation[]; servers: ServerType[]; filterServerId: string; }) {
  const visible = filterServerId ? installations.filter((i) => i.server_id === filterServerId) : installations;
  if (visible.length === 0) return null;

  const statusIcon = (s: string) => {
    if (s === "installed") return <CheckCircle className="h-4 w-4 text-emerald-500" />;
    if (s === "installing") return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
    if (s === "failed") return <AlertCircle className="h-4 w-4 text-red-500" />;
    return <Package className="h-4 w-4 text-muted-foreground" />;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Settings2 className="h-4 w-4" /> Installed Tools
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y">
          {visible.map((inst) => {
            const tool = TOOLS.find((t) => t.id === inst.plugin_id);
            const srv = servers.find((s) => s.id === inst.server_id);
            return (
              <div key={inst.id} className="flex items-center justify-between py-3 gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-lg">{tool?.icon || "📦"}</span>
                  <div>
                    <div className="font-medium text-sm">{tool?.name || inst.plugin_id}</div>
                    <div className="text-xs text-muted-foreground">{srv?.name || inst.server_id.slice(0, 8)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {statusIcon(inst.status)}
                  <Badge variant="secondary" className="text-xs capitalize">{inst.status}</Badge>
                  {inst.health_status && <Badge variant="outline" className="text-xs">{inst.health_status}</Badge>}
                  {inst.access_url && (
                    <a href={inst.access_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      Open <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Run GitHub Repo ───────────────────────────────────────────────────────────

function RunGithubPanel({ servers, credentials }: { servers: ServerType[]; credentials: StoredCredential[] }) {
  const [serverId, setServerId] = useState("");
  const [agentCredId, setAgentCredId] = useState("");
  const [githubCredId, setGithubCredId] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [installPath, setInstallPath] = useState("");
  const [script, setScript] = useState("npm install\nnpm run build\nnpm run start");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Container mode
  const [runMode, setRunMode] = useState<"server" | "container">("server");
  const [containerImage, setContainerImage] = useState("node:20-alpine");
  const [containerName, setContainerName] = useState("");
  const [containerPorts, setContainerPorts] = useState("3000:3000");
  const [containerEnv, setContainerEnv] = useState("");

  const agentCreds = credentials.filter((c) => c.provider === "agent" && (!c.server_id || c.server_id === serverId));
  const githubCreds = credentials.filter((c) => c.provider === "github");

  async function run() {
    setError(""); setSuccess(""); setRunning(true);
    try {
      if (runMode === "server") {
        await api("/devops-tools/github/run", {
          method: "POST",
          body: JSON.stringify({
            server_id: serverId,
            agent_credential_id: agentCredId,
            github_credential_id: githubCredId,
            repo_url: repoUrl,
            run_script: script,
            install_path: installPath || null,
          }),
        });
        setSuccess("GitHub repo run submitted on server. Check Logs → Job Logs for output.");
      } else {
        // Container mode: clone into a container and run the script inside it
        const envLines = containerEnv.split(/\r?\n|,/).map((l) => l.trim()).filter(Boolean);
        const composeContent = `services:
  app:
    image: ${containerImage}
    container_name: ${containerName || "github-app"}
    working_dir: /app
    command: sh -c "apk add --no-cache git && git clone ${repoUrl} /app && ${script.split("\n").join(" && ")}"
    ports:
      - "${containerPorts}"
    environment:
${envLines.map((e) => `      - ${e}`).join("\n") || "      []"}
    restart: unless-stopped
`;
        await api("/containers/compose/up", {
          method: "POST",
          body: JSON.stringify({
            server_id: serverId,
            agent_credential_id: agentCredId,
            project_name: containerName || "github-app",
            compose_content: composeContent,
          }),
        });
        setSuccess("GitHub app deployed in container via Docker Compose. Check Logs → Job Logs for output.");
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  const canRun = !running && !!serverId && !!agentCredId && !!githubCredId && !!repoUrl.trim();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">🐙 Run GitHub Repository</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">{error}</div>}
        {success && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-700">{success}</div>}

        {/* Mode toggle */}
        <div className="flex gap-1 rounded-xl border bg-muted/40 p-1 w-fit">
          {(["server", "container"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setRunMode(m)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                runMode === m ? "bg-white shadow text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "server" ? <Server className="h-3.5 w-3.5" /> : <span className="text-sm">🐳</span>}
              {m === "server" ? "Run on Server" : "Run in Container"}
            </button>
          ))}
        </div>

        {runMode === "server" ? (
          <p className="text-xs text-muted-foreground rounded bg-muted/50 px-3 py-2">
            Clones the repo directly onto the server and runs your script. Packages are installed via the run script (e.g. <code>npm install</code>).
          </p>
        ) : (
          <p className="text-xs text-muted-foreground rounded bg-muted/50 px-3 py-2">
            Clones the repo inside a Docker container and starts it on the server. Docker must already be installed. The container runs your script on start.
          </p>
        )}

        {/* Common fields */}
        <div className="grid gap-3 md:grid-cols-3">
          <SelectField label="Server" value={serverId} onChange={(e) => setServerId(e.target.value)}>
            <option value="">Select server…</option>
            {servers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.hostname})</option>)}
          </SelectField>
          <SelectField label="Agent credential" value={agentCredId} onChange={(e) => setAgentCredId(e.target.value)}>
            <option value="">— Select —</option>
            {agentCreds.map((c) => <option key={c.id} value={c.id}>{c.display_name || c.label} {c.secret_preview}</option>)}
          </SelectField>
          <SelectField label="GitHub credential (username + PAT)" value={githubCredId} onChange={(e) => setGithubCredId(e.target.value)}>
            <option value="">— Select —</option>
            {githubCreds.map((c) => <option key={c.id} value={c.id}>{c.display_name || c.label}</option>)}
          </SelectField>
        </div>

        <Input placeholder="https://github.com/owner/repo.git *" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />

        {/* Server mode extra fields */}
        {runMode === "server" && (
          <Input placeholder="/opt/apps/my-repo (optional install path on server)" value={installPath} onChange={(e) => setInstallPath(e.target.value)} />
        )}

        {/* Container mode extra fields */}
        {runMode === "container" && (
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Base Image</label>
              <Input placeholder="node:20-alpine" value={containerImage} onChange={(e) => setContainerImage(e.target.value)} />
              <p className="text-[11px] text-muted-foreground mt-1">Docker image that will run your app (must include git or compatible shell)</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Container Name</label>
              <Input placeholder="github-app" value={containerName} onChange={(e) => setContainerName(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Port Mapping</label>
              <Input placeholder="3000:3000" value={containerPorts} onChange={(e) => setContainerPorts(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Env Vars (KEY=value, one per line)</label>
              <Input placeholder="NODE_ENV=production" value={containerEnv} onChange={(e) => setContainerEnv(e.target.value)} />
            </div>
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium">
            {runMode === "server" ? "Run Script (runs after clone)" : "Start Command (runs inside container on boot)"}
          </label>
          <Textarea className="min-h-24 font-mono text-xs" value={script} onChange={(e) => setScript(e.target.value)} />
        </div>

        <Button onClick={run} disabled={!canRun} className="gap-2">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {runMode === "server" ? "Clone & Run on Server" : "Deploy in Container"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Install Packages ──────────────────────────────────────────────────────────

function PackagesPanel({ servers, credentials }: { servers: ServerType[]; credentials: StoredCredential[] }) {
  const [serverId, setServerId] = useState("");
  const [agentCredId, setAgentCredId] = useState("");
  const [packages, setPackages] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const agentCreds = credentials.filter((c) => c.provider === "agent" && (!c.server_id || c.server_id === serverId));

  async function install() {
    setError(""); setSuccess(""); setRunning(true);
    const pkgList = packages.split(/[\s,]+/).filter(Boolean).join(" ");
    // OS-aware install script — auto-detects apt (Debian/Ubuntu) vs dnf/yum (Fedora/RHEL/CentOS/Amazon)
    const script = `#!/bin/bash
set -euo pipefail
OS_ID=""
if [ -f /etc/os-release ]; then . /etc/os-release; OS_ID="\${ID:-}"; fi
echo "[PKG] OS: \$OS_ID  Packages: ${pkgList}"
case "\$OS_ID" in
  ubuntu|debian)
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq && apt-get install -y -qq ${pkgList} ;;
  fedora)
    dnf install -y ${pkgList} ;;
  centos|rhel|rocky|almalinux|amzn)
    yum install -y ${pkgList} ;;
  *)
    if command -v apt-get &>/dev/null; then
      apt-get update -qq && apt-get install -y -qq ${pkgList}
    elif command -v dnf &>/dev/null; then dnf install -y ${pkgList}
    elif command -v yum &>/dev/null; then yum install -y ${pkgList}
    else echo "[PKG] ERROR: no package manager found" >&2; exit 1; fi ;;
esac
echo "[PKG] Done."`;
    try {
      await api("/execution/jobs", {
        method: "POST",
        body: JSON.stringify({
          server_id: serverId,
          job_type: "agent_command",
          risk_level: "high",
          timeout_seconds: 900,
          payload: {
            command: "script_run_approved",
            _agent_token_raw: null,
            agent_credential_id: agentCredId,
            args: { script_content: script },
          },
        }),
      });
      setSuccess(`Install job submitted for: ${pkgList}. Works on Debian, Ubuntu, Fedora, RHEL, CentOS. Check Logs → Job Logs for output.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Install failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">📦 Install System Packages</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">{error}</div>}
        {success && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-700">{success}</div>}
        <div className="grid gap-3 md:grid-cols-2">
          <SelectField label="Server" value={serverId} onChange={(e) => setServerId(e.target.value)}>
            <option value="">Select server…</option>
            {servers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.hostname})</option>)}
          </SelectField>
          <SelectField label="Agent credential (username + token)" value={agentCredId} onChange={(e) => setAgentCredId(e.target.value)}>
            <option value="">— Select —</option>
            {agentCreds.map((c) => <option key={c.id} value={c.id}>{c.display_name || c.label} {c.secret_preview}</option>)}
          </SelectField>
        </div>
        <div className="flex gap-3">
          <Input placeholder="nginx git curl htop (space or comma separated)" value={packages} onChange={(e) => setPackages(e.target.value)} className="flex-1" />
          <Button onClick={install} disabled={running || !serverId || !agentCredId || !packages.trim()} className="gap-2 shrink-0">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Install
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type TabId = "install" | "installed" | "github" | "packages" | "credentials";

export default function DevOpsToolsPage() {
  const [servers, setServers] = useState<ServerType[]>([]);
  const [credentials, setCredentials] = useState<StoredCredential[]>([]);
  const [installations, setInstallations] = useState<PluginInstallation[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>("install");
  const [filterServer, setFilterServer] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    try {
      const [srvData, crdData, instData] = await Promise.all([
        api("/servers"),
        api("/devops-tools/credentials"),
        api("/plugins/installations"),
      ]);
      setServers(Array.isArray(srvData) ? srvData : (srvData.items ?? []));
      setCredentials(Array.isArray(crdData) ? crdData : (crdData.items ?? []));
      setInstallations(Array.isArray(instData) ? instData : (instData.items ?? []));
    } catch {
      // errors surface per-component
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  const TABS: { id: TabId; label: string; icon: string }[] = [
    { id: "install",     label: "Install Tool",  icon: "🔧" },
    { id: "installed",   label: "Installed",      icon: "✅" },
    { id: "github",      label: "GitHub Runs",    icon: "🐙" },
    { id: "packages",    label: "Packages",       icon: "📦" },
    { id: "credentials", label: "Credentials",    icon: "🔑" },
  ];

  return (
    <DashboardLayout title="DevOps Tools">
      <div className="space-y-6 p-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold">DevOps Tools</h1>
          <p className="text-muted-foreground mt-1">
            Install CI/CD tools, manage credentials, and run automation scripts on your servers.
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0 border-b overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                activeTab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <span>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 text-muted-foreground py-16">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {activeTab === "install" && (
              <InstallWizard
                servers={servers}
                installations={installations}
                credentials={credentials}
                onDone={loadAll}
                onCredentialSaved={(cred) =>
                  setCredentials((prev) => [...prev, cred])
                }
              />
            )}

            {activeTab === "installed" && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <SelectField
                    label="Filter by server"
                    value={filterServer}
                    onChange={(e) => setFilterServer(e.target.value)}
                  >
                    <option value="">All servers</option>
                    {servers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </SelectField>
                </div>
                {installations.filter((i) =>
                  !filterServer || i.server_id === filterServer
                ).length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground text-sm">
                    No tools installed yet. Use the <strong>Install Tool</strong> tab to get started.
                  </div>
                ) : (
                  <InstallationsPanel
                    installations={installations}
                    servers={servers}
                    filterServerId={filterServer}
                  />
                )}
              </div>
            )}

            {activeTab === "github" && (
              <RunGithubPanel servers={servers} credentials={credentials} />
            )}

            {activeTab === "packages" && (
              <PackagesPanel servers={servers} credentials={credentials} />
            )}

            {activeTab === "credentials" && (
              <CredentialManager
                credentials={credentials}
                servers={servers}
                onSaved={(cred) =>
                  setCredentials((prev) => {
                    const idx = prev.findIndex((c) => c.id === cred.id);
                    if (idx >= 0) {
                      const next = [...prev];
                      next[idx] = cred;
                      return next;
                    }
                    return [...prev, cred];
                  })
                }
                onDeleted={(id) =>
                  setCredentials((prev) => prev.filter((c) => c.id !== id))
                }
              />
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
